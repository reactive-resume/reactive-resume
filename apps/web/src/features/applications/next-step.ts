import type { ApplicationSummary } from "./types";
import type { ApplicationStageSource, NextStep } from "@reactive-resume/schema/applications/next-step";
export type { NextStep } from "@reactive-resume/schema/applications/next-step";
import type { IconName } from "@reactive-resume/ui/components/icon";
import { plural, t } from "@lingui/core/macro";
import { interviewKindOf } from "./interviews";
import { isCurrentLaneEvent } from "./lanes";
import { getClosedReasonLabel } from "./stages";

type StageSource = ApplicationStageSource & {
	laneId?: string | null | undefined;
};

export {
	getNextStep,
	needsAttention,
	needsFollowUp,
	nextStepSortKey,
	compareNextStepSortKeys,
} from "@reactive-resume/schema/applications/next-step";

/** Whole days in the current lane, including lane-only moves. */
export const daysInLane = (application: StageSource, now = new Date()) => {
	const entries = application.activity
		.filter((entry) => isCurrentLaneEvent(entry, application))
		.map((entry) => new Date(entry.at).getTime());
	return Math.max(
		0,
		Math.floor(
			(now.getTime() - (entries.length ? Math.max(...entries) : new Date(application.appliedAt).getTime())) /
				86_400_000,
		),
	);
};

export type NextStepText = { icon: IconName; title: string; sub: string; tone: "normal" | "warn" | "muted" };

const formatWhen = (date: Date, locale: string, timeZone: string, withTime: boolean) =>
	date.toLocaleString(locale, {
		weekday: "short",
		day: "numeric",
		month: "short",
		// Follow-ups retain the browser-local calendar date used by their date-only editor.
		...(withTime ? { timeZone, hour: "2-digit", minute: "2-digit" } : {}),
	});

/** How a next step reads in the list, on cards and in the detail sheet. */
export function describeNextStep(
	step: NextStep,
	application: Pick<ApplicationSummary, "status" | "closedReason">,
	locale: string,
	timeZone: string,
): NextStepText {
	switch (step.kind) {
		case "interview": {
			const kind = interviewKindOf(step.interview.kind)?.label ?? step.interview.kind;
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
