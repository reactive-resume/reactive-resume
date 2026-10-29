import type { ApplicationSummary } from "./types";
import type { InterviewKind, InterviewTimelineEntry } from "@reactive-resume/schema/applications/data";
import { INTERVIEW_KINDS } from "@reactive-resume/schema/applications/data";

export type ScheduledInterview = {
	application: ApplicationSummary;
	interview: InterviewTimelineEntry;
	start: Date;
	end: Date;
};

export const interviewKindOf = (kind: InterviewKind) => INTERVIEW_KINDS.find((item) => item.value === kind);

export const isInterview = (entry: ApplicationSummary["activity"][number]): entry is InterviewTimelineEntry =>
	entry.type === "interview";

// Every interview across the given applications, soonest first.
export function collectInterviews(applications: ApplicationSummary[]): ScheduledInterview[] {
	return applications
		.flatMap((application) =>
			application.activity.filter(isInterview).map((interview) => {
				const start = new Date(interview.at);
				return {
					application,
					interview,
					start,
					end: new Date(start.getTime() + interview.durationMinutes * 60_000),
				};
			}),
		)
		.sort((a, b) => a.start.getTime() - b.start.getTime());
}

// Interviews that haven't finished yet, soonest first.
export function upcomingInterviews(interviews: ScheduledInterview[], now = new Date()) {
	return interviews.filter((item) => item.end.getTime() >= now.getTime());
}

// "30 min", "1 hr", "1 hr 30 min" — localized unit names via Intl.
export function formatDuration(minutes: number, locale?: string) {
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	const unit = (value: number, name: "hour" | "minute") =>
		new Intl.NumberFormat(locale, { style: "unit", unit: name, unitDisplay: "short" }).format(value);
	return [hours > 0 ? unit(hours, "hour") : null, rest > 0 || hours === 0 ? unit(rest, "minute") : null]
		.filter(Boolean)
		.join(" ");
}

const pad = (value: number) => String(value).padStart(2, "0");

// Calendar day key (YYYY-MM-DD). Pass the account timezone when bucketing interview instants.
export function dayKey(date: Date, timeZone?: string) {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
			.formatToParts(date)
			.map(({ type, value }) => [type, value]),
	);
	return `${parts.year}-${parts.month}-${parts.day}`;
}

// Value for <input type="datetime-local"> in the viewer's timezone.
export function toDateTimeLocal(value: Date | string) {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "";
	return `${dayKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// A datetime-local value is interpreted in the viewer's timezone and sent as an absolute ISO timestamp.
export function fromDateTimeLocal(value: string) {
	if (!value) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Six full weeks of UTC calendar dates, for arithmetic/labels independent of any clock or DST change.
export function monthGrid(month: Date, weekStartsOn = 0): Date[] {
	const first = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
	const offset = (first.getUTCDay() - weekStartsOn + 7) % 7;
	return Array.from(
		{ length: 42 },
		(_, i) => new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1 - offset + i)),
	);
}

export function groupByDay(interviews: ScheduledInterview[], timeZone: string) {
	const map = new Map<string, ScheduledInterview[]>();
	for (const item of interviews) {
		const key = dayKey(item.start, timeZone);
		map.set(key, [...(map.get(key) ?? []), item]);
	}
	return map;
}
