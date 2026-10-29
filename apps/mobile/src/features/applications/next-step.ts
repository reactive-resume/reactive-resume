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

export function getNextStep(
	application: NextStepSource,
	now = new Date(),
	lanes: readonly ApplicationLane[] = [],
): NextStep {
	if (application.status === "closed") return { kind: "closed" };

	const upcoming = application.activity
		.filter(isInterview)
		.map((interview) => ({ interview, at: new Date(interview.at) }))
		.filter(({ interview, at }) => at.getTime() + interview.durationMinutes * 60_000 >= now.getTime())
		.sort((a, b) => a.at.getTime() - b.at.getTime())[0];
	if (upcoming) return { kind: "interview", ...upcoming };

	if (application.followUpAt) {
		const at = new Date(application.followUpAt);
		return { kind: "follow-up", at, note: application.followUpNote ?? "", overdue: at.getTime() < now.getTime() };
	}

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
