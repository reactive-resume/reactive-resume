import type { ResourceOutput } from "./resources";
import { t } from "@lingui/core/macro";
import { useQuery } from "@tanstack/react-query";
import {
	compareNextStepSortKeys,
	getNextStep,
	latestOfferHints,
	needsAttention,
	nextStepSortKey,
} from "@reactive-resume/schema/applications/next-step";
import { now } from "./clock";
import { useDataActions, useDataBackend } from "./provider";
import Storage from "./storage";

export function rankToday(
	applications: ResourceOutput<"applications">,
	offers: ResourceOutput<"offers">,
	at: Date,
	zone: string,
) {
	const hints = latestOfferHints(offers);
	const steps = applications
		.map((application) => ({
			application,
			step: getNextStep(application, at, zone, hints.get(application.id)),
			key: nextStepSortKey(application, at, zone, hints.get(application.id)),
		}))
		.sort((a, b) => compareNextStepSortKeys(a.key, b.key, a.application.id, b.application.id));
	return {
		needsYou: steps.filter(({ step }) => needsAttention(step, at)),
		comingUp: steps.filter(({ step }) => !needsAttention(step, at) && step.kind !== "closed"),
		recent: [...applications].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0, 10),
	};
}
export function useFirstRun() {
	const { scope } = useDataBackend();
	const key = `first-run:${scope}`;
	const query = useQuery({
		queryKey: [scope, "first-run"],
		queryFn: () => Storage.getItemSync(key) !== "done",
		enabled: !!scope,
	});
	return {
		...query,
		async complete() {
			if (!scope) throw new Error(t`Sign in again.`);
			Storage.setItemSync(key, "done");
			await query.refetch();
		},
	};
}
/** Completion is reversible on this device. Server read receipts cannot be reversed by the current API. */
export function useNotificationCompletion() {
	const { scope } = useDataBackend();
	const actions = useDataActions();
	const key = `notification-completion:${scope}`;
	const query = useQuery<Record<string, string>>({
		queryKey: [scope, "notification-completion"],
		queryFn: () => JSON.parse(Storage.getItemSync(key) ?? "{}") as Record<string, string>,
		enabled: !!scope,
	});
	const save = async (values: Record<string, string>) => {
		if (!scope) throw new Error(t`Sign in again.`);
		Storage.setItemSync(key, JSON.stringify(values));
		await query.refetch();
	};
	return {
		...query,
		async complete(id: string) {
			await save({ ...query.data, [id]: now().toISOString() });
		},
		async undo(id: string) {
			const values = { ...query.data };
			delete values[id];
			await save(values);
		},
		markRead: (id: string) => actions.write("stories-and-facts", "career.markNotificationRead", { id }),
	};
}
