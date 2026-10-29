import type { ApplicationClosedReason, ApplicationStatus } from "@reactive-resume/schema/applications/data";
import { t } from "@lingui/core/macro";
import { STAGES } from "@reactive-resume/schema/applications/data";

/** The standard stages an application moves through; closed ends it from any of them. Lanes map onto these. */
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
		screening: t`Screening`,
		interview: t`Interview`,
		offer: t`Offer`,
		closed: t`Closed`,
	})[status];

export const getStageColor = (status: ApplicationStatus) =>
	STAGES.find((stage) => stage.value === status)?.color ?? "var(--ink-3)";

export const getClosedReasonLabel = (reason: ApplicationClosedReason) =>
	({
		accepted: t`Accepted offer`,
		"not-selected": t`Not selected`,
		withdrew: t`I withdrew`,
		"accepted-other": t`Accepted another offer`,
		"no-response": t`No response`,
	})[reason];
