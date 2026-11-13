import type { ApplicationSummary } from "./types";
import type { ApplicationStageSource, NextStep } from "@reactive-resume/schema/applications/next-step";
export type { NextStep, OfferHint } from "@reactive-resume/schema/applications/next-step";
import type { InterviewKind } from "@reactive-resume/schema/applications/data";
import type { IconName } from "@reactive-resume/ui/components/icon";
import { plural, t } from "@lingui/core/macro";
import { hasApplicationSubmission } from "@reactive-resume/schema/applications/data";
import { needsAttention } from "@reactive-resume/schema/applications/next-step";
import { applicationSentAt } from "@reactive-resume/schema/applications/outcomes";
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
	const entry = application.activity
		.filter((entry) => isCurrentLaneEvent(entry, application))
		.toSorted((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())[0];
	if (entry?.type === "stage" && entry.dateUnknown) return null;
	return Math.max(0, Math.floor((now.getTime() - new Date(entry?.at ?? application.appliedAt).getTime()) / 86_400_000));
};

export type NextStepText = { icon: IconName; title: string; sub: string; tone: "normal" | "warn" | "muted" };

const formatWhen = (date: Date, locale: string, timeZone: string, withTime: boolean) =>
	date.toLocaleString(locale, {
		weekday: "short",
		day: "numeric",
		month: "short",
		timeZone,
		...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
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
				title:
					step.after === "interview"
						? plural(step.days, {
								one: "No word since your interview # day ago",
								other: "No word since your interview # days ago",
							})
						: plural(step.days, { one: "No reply in # day", other: "No reply in # days" }),
				sub: t`A short follow-up is usually fine now`,
				tone: "warn",
			};
		case "waiting":
			return application.status === "applied"
				? {
						icon: "hourglass",
						title:
							step.days === null
								? t`Waiting to hear back`
								: step.days === 0
									? t`Applied today`
									: plural(step.days, { one: "Applied # day ago", other: "Applied # days ago" }),
						sub: "",
						tone: "normal",
					}
				: {
						icon: "hourglass",
						title: t`Waiting to hear back`,
						sub:
							step.days === null
								? ""
								: step.days === 0
									? t`Since today`
									: plural(step.days, { one: "For # day", other: "For # days" }),
						tone: "normal",
					};
		case "interview-feedback":
			return {
				icon: "hourglass",
				title: t`Waiting for interview feedback`,
				sub:
					step.days === null
						? ""
						: step.days === 0
							? t`Since today`
							: plural(step.days, { one: "For # day", other: "For # days" }),
				tone: "normal",
			};
		case "no-interview":
			return {
				icon: "calendar-dot",
				title: t`No interview scheduled`,
				sub: t`Add the date when you have it`,
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

/**
 * "Needs you" on Applications: a step the user owes (a due follow-up, a late reply, an offer to answer). An interview
 * this week is on the calendar; it is not something owed.
 */
export const needsYou = (step: NextStep, now = new Date()) => step.kind !== "interview" && needsAttention(step, now);

export type NextStepLine = {
	title: string;
	sub: string;
	/** The row wears the "Needs you" badge. */
	needsYou: boolean;
	/** Nothing to do: the title is quiet. */
	muted: boolean;
};

type LineSource = Pick<ApplicationSummary, "status" | "closedReason" | "createdAt" | "appliedAt" | "activity">;

/** "9 Nov", "Mon 9 Nov" or "Monday 9 Nov" in the account's timezone; always the 24-hour clock beside it. */
export function stepDate(date: Date | string, locale: string, timeZone: string, weekday?: "short" | "long") {
	return new Intl.DateTimeFormat(locale, { timeZone, weekday, day: "numeric", month: "short" }).format(new Date(date));
}
export function stepTime(date: Date | string, locale: string, timeZone: string) {
	return new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
		new Date(date),
	);
}

/** What an interview is called in a next step: "Screening call", "Technical interview". */
export const interviewStepTitle = (kind: InterviewKind) => {
	if (kind === "screening") return t`Screening call`;
	const label = interviewKindOf(kind)?.label ?? kind;
	return t`${label} interview`;
};

/**
 * The next step as the list and the board write it: what to do, then when. `weekday` is long in the list and short on
 * a board card.
 */
export function describeNextStepLine(
	step: NextStep,
	application: LineSource,
	locale: string,
	timeZone: string,
	now = new Date(),
	weekday: "short" | "long" = "long",
): NextStepLine {
	const day = (date: Date | string, withWeekday = false) =>
		stepDate(date, locale, timeZone, withWeekday ? weekday : undefined);
	const owed = needsYou(step, now);
	const sentAt = applicationSentAt({ ...application, resumeId: null });
	const sent = sentAt ? day(sentAt) : "";

	switch (step.kind) {
		case "interview":
			return {
				title: interviewStepTitle(step.interview.kind),
				sub: `${day(step.at, true)}, ${stepTime(step.at, locale, timeZone)}`,
				needsYou: false,
				muted: false,
			};
		case "follow-up": {
			const due = day(step.at, true);
			return {
				title: step.note || t`Send a follow-up`,
				sub: step.overdue ? (sent ? t`Overdue · applied ${sent}` : t`Overdue · was due ${due}`) : due,
				needsYou: owed,
				muted: false,
			};
		}
		case "no-reply":
			return {
				title: t`Send a follow-up`,
				sub:
					step.after === "interview"
						? plural(step.days, { one: "No word for # day", other: "No word for # days" })
						: plural(step.days, { one: "No reply in # day", other: "No reply in # days" }),
				needsYou: true,
				muted: false,
			};
		case "offer":
			if (step.respondBy) {
				const by = day(step.respondBy, true);
				return {
					title: t`Reply to the offer`,
					sub: step.overdue ? t`Overdue · was due ${by}` : t`By ${by}`,
					needsYou: true,
					muted: false,
				};
			}
			break;
		case "not-applied":
			return {
				title: t`Not applied yet`,
				sub: t`Saved ${day(application.createdAt)}`,
				needsYou: false,
				muted: true,
			};
		case "closed": {
			const closedAt = application.activity
				.filter((entry) => entry.type === "stage" && entry.stage === "closed" && !entry.dateUnknown)
				.toSorted((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())[0]?.at;
			const closed = closedAt ? day(closedAt) : "";
			return {
				title: application.closedReason ? getClosedReasonLabel(application.closedReason) : t`Closed`,
				sub: sent && closed ? t`Applied ${sent} · closed ${closed}` : closed ? t`Closed ${closed}` : "",
				needsYou: false,
				muted: true,
			};
		}
	}
	const text = describeNextStep(step, application, locale, timeZone);
	return { title: text.title, sub: text.sub, needsYou: owed, muted: text.tone === "muted" };
}

export type SentLine = { text: string; sent: boolean };

/** The Sent column in words: "Resume, letter · 2 Nov", or "Not sent" before the job is applied to. */
export function describeSent(
	application: LineSource & Pick<ApplicationSummary, "resumeId" | "coverLetterId" | "resumeFileUrl" | "coverLetterUrl">,
	locale: string,
	timeZone: string,
): SentLine {
	if (!hasApplicationSubmission(application)) return { text: t`Not sent`, sent: false };
	const resume = Boolean(application.resumeId || application.resumeFileUrl);
	const letter = Boolean(application.coverLetterId || application.coverLetterUrl);
	const what = resume && letter ? t`Resume, letter` : resume ? t`Resume` : letter ? t`Letter` : t`No documents`;
	const sentAt = applicationSentAt(application);
	return { text: sentAt ? `${what} · ${stepDate(sentAt, locale, timeZone)}` : what, sent: true };
}
