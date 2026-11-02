import type { Colors, ColorToken } from "@/ui/tokens";
import type { ApplicationClosedReason, ApplicationStatus } from "@reactive-resume/schema/applications/data";
import { t } from "@lingui/core/macro";

/** The stages an application moves through; closed ends it from any of them. */
export const PIPELINE: readonly ApplicationStatus[] = ["saved", "applied", "screening", "interview", "offer"];

/** The list's group order: what needs you first, closed last. */
export const LIST_ORDER: readonly ApplicationStatus[] = [
	"interview",
	"offer",
	"screening",
	"applied",
	"saved",
	"closed",
];

export const CLOSED_REASONS: readonly ApplicationClosedReason[] = [
	"accepted",
	"not-selected",
	"withdrew",
	"accepted-other",
	"no-response",
];

export const getStageLabel = (status: ApplicationStatus) =>
	({
		saved: t`Saved`,
		applied: t`Applied`,
		screening: t({
			comment: "Application stage: the first recruiter screen after applying. Not the resume builder's Check mode.",
			message: "Screening",
		}),
		interview: t`Interview`,
		offer: t`Offer`,
		closed: t`Closed`,
	})[status];

export const STAGE_COLORS = {
	saved: "stageSaved",
	applied: "stageApplied",
	screening: "stageScreen",
	interview: "stageInterv",
	offer: "stageOffer",
	closed: "stageClosed",
} as const satisfies Record<ApplicationStatus, ColorToken>;

export const getStageColor = (status: ApplicationStatus, colors: Colors) => colors[STAGE_COLORS[status]];

export const getClosedReasonLabel = (reason: ApplicationClosedReason) =>
	({
		accepted: t`Accepted offer`,
		"not-selected": t`Not selected`,
		withdrew: t`I withdrew`,
		"accepted-other": t`Accepted another offer`,
		"no-response": t`No response`,
	})[reason];

/** The stage after this one in the pipeline, or null at Offer and for closed applications. */
export function getNextStage(status: ApplicationStatus): ApplicationStatus | null {
	const index = PIPELINE.indexOf(status);
	return index === -1 ? null : (PIPELINE[index + 1] ?? null);
}
