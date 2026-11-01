import type { ApplicationTimelineEntry } from "@reactive-resume/schema/applications/data";
import type { ApplicationClosedReason, ApplicationStatus } from "@reactive-resume/schema/applications/data";
import type { ApplicationLane } from "@reactive-resume/schema/applications/lanes";
import { getActiveApplicationLanes, getApplicationLane } from "@reactive-resume/schema/applications/lanes";
import { getClosedReasonLabel, getStageLabel } from "./stages";

export type { ApplicationLane };

type LaneSource = { status: ApplicationStatus; laneId?: string | null | undefined };

/** A lane's name: the owner's label, or the translated default for its category. */
export const getLaneLabel = (lane: Pick<ApplicationLane, "label" | "category">) =>
	lane.label ?? getStageLabel(lane.category);

/** The lane an application shows in: its own lane, else its category's default. Never a retired lane. */
export function getDisplayLane(lanes: readonly ApplicationLane[], application: LaneSource): ApplicationLane {
	const lane = getApplicationLane(lanes, application);
	if (!lane.retiredAt) return lane;
	return getApplicationLane(lanes, { status: application.status });
}

/**
 * How an application's stage reads: its lane's name and colour, except an accepted offer, which is a win and keeps the
 * Offer colour with a check rather than reading as one more closed application.
 */
export function getStageDisplay(
	lanes: readonly ApplicationLane[],
	application: LaneSource & { closedReason?: ApplicationClosedReason | null | undefined },
) {
	if (application.status === "closed" && application.closedReason === "accepted")
		return { color: getCategoryLane(lanes, "offer").color, label: getClosedReasonLabel("accepted"), accepted: true };
	const lane = getDisplayLane(lanes, application);
	return { color: lane.color, label: getLaneLabel(lane), accepted: false };
}

/** The default lane of a category, where legacy writes land. */
export const getCategoryLane = (lanes: readonly ApplicationLane[], category: ApplicationStatus) =>
	getApplicationLane(lanes, { status: category });

/** The next active lane in the configured order, skipping Closed ones; null at the end. */
export function getNextLane(lanes: readonly ApplicationLane[], current: ApplicationLane): ApplicationLane | null {
	const open = getActiveApplicationLanes(lanes).filter((lane) => lane.category !== "closed");
	const index = open.findIndex((lane) => lane.id === current.id);
	return index === -1 ? null : (open[index + 1] ?? null);
}

/**
 * A stage event that started this application's current lane. Events with a lane compare lanes; older events without
 * one compare the canonical stage.
 */
export function isCurrentLaneEvent(entry: ApplicationTimelineEntry, application: LaneSource) {
	if (entry.type !== "stage") return false;
	if (entry.laneId) return entry.laneId === application.laneId;
	return entry.stage === application.status;
}

/** False for a lane move within one category: it changes the column, not where the application stands. */
export const isCanonicalStageEvent = (entry: ApplicationTimelineEntry) =>
	entry.type === "stage" && entry.canonicalTransition !== false;

export type LaneMode = "lanes" | "legacy";

/** What to send to move to a lane: its ID with lanes, its category on older servers. */
export function laneMoveInput(lane: ApplicationLane, mode: LaneMode, closedReason?: ApplicationClosedReason | null) {
	return {
		...(mode === "lanes" ? { laneId: lane.id } : { status: lane.category }),
		...(closedReason !== undefined ? { closedReason } : lane.closedReason ? { closedReason: lane.closedReason } : {}),
	};
}

/** Hex colors offered when choosing a lane's color. */
export const LANE_COLORS = [
	"#8D8C80",
	"#578BC7",
	"#319FA8",
	"#BB9135",
	"#449D70",
	"#C36B5C",
	"#8B6CC7",
	"#C7619A",
	"#5C7A99",
	"#7A8C3A",
] as const;
