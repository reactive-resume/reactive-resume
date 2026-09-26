import type { InterviewKind, InterviewTimelineEntry } from "@reactive-resume/schema/applications/data";
import type { Application } from "./types";
import { INTERVIEW_KINDS } from "@reactive-resume/schema/applications/data";

export type ScheduledInterview = {
	application: Application;
	interview: InterviewTimelineEntry;
	start: Date;
	end: Date;
};

export const interviewKindOf = (kind: InterviewKind) => INTERVIEW_KINDS.find((item) => item.value === kind);

export const isInterview = (entry: Application["activity"][number]): entry is InterviewTimelineEntry =>
	entry.type === "interview";

// Every interview across the given applications, soonest first.
export function collectInterviews(applications: Application[]): ScheduledInterview[] {
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

// Local calendar day key (YYYY-MM-DD); interviews are bucketed by the viewer's timezone.
export const dayKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

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

// Six full weeks (42 days) covering the month, starting on `weekStartsOn` (0 = Sunday).
export function monthGrid(month: Date, weekStartsOn = 0): Date[] {
	const first = new Date(month.getFullYear(), month.getMonth(), 1);
	const offset = (first.getDay() - weekStartsOn + 7) % 7;
	return Array.from(
		{ length: 42 },
		(_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() - offset + i),
	);
}

export function groupByDay(interviews: ScheduledInterview[]) {
	const map = new Map<string, ScheduledInterview[]>();
	for (const item of interviews) {
		const key = dayKey(item.start);
		map.set(key, [...(map.get(key) ?? []), item]);
	}
	return map;
}
