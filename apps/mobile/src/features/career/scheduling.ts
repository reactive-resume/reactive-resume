import type { ApplicationSummary as Application } from "@/features/applications/types";
import { fromZonedDateTime } from "@reactive-resume/utils/timezone";

export function toZoned(at: Date, timeZone: string) {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat("en-CA", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
		})
			.formatToParts(at)
			.map(({ type, value }) => [type, value]),
	);
	return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** Port of server scheduling: preserve wall time; move skipped DST times forward. */
export function nextCareerRun(previous: Date, days: number, timezone: string): Date {
	const local = (date: Date) => {
		const value = toZoned(date, timezone);
		return Date.parse(`${value.date}T${value.time}:00Z`);
	};
	const target = local(previous) + days * 86_400_000;
	let guess = previous.getTime() + days * 86_400_000;
	let prior = guess;
	for (let i = 0; i < 4; i++) {
		const delta = target - local(new Date(guess));
		if (!delta) return new Date(guess);
		const next = guess + delta;
		if (next === prior) return new Date(Math.max(next, guess));
		prior = guess;
		guess = next;
	}
	return new Date(guess);
}

export function rollForward(at: Date, days: number, timezone: string, now = new Date()) {
	if (at > now) return at;
	const steps = Math.max(1, Math.floor((now.getTime() - at.getTime()) / (days * 86_400_000)));
	let next = nextCareerRun(at, steps * days, timezone);
	while (next <= now) next = nextCareerRun(next, days, timezone);
	return next;
}

/** Morning-of moves to two hours before early interviews, as on the server. */
export function prepareRunAt(start: Date, lead: "24h" | "2h" | "morning", timezone: string): Date {
	if (lead !== "morning") return new Date(start.getTime() - (lead === "24h" ? 24 : 2) * 3_600_000);
	const morning = fromZonedDateTime(toZoned(start, timezone).date, "08:00", timezone);
	return new Date(Math.min(morning?.getTime() ?? start.getTime(), start.getTime() - 2 * 3_600_000));
}

/** A new briefing's lead: 24 hours before, or 2 hours when that has passed (then it runs now either way). */
export function firstLeadAhead(start: Date | undefined, timezone: string, now = new Date()): "24h" | "2h" {
	return start && prepareRunAt(start, "24h", timezone) <= now && prepareRunAt(start, "2h", timezone) > now
		? "2h"
		: "24h";
}

export function collectInterviews(applications: Application[], now = new Date()) {
	return applications
		.filter((application) => application.status !== "closed")
		.flatMap((application) =>
			application.activity.flatMap((interview) => {
				if (interview.type !== "interview") return [];
				const start = new Date(interview.at);
				const end = new Date(start.getTime() + interview.durationMinutes * 60_000);
				return end >= now ? [{ application, interview, start, end }] : [];
			}),
		)
		.sort((a, b) => a.start.getTime() - b.start.getTime());
}
