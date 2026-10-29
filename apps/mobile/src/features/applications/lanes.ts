import type { ApplicationStatus, ApplicationTimelineEntry } from "@reactive-resume/schema/applications/data";
import type { ApplicationLane } from "@reactive-resume/schema/applications/lanes";
import {
	createDefaultApplicationLanes,
	getActiveApplicationLanes,
	getApplicationLane,
} from "@reactive-resume/schema/applications/lanes";
import { getStageLabel } from "./stages";

export { createDefaultApplicationLanes, getActiveApplicationLanes };
export type { ApplicationLane };

export const getLaneLabel = (lane: ApplicationLane) => lane.label ?? getStageLabel(lane.category);

/** Missing/retired metadata must never hide an application while settings refresh. */
export const resolveLane = getApplicationLane;

export function getLaneHistoryLabel(
	lanes: ApplicationLane[],
	entry: Extract<ApplicationTimelineEntry, { type: "stage" }>,
) {
	if (entry.laneLabel !== undefined) return entry.laneLabel ?? getStageLabel(entry.stage);
	return entry.laneId
		? getLaneLabel(resolveLane(lanes, { status: entry.stage, laneId: entry.laneId }))
		: getStageLabel(entry.stage);
}

/** Old servers must receive canonical writes, never a payload they might silently strip. */
export const laneInput = (lane: ApplicationLane, supported: boolean) =>
	supported
		? { laneId: lane.id }
		: { status: lane.category, ...(lane.closedReason ? { closedReason: lane.closedReason } : {}) };

export function visibleLanes(
	lanes: ApplicationLane[],
	applications: readonly { status: ApplicationStatus; laneId?: string | null | undefined }[],
) {
	const visible = new Map(getActiveApplicationLanes(lanes).map((lane) => [lane.id, lane]));
	for (const application of applications) {
		const lane = resolveLane(lanes, application);
		if (!visible.has(lane.id)) visible.set(lane.id, lane);
	}
	return [...visible.values()];
}

export function nextActiveLane(
	lanes: ApplicationLane[],
	application: { status: ApplicationStatus; laneId?: string | null | undefined },
) {
	if (application.status === "closed") return null;
	const active = getActiveApplicationLanes(lanes);
	const current = resolveLane(lanes, application);
	const index = active.findIndex((lane) => lane.id === current.id);
	return index < 0 ? null : (active.slice(index + 1).find((lane) => lane.category !== "closed") ?? null);
}

export const compatibleReplacements = (lanes: ApplicationLane[], retiring: ApplicationLane) =>
	getActiveApplicationLanes(lanes).filter(
		(lane) =>
			lane.id !== retiring.id && lane.category === retiring.category && lane.closedReason === retiring.closedReason,
	);

/** Only protocol-level absence is evidence of an older backend. */
export function unsupportedLaneApi(error: unknown): boolean {
	if (!error || typeof error !== "object" || !("code" in error)) return false;
	return error.code === "NOT_FOUND" || error.code === "METHOD_NOT_SUPPORTED";
}
