import type { OfferHint } from "./next-step";
import type { ApplicationSummary } from "./types";
import type { InterviewTimelineEntry } from "@reactive-resume/schema/applications/data";
import { t } from "@lingui/core/macro";
import { interviewEvent } from "@reactive-resume/schema/applications/calendar";
import { followUpInstant } from "@reactive-resume/schema/applications/follow-up";
import { toast } from "@reactive-resume/ui/components/toast";
import { downloadWithAnchor } from "@reactive-resume/utils/file";
import { buildIcs } from "@reactive-resume/utils/ics";
import { dayKey } from "./interviews";
import { getAccountGeneration } from "@/libs/auth/account-scope";

type CalendarApplication = { company: string; role: string };

export function interviewCalendarAction(
	application: CalendarApplication,
	interview: InterviewTimelineEntry,
	method: "PUBLISH" | "CANCEL",
	generation: number,
) {
	return {
		children: method === "CANCEL" ? t`Download cancellation` : t`Update your calendar`,
		onClick: () => {
			if (generation !== getAccountGeneration()) return;
			const title = t`Interview · ${application.role}, ${application.company}`;
			const ics = buildIcs(interviewEvent(interview, title), new Date(), method);
			const date = dayKey(new Date(interview.at), interview.timezone);
			const name = `${application.company}-${date}${method === "CANCEL" ? "-cancelled" : ""}.ics`.replace(
				/[^\w.-]+/g,
				"-",
			);
			downloadWithAnchor(new Blob([ics], { type: "text/calendar" }), name);
		},
	};
}

export function showInterviewCancellation(
	application: CalendarApplication,
	interview: InterviewTimelineEntry,
	generation: number,
) {
	if (generation !== getAccountGeneration()) return;
	toast.add({
		type: "success",
		description: t`Interview deleted`,
		actionProps: interviewCalendarAction(application, interview, "CANCEL", generation),
	});
}

/** Something with a date on the Applications calendar: an interview, a follow-up or an offer's reply deadline. */
export type CalendarEntry = {
	id: string;
	application: ApplicationSummary;
	at: Date;
	/** Behind us: an interview that has ended. A follow-up or deadline that has passed is `overdue` instead. */
	past: boolean;
	overdue: boolean;
} & ({ kind: "interview"; interview: InterviewTimelineEntry; end: Date } | { kind: "follow-up" } | { kind: "offer" });

/**
 * Everything with a date across the given applications, soonest first: every interview, each open application's
 * follow-up, and the reply deadline of each application at Offer (from its newest saved offer).
 */
export function collectCalendarEntries(
	applications: readonly ApplicationSummary[],
	offers: ReadonlyMap<string, OfferHint> | undefined,
	now: Date,
	timeZone: string,
): CalendarEntry[] {
	const entries: CalendarEntry[] = [];
	for (const application of applications) {
		for (const interview of application.activity) {
			if (interview.type !== "interview") continue;
			const at = new Date(interview.at);
			const end = new Date(at.getTime() + interview.durationMinutes * 60_000);
			entries.push({
				id: interview.id,
				kind: "interview",
				application,
				interview,
				at,
				end,
				past: end.getTime() < now.getTime(),
				overdue: false,
			});
		}
		if (application.status === "closed") continue;
		const followUp = followUpInstant(application, timeZone);
		if (followUp)
			entries.push({
				id: `${application.id}-follow-up`,
				kind: "follow-up",
				application,
				at: followUp,
				past: false,
				overdue: followUp.getTime() < now.getTime(),
			});
		const respondBy = application.status === "offer" ? offers?.get(application.id)?.respondBy : null;
		if (respondBy) {
			const at = new Date(respondBy);
			entries.push({
				id: `${application.id}-offer`,
				kind: "offer",
				application,
				at,
				past: false,
				overdue: at.getTime() < now.getTime(),
			});
		}
	}
	return entries.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** The weeks a month touches, Monday first, as UTC civil days: five or six rows, never a row of another month. */
export function monthWeeks(month: Date): Date[] {
	const first = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
	const offset = (first.getUTCDay() + 6) % 7;
	const days = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
	return Array.from(
		{ length: Math.ceil((offset + days) / 7) * 7 },
		(_, index) => new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1 - offset + index)),
	);
}
