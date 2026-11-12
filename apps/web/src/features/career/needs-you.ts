import { useQuery } from "@tanstack/react-query";
import { useCareerTime, useNow } from "./shared";
import {
	compareNextStepSortKeys,
	getNextStep,
	needsAttention,
	nextStepSortKey,
} from "@/features/applications/next-step";
import { applicationsListQueryOptions, offerHintFor, useOfferHints } from "@/features/applications/queries";
import { orpc } from "@/libs/orpc/client";

/**
 * Applications whose next step needs the user now, most urgent first. The same next-step rules as the Applications
 * list: due follow-ups, no reply, interviews this week, offers.
 */
export function useApplicationsNeedingAttention(now: Date) {
	const { timeZone } = useCareerTime();
	const query = useQuery(applicationsListQueryOptions());
	const hints = useOfferHints();
	const attention = (query.data ?? [])
		.flatMap((application) => {
			const hint = offerHintFor(hints, application.id);
			const step = getNextStep(application, now, timeZone, hint);
			return needsAttention(step, now)
				? [{ application, step, key: nextStepSortKey(application, now, timeZone, hint) }]
				: [];
		})
		.sort((a, b) => compareNextStepSortKeys(a.key, b.key, a.application.id, b.application.id));
	return { query, attention };
}

/** The "Needs you" count on Today and on its place in the navigation; undefined until both lists have loaded. */
export function useNeedsYouCount() {
	const now = useNow();
	const { data: notifications } = useQuery(orpc.career.notifications.queryOptions({ input: {} }));
	const { query, attention } = useApplicationsNeedingAttention(now);
	if (!notifications || !query.data) return undefined;
	return notifications.filter((notification) => !notification.readAt).length + attention.length;
}
