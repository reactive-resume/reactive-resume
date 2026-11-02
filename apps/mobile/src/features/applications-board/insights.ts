import type { OutcomeSource } from "@reactive-resume/schema/applications/outcomes";
import { applicationSentAt, furthestStage } from "@reactive-resume/schema/applications/outcomes";
export { computeOutcomes } from "@reactive-resume/schema/applications/outcomes";
// Insights maths, ported from apps/web/src/features/applications/insights.ts. Everything derives from the shared
// applications list (it holds every application, closed ones included), so the figures match the server's stats
// without a second query. Weeks are bucketed on the user's clock. Pure: Node runs it in the M5-T3 scenarios.
import type { ApplicationSummary as Application } from "../applications/types";
import type { ApplicationStatus } from "@reactive-resume/schema/applications/data";
import { zonedParts } from "../reminders/schedule.ts";

const DAY_MS = 86_400_000;
const PIPELINE: readonly ApplicationStatus[] = ["saved", "applied", "screening", "interview", "offer"];

const dayNumber = (instant: Date, timeZone: string) =>
	Date.parse(`${zonedParts(instant, timeZone).date}T00:00:00Z`) / DAY_MS;

export type WeekBucket = { start: string; count: number };

/** Applications sent per week over the last `weeks` weeks, on the user's clock; `start` is each week's first day. */
export function computeTimeline(
	applications: readonly OutcomeSource[],
	options: { now: Date; timeZone: string; weekStartsOn: number; weeks?: number },
): WeekBucket[] {
	const { now, timeZone, weekStartsOn, weeks = 8 } = options;
	const today = dayNumber(now, timeZone);
	const weekday = new Date(today * DAY_MS).getUTCDay();
	const first = today - ((weekday - weekStartsOn + 7) % 7) - (weeks - 1) * 7;
	const counts = Array.from({ length: weeks }, () => 0);

	for (const application of applications) {
		if (furthestStage(application) < PIPELINE.indexOf("applied")) continue;
		const sent = applicationSentAt(application);
		if (!sent) continue;
		const day = dayNumber(sent, timeZone);
		if (day < first) continue;
		const index = Math.min(weeks - 1, Math.floor((day - first) / 7));
		counts[index] = (counts[index] ?? 0) + 1;
	}

	return counts.map((count, i) => ({
		start: new Date((first + i * 7) * DAY_MS).toISOString().slice(0, 10),
		count,
	}));
}

export type PipelineStep = { status: ApplicationStatus; reached: number; conversion: number | null };

/**
 * The pipeline snapshot of active applications (web `computeInsights`): how many got at least as far as each stage,
 * assuming an application at Interview passed Screening, and the share that moved on from the stage before.
 */
export function computePipeline(applications: readonly Pick<Application, "status">[]) {
	const at = (status: ApplicationStatus) => applications.filter((application) => application.status === status).length;
	const closed = at("closed");
	const reached = PIPELINE.map((_, i) => PIPELINE.slice(i).reduce((sum, status) => sum + at(status), 0));
	const steps: PipelineStep[] = PIPELINE.map((status, i) => {
		const count = reached[i] ?? 0;
		const previous = i === 0 ? count : (reached[i - 1] ?? count);
		return { status, reached: count, conversion: previous > 0 ? Math.round((count / previous) * 100) : null };
	});
	return { active: applications.length - closed, closed, steps };
}

/** Applications per source, most first; applications without a source are left out (as the server's stats). */
export function countSources(applications: readonly Pick<Application, "source">[]) {
	const counts = new Map<string, number>();
	for (const { source } of applications) if (source) counts.set(source, (counts.get(source) ?? 0) + 1);
	return [...counts].map(([source, count]) => ({ source, count })).toSorted((a, b) => b.count - a.count);
}
