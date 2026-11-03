import type { CalendarEvent } from "@reactive-resume/utils/ics";

type InterviewForEvent = {
	id: string;
	at: Date | string;
	durationMinutes: number;
	location: string;
	notes: string;
	participants?: readonly { name: string; role?: string | undefined }[] | undefined;
};

/** An interview as a calendar event: who you'll meet, then the notes, and a reminder an hour before (as on web). */
export const interviewEvent = (interview: InterviewForEvent, title: string): CalendarEvent => {
	const start = new Date(interview.at);
	return {
		uid: interview.id,
		title,
		start,
		end: new Date(start.getTime() + interview.durationMinutes * 60_000),
		alarmMinutes: 60,
		...(interview.location ? { location: interview.location } : {}),
		...((description) => (description ? { description } : {}))(
			[
				(interview.participants ?? [])
					.map((person) => [person.name, person.role].filter(Boolean).join(", "))
					.join("\n"),
				interview.notes,
			]
				.filter(Boolean)
				.join("\n\n"),
		),
	};
};
