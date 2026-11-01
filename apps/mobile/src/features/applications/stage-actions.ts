import type { ApplicationLane } from "./lanes";
import type { OfferHint } from "./next-step";
import type { Application, ApplicationSummary } from "./types";
import type { ApplicationClosedReason } from "@reactive-resume/schema/applications/data";
import type { QueryClient } from "@tanstack/react-query";
import { plural, t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { stageBaselinesFor } from "@reactive-resume/schema/applications/stage-baselines";
import { useApplicationLanes } from "./lane-queries";
import { getLaneLabel, laneInput, resolveLane } from "./lanes";
import { applicationDetailQueryKey, applicationsListQueryKey, stageScope, useApplicationMutations } from "./queries";
import { getClosedReasonLabel } from "./stages";
import { getServer, useSession } from "@/auth/session";
import { useOffers } from "@/features/career/hooks";
import { withUndo } from "@/features/career/undo";
import { routes } from "@/routes";
import { showToast } from "@/ui";

type MoveWithUndoInput = {
	applications: readonly Pick<ApplicationSummary, "id">[];
	lane: ApplicationLane;
	/** Whether the server has lanes; older servers get canonical writes. */
	supported: boolean;
	/** For a Closed lane without a preset outcome. */
	closedReason?: ApplicationClosedReason | undefined;
	/** What the toast says; Undo sits beside it. */
	message: string;
};

type Stage = Pick<ApplicationSummary, "status" | "laneId" | "closedReason">;

/** An application as this app has it for a server: its list row, or its open detail. */
export const listedApplication = (queryClient: QueryClient, id: string, server = getServer()) =>
	queryClient.getQueryData<ApplicationSummary[]>(applicationsListQueryKey(server))?.find((item) => item.id === id) ??
	queryClient.getQueryData<Application>(applicationDetailQueryKey(id, server));

/**
 * Moves applications to a lane with Undo, as the web app does: the list shows the move at once, the server gets it
 * when the toast ends (or the app goes to the background), and Undo puts the rows back without a write, so no stage
 * history is recorded for a move that was taken back.
 *
 * The write carries each row's stage from before the move, and the server leaves any row whose stage has changed since:
 * a move made to one of these rows in the meantime, here or on another device, wins. A second move of a row made here
 * before the first is saved is saved after it, from what it saved. Undo and a failed write put back only these rows,
 * and only those still showing this move.
 */
export function useMoveWithUndo() {
	const queryClient = useQueryClient();
	const session = useSession();
	const { bulkUpdate } = useApplicationMutations();

	return ({ applications, lane, supported, closedReason, message }: MoveWithUndoInput) => {
		const ids = applications.map((application) => application.id);
		if (ids.length === 0) return;
		const reason = lane.category === "closed" ? (lane.closedReason ?? closedReason ?? null) : null;
		const listKey = applicationsListQueryKey(session.server);
		const detailKey = (id: string) => applicationDetailQueryKey(id, session.server);
		void queryClient.cancelQueries({ queryKey: listKey });
		const before = new Map<string, Stage>();
		const listed = new Map<string, ApplicationSummary | Application>();
		for (const id of ids) {
			const row = listedApplication(queryClient, id, session.server);
			if (!row) continue;
			before.set(id, { status: row.status, laneId: row.laneId, closedReason: row.closedReason });
			listed.set(id, row);
		}
		const { baselines, settle } = stageBaselinesFor(queryClient).begin(stageScope(), listed);
		const input = {
			ids,
			...laneInput(lane, supported),
			...(lane.category === "closed" && !lane.closedReason && closedReason ? { closedReason } : {}),
		};
		const selected = new Set(ids);
		const patch = { status: lane.category, laneId: lane.id, closedReason: reason };
		const showsMove = (row: Stage) =>
			row.status === patch.status && (row.closedReason ?? null) === reason && row.laneId === patch.laneId;
		const apply = <Row extends Stage & { id: string }>(row: Row): Row =>
			selected.has(row.id) ? { ...row, ...patch } : row;
		const revert = <Row extends Stage & { id: string }>(row: Row): Row => {
			const stage = before.get(row.id);
			return stage && showsMove(row) ? { ...row, ...stage } : row;
		};

		queryClient.setQueryData<ApplicationSummary[]>(listKey, (current) => current?.map(apply));
		for (const id of ids) queryClient.setQueryData<Application>(detailKey(id), (current) => current && apply(current));
		const restore = () => {
			settle([]);
			queryClient.setQueryData<ApplicationSummary[]>(listKey, (current) => current?.map(revert));
			for (const id of ids)
				queryClient.setQueryData<Application>(detailKey(id), (current) => current && revert(current));
			void queryClient.invalidateQueries({ queryKey: listKey });
		};

		withUndo({
			message,
			commit: async () => {
				const expectedStages = await Promise.all(
					[...baselines].map(async ([id, pending]) => {
						const { laneId, ...baseline } = await pending;
						return { id, ...baseline, ...(supported ? { laneId } : {}) };
					}),
				);
				const { updated, stages } = await bulkUpdate.mutateAsync({ ...input, expectedStages });
				settle(stages ?? []);
				const kept = ids.length - updated;
				if (kept > 0)
					showToast({
						message: plural(kept, {
							one: "# application changed in the meantime, so it keeps its newer stage",
							other: "# applications changed in the meantime, so they keep their newer stage",
						}),
					});
			},
			restore,
			failed: () => showToast({ message: t`Couldn't update the applications. Try again.` }),
		});
	};
}

/**
 * Each application's newest saved offer, as Next step needs it. Undefined until the offers have loaded (or when they
 * can't), so an application at Offer reads "Decide on the offer" rather than claiming no terms were saved.
 */
export function useOfferHints(): ReadonlyMap<string, OfferHint> | undefined {
	const { data } = useOffers();
	return useMemo(() => {
		if (!data) return undefined;
		const hints = new Map<string, OfferHint & { at: number }>();
		for (const item of data) {
			if (item.data.kind !== "offer" || !item.applicationId) continue;
			const at = new Date(item.createdAt).getTime();
			const known = hints.get(item.applicationId);
			if (!known || at > known.at) hints.set(item.applicationId, { respondBy: item.data.respondBy, at });
		}
		return hints;
	}, [data]);
}

/** What Next step knows of an application's offer: its hint, null when none is saved, undefined when unknown. */
export const offerHintFor = (hints: ReadonlyMap<string, OfferHint> | undefined, applicationId: string) =>
	hints ? (hints.get(applicationId) ?? null) : undefined;

/**
 * The toast after a stage move. Reaching Offer offers "Add the offer's terms", which opens the offer form on the
 * application's Messages tab.
 */
export function useStageMovedToast() {
	const router = useRouter();
	return (application: Pick<ApplicationSummary, "id">, lane: ApplicationLane) =>
		showToast({
			message: t`Moved to ${getLaneLabel(lane)}`,
			...(lane.category === "offer"
				? {
						action: {
							label: t`Add the offer's terms`,
							onPress: () =>
								router.push({ pathname: routes.application(application.id, "messages"), params: { offer: "new" } }),
						},
					}
				: {}),
		});
}

/**
 * After an offer is accepted: offer to close the other open applications as "Accepted another offer". Nothing closes
 * unless that's chosen, and the close itself has Undo.
 */
export function useAcceptedPrompt() {
	const queryClient = useQueryClient();
	const session = useSession();
	const lanes = useApplicationLanes();
	const moveWithUndo = useMoveWithUndo();
	return (accepted: Pick<ApplicationSummary, "id">) => {
		const others = (
			queryClient.getQueryData<ApplicationSummary[]>(applicationsListQueryKey(session.server)) ?? []
		).filter((row) => row.id !== accepted.id && row.status !== "closed");
		if (others.length === 0) return showToast({ message: t`Closed as Accepted offer` });
		showToast({
			message: plural(others.length, {
				one: "Closed as Accepted offer. Close your other open application as Accepted another offer?",
				other: "Closed as Accepted offer. Close your # other open applications as Accepted another offer?",
			}),
			// A choice, not a notice: it stays long enough to read and decide.
			duration: 15_000,
			action: {
				label: plural(others.length, { one: "Close it", other: "Close all #" }),
				onPress: () =>
					moveWithUndo({
						applications: others,
						lane: resolveLane(lanes.lanes, { status: "closed" }),
						supported: lanes.supported,
						closedReason: "accepted-other",
						message: plural(others.length, {
							one: "# application closed as Accepted another offer",
							other: "# applications closed as Accepted another offer",
						}),
					}),
			},
		});
	};
}

/** An accepted offer reads as a win: the Offer colour with a check, not one more closed application. */
export function acceptedStage(
	lanes: readonly ApplicationLane[],
	application: Pick<ApplicationSummary, "status" | "closedReason">,
) {
	return application.status === "closed" && application.closedReason === "accepted"
		? { color: resolveLane(lanes, { status: "offer" }).color, label: getClosedReasonLabel("accepted") }
		: null;
}
