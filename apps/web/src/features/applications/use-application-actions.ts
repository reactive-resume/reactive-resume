import type { ApplicationLane } from "./lanes";
import type { ApplicationSummary } from "./types";
import type { ApplicationClosedReason, ApplicationStatus } from "@reactive-resume/schema/applications/data";
import { t } from "@lingui/core/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@reactive-resume/ui/components/toast";
import { getCategoryLane, getLaneLabel, laneMoveInput } from "./lanes";
import { applicationsListQueryKey } from "./queries";
import { applicationLanesQueryKey, useApplicationLanes } from "./use-application-lanes";
import { toastError } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

/** Refreshes everything that shows applications: the list, the open one, stats, tags and documents' job lines. */
export function useInvalidateApplications() {
	const queryClient = useQueryClient();

	return (id?: string) => {
		void queryClient.invalidateQueries({ queryKey: applicationsListQueryKey() });
		void queryClient.invalidateQueries({ queryKey: orpc.applications.stats.queryKey() });
		void queryClient.invalidateQueries({ queryKey: orpc.applications.tags.queryKey() });
		void queryClient.invalidateQueries({ queryKey: orpc.documents.key() });
		void queryClient.invalidateQueries({ queryKey: applicationLanesQueryKey() });
		if (id) {
			void queryClient.invalidateQueries({ queryKey: orpc.applications.getById.queryKey({ input: { id } }) });
			void queryClient.invalidateQueries({
				queryKey: orpc.career.workspace.queryKey({ input: { applicationId: id } }),
			});
		}
	};
}

/**
 * Stage changes, closing and deleting, shared by the list, board and detail sheet. A move shows at once (the list
 * updates optimistically) and says so in a toast, whichever way it was made.
 */
export function useApplicationActions() {
	const queryClient = useQueryClient();
	const invalidate = useInvalidateApplications();
	const listKey = applicationsListQueryKey();
	const { lanes, mode } = useApplicationLanes();

	const update = useMutation({
		...orpc.applications.update.mutationOptions(),
		onMutate: async (input) => {
			await queryClient.cancelQueries({ queryKey: listKey });
			const previous = queryClient.getQueryData<ApplicationSummary[]>(listKey);
			const lane = input.laneId ? lanes.find((item) => item.id === input.laneId) : undefined;
			const status = lane?.category ?? (input.status as ApplicationStatus | undefined);
			// A move to another category lands in that category's default lane, as the server does.
			const laneId = lane?.id ?? (mode === "lanes" && status ? getCategoryLane(lanes, status).id : undefined);
			const closedReason =
				input.closedReason !== undefined
					? input.closedReason
					: lane?.closedReason
						? lane.closedReason
						: status && status !== "closed"
							? null
							: undefined;
			queryClient.setQueryData<ApplicationSummary[]>(listKey, (rows) =>
				rows?.map((row): ApplicationSummary =>
					row.id === input.id
						? {
								...row,
								...(status ? { status } : {}),
								...(laneId ? { laneId } : {}),
								...(closedReason !== undefined ? { closedReason } : {}),
							}
						: row,
				),
			);
			return { previous };
		},
		onError: (error, _input, context) => {
			if (context?.previous) queryClient.setQueryData(listKey, context.previous);
			toastError(error, t`Couldn't update the application. Try again.`);
		},
		// Toasts live on the mutation, not on mutate(): a board card's menu unmounts when the card changes column, and
		// mutate()'s own callbacks die with it.
		onSuccess: (_data, input) => {
			const lane = input.laneId
				? lanes.find((item) => item.id === input.laneId)
				: input.status
					? getCategoryLane(lanes, input.status as ApplicationStatus)
					: undefined;
			if (!lane) return;
			const label = getLaneLabel(lane);
			toast.add({
				description:
					lane.category !== "closed"
						? t`Moved to ${label}`
						: lane.systemKey
							? t`Application closed`
							: t`Closed as ${label}`,
			});
		},
		onSettled: (_data, _error, input) => invalidate(input.id),
	});

	const remove = useMutation({
		...orpc.applications.delete.mutationOptions(),
		onSuccess: (_data, input) => {
			invalidate(input.id);
			toast.add({ description: t`Application deleted` });
		},
		onError: (error) => toastError(error, t`Couldn't delete the application. Try again.`),
	});

	return {
		update,
		remove,
		/** Moves to a lane; a Closed lane without a preset needs the outcome. */
		moveTo: (
			application: Pick<ApplicationSummary, "id">,
			lane: ApplicationLane,
			closedReason?: ApplicationClosedReason | null,
		) => update.mutate({ id: application.id, ...laneMoveInput(lane, mode, closedReason) }),
		/** Closes into the default Closed lane with an outcome. */
		close: (application: Pick<ApplicationSummary, "id">, closedReason: ApplicationClosedReason) =>
			update.mutate({ id: application.id, ...laneMoveInput(getCategoryLane(lanes, "closed"), mode, closedReason) }),
	};
}
