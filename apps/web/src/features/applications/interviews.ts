import type { ApplicationSummary } from "./types";
import type { InterviewKind, InterviewTimelineEntry } from "@reactive-resume/schema/applications/data";
import { t } from "@lingui/core/macro";
import { INTERVIEW_KINDS } from "@reactive-resume/schema/applications/data";

export type ScheduledInterview = {
	application: ApplicationSummary;
	interview: InterviewTimelineEntry;
	start: Date;
	end: Date;
};

/** "Screening", "Behavioral": interview types in the interface language (the schema's labels are English). */
export const interviewTypeLabel = (kind: InterviewKind) =>
	({
		screening: t`Screening`,
		technical: t`Technical`,
		behavioral: t`Behavioral`,
		onsite: t`Onsite`,
		other: t`Other`,
	})[kind];

/** An interview type with its label translated, so every place that shows one reads the same. */
export const interviewKindOf = (kind: InterviewKind) => {
	const item = INTERVIEW_KINDS.find((entry) => entry.value === kind);
	return item ? { ...item, label: interviewTypeLabel(item.value) } : undefined;
};

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

// Calendar day key (YYYY-MM-DD). Pass the account timezone when bucketing interview instants.
export function dayKey(date: Date, timeZone?: string) {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
			.formatToParts(date)
			.map(({ type, value }) => [type, value]),
	);
	return `${parts.year}-${parts.month}-${parts.day}`;
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
