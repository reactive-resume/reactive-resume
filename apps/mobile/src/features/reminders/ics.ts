import type { CalendarEvent } from "@reactive-resume/utils/ics";
export { buildIcs } from "@reactive-resume/utils/ics";
export type { CalendarEvent } from "@reactive-resume/utils/ics";

/** A file name safe on every platform: "Fieldnote-interview-2026-10-19.ics". */
export const icsFileName = (company: string, day: string) => `${company}-${day}.ics`.replace(/[^\w.-]+/g, "-");

export { interviewEvent } from "@reactive-resume/schema/applications/calendar";

/** A follow-up as a 30-minute calendar event. */
export const followUpEvent = (applicationId: string, start: Date, title: string): CalendarEvent => ({
	uid: `follow-up-${applicationId}`,
	title,
	start,
	end: new Date(start.getTime() + 30 * 60_000),
});
