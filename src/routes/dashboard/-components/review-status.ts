import { t } from "@lingui/core/macro";

/**
 * The review stages a resume moves through, in workflow order.
 *
 * One list, used by every filter on the dashboard. Before this, the student table filtered on a
 * derived four-value status whose "submitted" case had no chip, so the stage most resumes are
 * actually in could not be filtered for at all; and the inbox was fed a hard-coded subset of
 * stages by its parent, so stages it knew how to group never reached it.
 */
export const REVIEW_STAGES = [
	"DRAFT",
	"SUBMITTED_TO_FACULTY",
	"FACULTY_REVISION_REQUESTED",
	"FACULTY_VERIFIED",
	"FINALIZED_BY_FACULTY",
	"SUBMITTED_TO_PO",
	"PO_REVISION_REQUESTED",
	"RESUBMITTED_TO_PO",
	"PO_VERIFIED",
	"APPROVED",
] as const;

export type ReviewStage = (typeof REVIEW_STAGES)[number];

/** Short label for a filter chip or badge. Falls back to the raw value for anything unrecognised. */
export function reviewStageLabel(stage: string): string {
	switch (stage) {
		case "DRAFT":
			return t`Draft`;
		case "SUBMITTED_TO_FACULTY":
			return t`Submitted`;
		case "FACULTY_REVISION_REQUESTED":
			return t`Revision Requested`;
		case "FACULTY_VERIFIED":
			return t`Faculty Verified`;
		case "FINALIZED_BY_FACULTY":
			return t`Finalized by Faculty`;
		case "SUBMITTED_TO_PO":
			return t`Submitted to PO`;
		case "PO_REVISION_REQUESTED":
			return t`PO: Revision Requested`;
		case "RESUBMITTED_TO_PO":
			return t`Resubmitted to PO`;
		case "PO_VERIFIED":
			return t`PO Verified`;
		case "APPROVED":
			return t`Approved`;
		default:
			return stage;
	}
}

/**
 * Stages that belong in a review queue.
 *
 * DRAFT is deliberately absent: it is the status every resume is created with and means the student
 * has never pressed Submit. Those resumes are waiting on the student, not on a reviewer, and on this
 * tenant they are the single largest group — leaving them in would bury the work that is genuinely
 * waiting. They stay reachable through the Draft chip and the Students tab.
 */
export const QUEUE_STAGES: readonly ReviewStage[] = REVIEW_STAGES.filter((s) => s !== "DRAFT");

/** Stages each role is expected to act on, listed first in that role's inbox. */
export const STAGES_FOR_SCOPE: Record<"faculty" | "po", readonly ReviewStage[]> = {
	faculty: ["SUBMITTED_TO_FACULTY", "FACULTY_REVISION_REQUESTED"],
	// The PO sees student submissions as they arrive, alongside what faculty forwards on.
	po: ["SUBMITTED_TO_FACULTY", "SUBMITTED_TO_PO", "RESUBMITTED_TO_PO"],
};

/** Reads a resume's stage, treating a missing value as DRAFT the way the database default does. */
export function stageOf(resume: { reviewStatus?: string | null }): string {
	return resume.reviewStatus ?? "DRAFT";
}

/**
 * How each stage reads to a given reviewer: in their queue, back with the student, or decided.
 *
 * The Placement Officer's queue is every stage a student has handed over and the PO has not yet
 * ruled on — not just the two "to PO" stages. On this tenant faculty verify but never forward, so
 * a queue defined as SUBMITTED_TO_PO + RESUBMITTED_TO_PO is empty by arithmetic and the Overview
 * reported the backlog as fully cleared.
 */
export const REVIEWER_STAGE_BUCKETS: Record<
	"faculty" | "po",
	{ waiting: readonly string[]; sentBack: readonly string[]; verified: readonly string[] }
> = {
	faculty: {
		waiting: ["SUBMITTED_TO_FACULTY"],
		sentBack: ["FACULTY_REVISION_REQUESTED"],
		verified: [
			"FACULTY_VERIFIED",
			"FINALIZED_BY_FACULTY",
			"SUBMITTED_TO_PO",
			"PO_REVISION_REQUESTED",
			"RESUBMITTED_TO_PO",
			"PO_VERIFIED",
		],
	},
	po: {
		waiting: [
			"SUBMITTED_TO_FACULTY",
			"FACULTY_VERIFIED",
			"FINALIZED_BY_FACULTY",
			"SUBMITTED_TO_PO",
			"RESUBMITTED_TO_PO",
		],
		// Back with the student, whoever sent it back. Neither is waiting on the PO.
		sentBack: ["FACULTY_REVISION_REQUESTED", "PO_REVISION_REQUESTED"],
		verified: ["PO_VERIFIED"],
	},
};
