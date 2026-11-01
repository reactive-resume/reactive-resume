import type { ApplicationSummary as Application } from "./types";
import type { IconName } from "@/ui";
import type { InterviewTimelineEntry } from "@reactive-resume/schema/applications/data";
import type { ApplicationLane } from "@reactive-resume/schema/applications/lanes";
import { plural, t } from "@lingui/core/macro";
import { categorySince, laneSince } from "./history";
import { getClosedReasonLabel } from "./stages";

const isInterview = (entry: Application["activity"][number]): entry is InterviewTimelineEntry =>
	entry.type === "interview";

const DAY_MS = 86_400_000;

/** Days without a reply after applying before a follow-up is suggested. */
const FOLLOW_UP_AFTER_DAYS = 10;

type NextStepSource = Pick<Application, "status" | "activity" | "followUpAt" | "followUpNote" | "appliedAt" | "laneId">;

/**
 * What an application needs next, derived rather than stored: the earliest interview still to come, else the
 * follow-up date, else how long it has been waiting. Closed applications need nothing.
 */
export type NextStep =
	| { kind: "interview"; interview: InterviewTimelineEntry; at: Date }
	/** At Offer the offer leads: its reply deadline, deciding on saved terms, or saving the terms first. */
	| { kind: "offer"; respondBy: Date | null; overdue: boolean; terms: boolean }
	| { kind: "follow-up"; at: Date; note: string; overdue: boolean }
	| { kind: "no-reply"; days: number }
	| { kind: "waiting"; days: number }
	| { kind: "not-applied" }
	| { kind: "closed" };

const daysBetween = (from: Date, to: Date) => Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));

/** Whole days the application has spent in its current stage. */
export const daysInStage = (
	application: Pick<Application, "status" | "activity" | "appliedAt" | "laneId">,
	now = new Date(),
	lanes: readonly ApplicationLane[] = [],
) => daysBetween(laneSince(application, lanes), now);

/**
 * What's known of an application's newest saved offer: its reply deadline. `null` means no offer is saved yet;
 * leaving it out means it isn't known here (the step then reads as deciding on the offer).
 */
export type OfferHint = { respondBy: string | null };

export function getNextStep(
	application: NextStepSource,
	now = new Date(),
	lanes: readonly ApplicationLane[] = [],
	offer?: OfferHint | null | undefined,
): NextStep {
	if (application.status === "closed") return { kind: "closed" };

	const followUp = () => {
		if (!application.followUpAt) return null;
		const at = new Date(application.followUpAt);
		return {
			kind: "follow-up" as const,
			at,
			note: application.followUpNote ?? "",
			overdue: at.getTime() < now.getTime(),
		};
	};

	// An interview booked before the offer doesn't come next any more: the offer's reply deadline does, then a
	// follow-up set for it, then deciding on (or saving) its terms.
	if (application.status === "offer") {
		const respondBy = offer?.respondBy ? new Date(offer.respondBy) : null;
		if (!respondBy) {
			const step = followUp();
			if (step) return step;
		}
		return {
			kind: "offer",
			respondBy,
			overdue: respondBy ? respondBy.getTime() < now.getTime() : false,
			terms: offer !== null,
		};
	}

	const upcoming = application.activity
		.filter(isInterview)
		.map((interview) => ({ interview, at: new Date(interview.at) }))
		.filter(({ interview, at }) => at.getTime() + interview.durationMinutes * 60_000 >= now.getTime())
		.sort((a, b) => a.at.getTime() - b.at.getTime())[0];
	if (upcoming) return { kind: "interview", ...upcoming };

	const step = followUp();
	if (step) return step;

	if (application.status === "saved") return { kind: "not-applied" };

	const days =
		application.status === "applied"
			? daysBetween(categorySince(application), now)
			: daysInStage(application, now, lanes);
	if (application.status === "applied" && days >= FOLLOW_UP_AFTER_DAYS) return { kind: "no-reply", days };
	return { kind: "waiting", days };
}

export type NextStepText = { icon: IconName; title: string; sub: string; tone: "normal" | "warn" | "muted" };

const formatWhen = (date: Date, locale: string, timeZone: string, withTime: boolean) =>
	date.toLocaleString(locale, {
		timeZone,
		weekday: "short",
		day: "numeric",
		month: "short",
		...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
	});

/** How a next step reads in the list, on cards and in the detail sheet, on the user's clock (`useUserTime`). */
export function describeNextStep(
	step: NextStep,
	application: Pick<Application, "status" | "closedReason">,
	locale: string,
	timeZone: string,
): NextStepText {
	switch (step.kind) {
		case "interview": {
			const kind = {
				screening: t`Screening`,
				technical: t`Technical`,
				behavioral: t`Behavioral`,
				onsite: t`Onsite`,
				other: t`Other`,
			}[step.interview.kind];
			const where = step.interview.location ? ` · ${step.interview.location}` : "";
			return {
				icon: "calendar-dot",
				title: t`${kind} interview`,
				sub: `${formatWhen(step.at, locale, timeZone, true)}${where}`,
				tone: "normal",
			};
		}
		case "offer":
			return step.respondBy
				? {
						icon: step.overdue ? "clock" : "calendar-dot",
						title: t`Reply to the offer`,
						sub: t`By ${formatWhen(step.respondBy, locale, timeZone, true)}`,
						tone: step.overdue ? "warn" : "normal",
					}
				: step.terms
					? { icon: "scales", title: t`Decide on the offer`, sub: t`Compare it with your other offers`, tone: "normal" }
					: {
							icon: "scales",
							title: t`Add the offer's terms`,
							sub: t`Pay, deadline and conditions, so you can compare and decide`,
							tone: "normal",
						};
		case "follow-up":
			return {
				icon: step.overdue ? "clock" : "calendar-dot",
				title: step.note || t`Follow up`,
				sub: formatWhen(step.at, locale, timeZone, false),
				tone: step.overdue ? "warn" : "normal",
			};
		case "no-reply":
			return {
				icon: "clock",
				title: plural(step.days, { one: "No reply in # day", other: "No reply in # days" }),
				sub: t`A short follow-up is usually fine now`,
				tone: "warn",
			};
		case "waiting":
			return application.status === "applied"
				? {
						icon: "hourglass",
						title:
							step.days === 0
								? t`Applied today`
								: plural(step.days, { one: "Applied # day ago", other: "Applied # days ago" }),
						sub: "",
						tone: "normal",
					}
				: {
						icon: "hourglass",
						title: t`Waiting to hear back`,
						sub: plural(step.days, { one: "For # day", other: "For # days" }),
						tone: "normal",
					};
		case "not-applied":
			return { icon: "bookmark-simple", title: t`Not applied yet`, sub: "", tone: "muted" };
		case "closed":
			return {
				icon: "check",
				title: application.closedReason ? getClosedReasonLabel(application.closedReason) : t`Closed`,
				sub: "",
				tone: "muted",
			};
	}
}
