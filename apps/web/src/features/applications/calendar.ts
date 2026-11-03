import type { InterviewTimelineEntry } from "@reactive-resume/schema/applications/data";
import { t } from "@lingui/core/macro";
import { interviewEvent } from "@reactive-resume/schema/applications/calendar";
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
