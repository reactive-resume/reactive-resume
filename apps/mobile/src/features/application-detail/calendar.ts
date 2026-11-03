import type { InterviewTimelineEntry } from "@reactive-resume/schema/applications/data";
import { t } from "@lingui/core/macro";
import { getAccountScope } from "@/auth/session";
import { icsFileName, interviewEvent, shareIcs, zonedParts } from "@/features/reminders";
import { showToast } from "@/ui";

type CalendarApplication = { company: string; role: string };

export function interviewCalendarAction(
	application: CalendarApplication,
	interview: InterviewTimelineEntry,
	method: "PUBLISH" | "CANCEL",
	scope: string | null,
) {
	return {
		label: method === "CANCEL" ? t`Download cancellation` : t`Update your calendar`,
		onPress: () => {
			if (!scope || scope !== getAccountScope()) return;
			const title = t`Interview · ${application.role}, ${application.company}`;
			const day = zonedParts(new Date(interview.at), interview.timezone).date;
			const name = icsFileName(application.company, `${day}${method === "CANCEL" ? "-cancelled" : ""}`);
			void shareIcs(interviewEvent(interview, title), name, method).catch(() => {
				if (scope === getAccountScope()) showToast({ message: t`Couldn't share the calendar file. Try again.` });
			});
		},
	};
}

export function showInterviewCancellation(
	application: CalendarApplication,
	interview: InterviewTimelineEntry,
	scope: string | null,
	message = t`Interview deleted`,
) {
	if (!scope || scope !== getAccountScope()) return;
	showToast({ message, action: interviewCalendarAction(application, interview, "CANCEL", scope) });
}
