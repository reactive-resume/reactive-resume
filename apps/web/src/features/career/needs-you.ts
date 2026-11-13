import { useQuery } from "@tanstack/react-query";
import { useCareerTime, useNow } from "./shared";
import { compareNextStepSortKeys, getNextStep, needsYou, nextStepSortKey } from "@/features/applications/next-step";
import { applicationsListQueryOptions, offerHintFor, useOfferHints } from "@/features/applications/queries";

/**
 * Applications whose next step you owe now, most urgent first: due follow-ups, late replies, offers to answer. The
 * same rule as Applications' "Needs you"; interviews this week are on Today's Coming up instead.
 */
export function useApplicationsNeedingAttention(now: Date) {
	const { timeZone } = useCareerTime();
	const query = useQuery(applicationsListQueryOptions());
	const hints = useOfferHints();
	const attention = (query.data ?? [])
		.flatMap((application) => {
			const hint = offerHintFor(hints, application.id);
			const step = getNextStep(application, now, timeZone, hint);
			return needsYou(step, now) ? [{ application, step, key: nextStepSortKey(application, now, timeZone, hint) }] : [];
		})
		.sort((a, b) => compareNextStepSortKeys(a.key, b.key, a.application.id, b.application.id));
	return { query, attention };
}

/**
 * The "Needs you" count on Today and on its place in the navigation; undefined until the list has loaded. Schedule
 * results are not counted: they are read, not owed, and Today shows them on their own.
 */
export function useNeedsYouCount() {
	const now = useNow();
	const { query, attention } = useApplicationsNeedingAttention(now);
	if (!query.data) return undefined;
	return attention.length;
}
