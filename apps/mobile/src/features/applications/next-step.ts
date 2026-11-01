import type { ApplicationSummary as Application } from "./types";
import type { IconName } from "@/ui";
import type { NextStep } from "@reactive-resume/schema/applications/next-step";
export type { NextStep } from "@reactive-resume/schema/applications/next-step";
import type { ApplicationLane } from "@reactive-resume/schema/applications/lanes";
import { plural, t } from "@lingui/core/macro";
import { getNextStep as sharedGetNextStep } from "@reactive-resume/schema/applications/next-step";
import { laneSince } from "./history";
import { getClosedReasonLabel } from "./stages";

export {
	needsAttention,
	needsFollowUp,
	nextStepSortKey,
	compareNextStepSortKeys,
} from "@reactive-resume/schema/applications/next-step";

/** Lane residence remains distinct from the canonical-stage clock used by next steps. */
export const daysInStage = (
	application: Pick<Application, "status" | "activity" | "appliedAt" | "laneId">,
	now = new Date(),
	lanes: readonly ApplicationLane[] = [],
) => Math.max(0, Math.floor((now.getTime() - laneSince(application, lanes).getTime()) / 86_400_000));

/** Preserve native lane-aware callers while deriving canonical next steps through the shared contract. */
export function getNextStep(
	application: Parameters<typeof sharedGetNextStep>[0],
	now = new Date(),
	_lanes: readonly ApplicationLane[] = [],
	timeZone = "UTC",
): NextStep {
	return sharedGetNextStep(application, now, timeZone);
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
		case "interview-feedback":
			return {
				icon: "hourglass",
				title: t`Waiting for interview feedback`,
				sub: plural(step.days, { one: "For # day", other: "For # days" }),
				tone: "normal",
			};
		case "no-interview":
			return {
				icon: "calendar-dot",
				title: t`No interview scheduled`,
				sub: t`Add the date when you have it`,
				tone: "normal",
			};
		case "offer":
			return {
				icon: "scales",
				title: t`Decide on the offer`,
				sub: plural(step.days, { one: "For # day", other: "For # days" }),
				tone: "warn",
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
