import type { ApplicationLane } from "./lanes";
import type { Application, ApplicationSummary } from "./types";
import type { ApplicationClosedReason, ApplicationStatus } from "@reactive-resume/schema/applications/data";
import type { QueryClient } from "@tanstack/react-query";
import { plural, t } from "@lingui/core/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { stageBaselinesFor } from "@reactive-resume/schema/applications/stage-baselines";
import { toast } from "@reactive-resume/ui/components/toast";
import { getCategoryLane, getLaneLabel, laneMoveInput } from "./lanes";
import { applicationDetailQueryKey, applicationsListQueryKey } from "./queries";
import { applicationLanesQueryKey, useApplicationLanes } from "./use-application-lanes";
import { withUndo } from "@/features/career/shared";
import { toastError } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";

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

type MoveWithUndoInput = {
	applications: readonly Pick<ApplicationSummary, "id">[];
	lane: ApplicationLane;
	/** For a Closed lane without a preset outcome. */
	closedReason?: ApplicationClosedReason | null | undefined;
	/** What the toast says; Undo sits beside it. */
	description: string;
};

type Stage = Pick<ApplicationSummary, "status" | "laneId" | "closedReason">;

const stageOf = ({ status, laneId, closedReason }: Stage): Stage => ({ status, laneId, closedReason });

/** The web app talks to one server, as one account per page load: one scope for its stage baselines. */
export const STAGE_SCOPE = "";

/** An application as this page has it: its list row, or its open detail. */
export const listedApplication = (queryClient: QueryClient, id: string) =>
	queryClient.getQueryData<ApplicationSummary[]>(applicationsListQueryKey())?.find((item) => item.id === id) ??
	queryClient.getQueryData<Application>(applicationDetailQueryKey(id));

/**
 * Moves applications to a lane with Undo, the way Delete and Dismiss work: the list shows the move at once, the server
 * gets it when the toast closes (after 6 seconds, when another toast replaces it, or when the page is hidden), and Undo
 * puts the rows back without a write, so no stage history is recorded for a move that was taken back.
 *
 * The write carries each row's stage from before the move, and the server leaves any row whose stage has changed since:
 * a move made to one of these rows in the meantime, here or on another device, wins. A second move of a row made here
 * before the first is saved is saved after it, from what it saved. Undo and a failed write put back only these rows,
 * and only those still showing this move.
 */
export function useMoveWithUndo() {
	const queryClient = useQueryClient();
	const invalidate = useInvalidateApplications();
	const { mode } = useApplicationLanes();
	const listKey = applicationsListQueryKey();

	return ({ applications, lane, closedReason, description }: MoveWithUndoInput) => {
		const ids = applications.map((application) => application.id);
		if (ids.length === 0) return;
		const input = laneMoveInput(lane, mode, closedReason);
		const status = lane.category;
		const reason = status === "closed" ? (input.closedReason ?? null) : null;
		const moved: Partial<Stage> = { status, closedReason: reason, ...(mode === "lanes" ? { laneId: lane.id } : {}) };
		const showsMove = (row: Stage) =>
			row.status === status && (row.closedReason ?? null) === reason && (mode !== "lanes" || row.laneId === lane.id);

		void queryClient.cancelQueries({ queryKey: listKey });
		const before = new Map<string, Stage>();
		const listed = new Map<string, ApplicationSummary | Application>();
		for (const id of ids) {
			const row = listedApplication(queryClient, id);
			if (!row) continue;
			before.set(id, stageOf(row));
			listed.set(id, row);
		}
		const { baselines, settle } = stageBaselinesFor(queryClient).begin(STAGE_SCOPE, listed);

		const revert = <Row extends Stage & { id: string }>(row: Row): Row => {
			const stage = before.get(row.id);
			return stage && showsMove(row) ? { ...row, ...stage } : row;
		};
		const selected = new Set(ids);
		const apply = <Row extends Stage & { id: string }>(row: Row): Row =>
			selected.has(row.id) ? { ...row, ...moved } : row;

		queryClient.setQueryData<ApplicationSummary[]>(listKey, (current) => current?.map(apply));
		// The open application (sheet, workspace) shows the move too.
		for (const id of ids)
			queryClient.setQueryData<Application>(applicationDetailQueryKey(id), (current) => current && apply(current));

		const restore = () => {
			settle([]);
			queryClient.setQueryData<ApplicationSummary[]>(listKey, (current) => current?.map(revert));
			for (const id of ids)
				queryClient.setQueryData<Application>(applicationDetailQueryKey(id), (current) => current && revert(current));
			for (const id of ids) invalidate(id);
		};

		withUndo({
			description,
			commit: async () => {
				try {
					const expectedStages = await Promise.all(
						[...baselines].map(async ([id, baseline]) => ({ id, ...(await baseline) })),
					);
					const { updated, stages } = await client.applications.bulkUpdate({ ids, ...input, expectedStages });
					settle(stages ?? []);
					const kept = ids.length - updated;
					if (kept > 0)
						toast.add({
							description: plural(kept, {
								one: "# application changed in the meantime, so it keeps its newer stage",
								other: "# applications changed in the meantime, so they keep their newer stage",
							}),
						});
				} catch (error) {
					restore();
					toastError(error, t`Couldn't update the applications. Try again.`);
				} finally {
					for (const id of ids) invalidate(id);
				}
			},
			onUndo: restore,
		});
	};
}

/**
 * Stage changes, closing and deleting, shared by the list, board and detail sheet. A move shows at once (the list
 * updates optimistically) and says so in a toast, whichever way it was made. Reaching Offer offers to add the offer's
 * terms; accepting an offer offers to close the other open applications, only if the user chooses to.
 */
export function useApplicationActions() {
	const queryClient = useQueryClient();
	const invalidate = useInvalidateApplications();
	const listKey = applicationsListQueryKey();
	const { lanes, mode } = useApplicationLanes();
	const router = useRouter();
	const moveWithUndo = useMoveWithUndo();

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
			const reason = input.closedReason ?? lane.closedReason;

			if (lane.category === "offer") {
				toast.add({
					description: t`Moved to ${label}`,
					actionProps: {
						children: t`Add the offer's terms`,
						onClick: () =>
							void router.navigate({
								to: "/dashboard/applications/$applicationId/{-$tab}",
								params: { applicationId: input.id, tab: "messages" },
								search: { offer: "new" },
							}),
					},
				});
				return;
			}

			if (lane.category === "closed" && reason === "accepted") {
				const others = (queryClient.getQueryData<ApplicationSummary[]>(listKey) ?? []).filter(
					(row) => row.id !== input.id && row.status !== "closed",
				);
				if (others.length === 0) {
					toast.add({ description: t`Closed as Accepted offer` });
					return;
				}
				const closedLane = getCategoryLane(lanes, "closed");
				toast.add({
					description: plural(others.length, {
						one: "Closed as Accepted offer. Close your other open application as Accepted another offer?",
						other: "Closed as Accepted offer. Close your # other open applications as Accepted another offer?",
					}),
					// A choice, not a notice: it stays until it's answered or dismissed.
					timeout: 0,
					actionProps: {
						children: plural(others.length, { one: "Close it", other: "Close all #" }),
						onClick: () =>
							moveWithUndo({
								applications: others,
								lane: closedLane,
								closedReason: "accepted-other",
								description: plural(others.length, {
									one: "# application closed as Accepted another offer",
									other: "# applications closed as Accepted another offer",
								}),
							}),
					},
				});
				return;
			}

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
