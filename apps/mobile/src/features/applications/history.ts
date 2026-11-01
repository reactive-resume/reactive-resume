import type { ApplicationSummary } from "./types";
import type { ApplicationLane } from "@reactive-resume/schema/applications/lanes";

type StageEntry = Extract<ApplicationSummary["activity"][number], { type: "stage" }>;

type HistorySource = Pick<ApplicationSummary, "status" | "activity" | "appliedAt" | "laneId">;

/** Lane-only history is useful for placement, never evidence of a submission or employer reply. */
export const canonicalStageEntries = (application: Pick<HistorySource, "activity">) =>
	application.activity.filter(
		(entry): entry is StageEntry => entry.type === "stage" && entry.canonicalTransition !== false,
	);

export function currentLaneEntry(application: HistorySource, lanes: readonly ApplicationLane[] = []) {
	const stages = application.activity
		.filter((entry): entry is StageEntry => entry.type === "stage" && entry.stage === application.status)
		.toSorted((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
	const latest = stages[0];
	// Retirement remaps the current reference without rewriting events or resetting residence time.
	if (latest?.laneId && lanes.some((lane) => lane.id === latest.laneId && lane.retiredAt)) return latest;
	const exact = application.laneId ? stages.filter((entry) => entry.laneId === application.laneId) : [];
	return exact[0] ?? stages.find((entry) => !entry.laneId) ?? latest;
}

export const laneSince = (application: HistorySource, lanes: readonly ApplicationLane[] = []) =>
	new Date(currentLaneEntry(application, lanes)?.at ?? application.appliedAt);

export { applicationStageSince as categorySince } from "@reactive-resume/schema/applications/next-step";
