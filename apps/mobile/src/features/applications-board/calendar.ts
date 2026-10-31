// Calendar maths for interviews and follow-ups. Days are calendar dates ("2026-10-19") on the user's clock (their
// profile timezone), not the device's, so an interview lands on the same day as the detail screen shows it.
// Pure: Node runs it in the M5-T3 scenarios.
import type { ApplicationSummary as Application } from "../applications/types";
import type { InterviewTimelineEntry } from "@reactive-resume/schema/applications/data";
import { followUpInstant } from "@reactive-resume/schema/applications/follow-up";
import { zonedParts } from "../reminders/schedule.ts";

const DAY_MS = 86_400_000;

export type CalendarEvent =
	| {
			kind: "interview";
			id: string;
			application: Application;
			interview: InterviewTimelineEntry;
			start: Date;
			end: Date;
			day: string;
	  }
	| { kind: "follow-up"; id: string; application: Application; start: Date; day: string };

export type GridDay = { key: string; day: number; inMonth: boolean };

/** The calendar date of an instant on a clock in `timeZone`. */
export const dayKeyOf = (instant: Date | string, timeZone: string) => zonedParts(instant, timeZone).date;

/** A follow-up is an instant, grouped on the account clock like its Today reminder. */
export const followUpDay = (followUpAt: Date | string, timeZone: string, followUpDateOnly?: boolean) =>
	dayKeyOf(followUpInstant({ followUpAt, followUpDateOnly }, timeZone) ?? followUpAt, timeZone);

/** Interviews and follow-ups of open applications, soonest first. Closed applications stay off the calendar. */
export function collectEvents(applications: readonly Application[], timeZone: string): CalendarEvent[] {
	const events: CalendarEvent[] = [];
	for (const application of applications) {
		if (application.status === "closed") continue;
		for (const entry of application.activity) {
			if (entry.type !== "interview") continue;
			const start = new Date(entry.at);
			events.push({
				kind: "interview",
				id: `interview:${entry.id}`,
				application,
				interview: entry,
				start,
				end: new Date(start.getTime() + entry.durationMinutes * 60_000),
				day: dayKeyOf(start, timeZone),
			});
		}
		if (application.followUpAt) {
			events.push({
				kind: "follow-up",
				id: `follow-up:${application.id}`,
				application,
				start: followUpInstant(application, timeZone) ?? new Date(application.followUpAt),
				day: followUpDay(application.followUpAt, timeZone, application.followUpDateOnly),
			});
		}
	}
	return events.sort((a, b) => a.day.localeCompare(b.day) || a.start.getTime() - b.start.getTime());
}

export function groupByDay(events: readonly CalendarEvent[]) {
	const map = new Map<string, CalendarEvent[]>();
	for (const event of events) map.set(event.day, [...(map.get(event.day) ?? []), event]);
	return map;
}

/** Interviews that haven't ended and follow-ups from today on. */
export const upcomingEvents = (events: readonly CalendarEvent[], now: Date, today: string) =>
	events.filter((event) => (event.kind === "interview" ? event.end.getTime() >= now.getTime() : event.day >= today));

const pad = (value: number) => String(value).padStart(2, "0");
const keyOf = (date: Date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

/** A calendar date as a UTC midnight Date, for date arithmetic and formatting with `timeZone: "UTC"`. */
export const dateOfKey = (key: string) => new Date(`${key}T00:00:00Z`);

/** Six weeks (42 days) covering the month (`month` 0–11), starting on `weekStartsOn` (0 = Sunday). */
export function monthGrid(year: number, month: number, weekStartsOn: number): GridDay[] {
	const first = Date.UTC(year, month, 1);
	const offset = (new Date(first).getUTCDay() - weekStartsOn + 7) % 7;
	return Array.from({ length: 42 }, (_, i) => {
		const date = new Date(first + (i - offset) * DAY_MS);
		return { key: keyOf(date), day: date.getUTCDate(), inMonth: date.getUTCMonth() === month };
	});
}

export const shiftMonth = (year: number, month: number, delta: number) => {
	const date = new Date(Date.UTC(year, month + delta, 1));
	return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
};

/** The locale's first day of the week (0 = Sunday) where Intl knows it; Monday otherwise, as the mockups. */
export function weekStartsOn(locale: string) {
	try {
		const info = new Intl.Locale(locale) as Intl.Locale & {
			getWeekInfo?: () => { firstDay: number };
			weekInfo?: { firstDay: number };
		};
		const firstDay = info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay;
		return firstDay ? firstDay % 7 : 1;
	} catch {
		return 1;
	}
}
