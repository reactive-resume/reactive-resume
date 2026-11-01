import type { ApplicationStatus, ApplicationTimelineEntry, InterviewTimelineEntry } from "./data";
import { followUpInstant } from "./follow-up";

const DAY_MS = 86_400_000;
const FOLLOW_UP_AFTER_DAYS = 10;

export type ApplicationStageSource = {
	status: ApplicationStatus;
	activity: readonly ApplicationTimelineEntry[];
	appliedAt: Date | string;
};
type NextStepSource = ApplicationStageSource & {
	followUpAt: Date | string | null;
	followUpNote: string | null;
	followUpDateOnly?: boolean | undefined;
};

/**
 * What an application needs next: an offer decision or deadline at Offer; otherwise the earliest upcoming
 * interview, follow-up date, then what its stage awaits. Closed applications need nothing.
 */
export type OfferHint = { respondBy: string | null };

export type NextStep =
	| { kind: "interview"; interview: InterviewTimelineEntry; at: Date }
	| { kind: "follow-up"; at: Date; note: string; overdue: boolean }
	| { kind: "no-reply"; days: number }
	| { kind: "waiting"; days: number }
	/** Interview stage with every recorded interview behind it: the employer's answer is due. */
	| { kind: "interview-feedback"; days: number }
	/** Interview stage with no interview recorded yet. */
	| { kind: "no-interview"; days: number }
	/** Offer stage: the user decides. */
	| { kind: "offer"; days: number; respondBy: Date | null; overdue: boolean; terms: boolean }
	| { kind: "not-applied" }
	| { kind: "closed" };

/** The latest canonical category entry. Lane-only moves never restart the employer-reply clock. */
export function applicationStageSince(application: ApplicationStageSource): Date {
	const entries = application.activity.filter(
		(entry) => entry.type === "stage" && entry.stage === application.status && entry.canonicalTransition !== false,
	);
	return new Date(
		entries.length ? Math.max(...entries.map((entry) => new Date(entry.at).getTime())) : application.appliedAt,
	);
}

const daysBetween = (from: Date, to: Date) => Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));

/** Whole days since the application entered its current stage; moving between lanes of that stage doesn't count. */
const daysInStage = (application: ApplicationStageSource, now: Date) =>
	daysBetween(applicationStageSince(application), now);

export function getNextStep(
	application: NextStepSource,
	now = new Date(),
	timeZone = "UTC",
	offer?: OfferHint | null,
): NextStep {
	if (application.status === "closed") return { kind: "closed" };
	if (application.status === "offer") {
		if (!offer?.respondBy && application.followUpAt) {
			const at = followUpInstant(application, timeZone) ?? new Date(application.followUpAt);
			return { kind: "follow-up", at, note: application.followUpNote ?? "", overdue: at.getTime() < now.getTime() };
		}
		const respondBy = offer?.respondBy ? new Date(offer.respondBy) : null;
		return {
			kind: "offer",
			days: daysInStage(application, now),
			respondBy,
			overdue: respondBy !== null && respondBy.getTime() < now.getTime(),
			terms: offer !== null,
		};
	}

	const upcoming = application.activity
		.filter((entry): entry is InterviewTimelineEntry => entry.type === "interview")
		.map((interview) => ({ interview, at: new Date(interview.at) }))
		.filter(({ interview, at }) => at.getTime() + interview.durationMinutes * 60_000 >= now.getTime())
		.sort((a, b) => a.at.getTime() - b.at.getTime())[0];
	if (upcoming) return { kind: "interview", ...upcoming };

	if (application.followUpAt) {
		const at = followUpInstant(application, timeZone) ?? new Date(application.followUpAt);
		return { kind: "follow-up", at, note: application.followUpNote ?? "", overdue: at.getTime() < now.getTime() };
	}

	if (application.status === "saved") return { kind: "not-applied" };

	const days = daysInStage(application, now);
	if (application.status === "applied" && days >= FOLLOW_UP_AFTER_DAYS) return { kind: "no-reply", days };
	if (application.status === "interview") {
		const since = applicationStageSince(application).getTime();
		const feedbackDue = application.activity.some(
			(entry) => entry.type === "interview" && new Date(entry.at).getTime() >= since,
		);
		return feedbackDue ? { kind: "interview-feedback", days } : { kind: "no-interview", days };
	}
	return { kind: "waiting", days };
}

/** Interviews this close count as needing the user now (preparation), not just as coming up. */
const INTERVIEW_ATTENTION_MS = 7 * DAY_MS;

/**
 * Whether a next step needs the user: an interview within a week, a follow-up due within a day or overdue, no reply
 * after ten days, or an offer to decide. Career → Today and the Applications banner both read this.
 */
export function needsAttention(step: NextStep, now = new Date()): boolean {
	switch (step.kind) {
		case "interview":
			return step.at.getTime() - now.getTime() <= INTERVIEW_ATTENTION_MS;
		case "follow-up":
			return step.at.getTime() - now.getTime() <= DAY_MS;
		case "no-reply":
		case "offer":
			return true;
		default:
			return false;
	}
}

/** A follow-up the user owes: one that is due, or a reply that's ten days late. */
export const needsFollowUp = (step: NextStep, now = new Date()) =>
	(step.kind === "follow-up" || step.kind === "no-reply") && needsAttention(step, now);

/**
 * Sort key for "Next step": dated steps first, soonest first; then the rest by when they entered their stage, so the
 * longest wait comes first. Compare the rank, then the time; callers break ties by ID so the order is stable.
 */
export function nextStepSortKey(
	application: NextStepSource,
	now = new Date(),
	timeZone = "UTC",
	offer?: OfferHint | null,
): [rank: number, time: number] {
	const step = getNextStep(application, now, timeZone, offer);
	if (step.kind === "interview" || step.kind === "follow-up") return [0, step.at.getTime()];
	if (step.kind === "offer" && step.respondBy) return [0, step.respondBy.getTime()];
	return [1, applicationStageSince(application).getTime()];
}

/** Stable ordering shared by both lists and Today; reversing the date order keeps ID ties stable. */
export function compareNextStepSortKeys(
	a: readonly [number, number],
	b: readonly [number, number],
	aId: string,
	bId: string,
	direction: "asc" | "desc" = "asc",
) {
	return (direction === "asc" ? 1 : -1) * (a[0] - b[0] || a[1] - b[1]) || aId.localeCompare(bId);
}
