import type { OutcomeSource } from "@reactive-resume/schema/applications/outcomes";
import { applicationSentAt, furthestStage } from "@reactive-resume/schema/applications/outcomes";
export { computeOutcomes, countSources } from "@reactive-resume/schema/applications/outcomes";
import type { ApplicationStatus } from "@reactive-resume/schema/applications/data";
import { STAGES } from "@reactive-resume/schema/applications/data";
import { PIPELINE } from "./stages";

export type StageCount = { status: ApplicationStatus; count: number };

// The forward pipeline (closed is a terminal outcome, handled separately).
const FORWARD: ApplicationStatus[] = ["saved", "applied", "screening", "interview", "offer"];

export type Insights = {
	total: number;
	tiles: { label: string; value: string; sub: string }[];
	funnel: {
		status: ApplicationStatus;
		label: string;
		color: string;
		count: number;
		reached: number;
		pct: number;
		conv: string;
	}[];
	closed: number;
};

// Pure function of the raw per-stage counts, so it's trivially testable and shared by every
// chart in the Insights view. "reached[i]" assumes the pipeline is monotonic for currently
// active applications (an app at Interview has passed through Screening).
export function computeInsights(byStage: StageCount[], locale: string): Insights {
	const format = new Intl.NumberFormat(locale);
	const counts = new Map<ApplicationStatus, number>(byStage.map((row) => [row.status, row.count]));
	const at = (status: ApplicationStatus) => counts.get(status) ?? 0;
	const closed = at("closed");
	const total = byStage.reduce((sum, row) => sum + row.count, 0) - closed;

	// reached[i] = active apps that got at least as far as FORWARD[i].
	const reached = FORWARD.map((_, i) => FORWARD.slice(i).reduce((sum, s) => sum + at(s), 0));
	const appliedOn = reached[1] ?? 0; // everything that made it past "saved"

	const funnel = FORWARD.map((status, i) => {
		const stage = STAGES.find((s) => s.value === status);
		const reachedCount = reached[i] ?? 0;
		const prev = i === 0 ? reachedCount : (reached[i - 1] ?? reachedCount);
		return {
			status,
			label: stage?.label ?? status,
			color: stage?.color ?? "var(--stage-saved)",
			count: at(status),
			reached: reachedCount,
			pct: total > 0 ? Math.round((reachedCount / total) * 100) : 0,
			conv: prev > 0 ? `${format.format(Math.round((reachedCount / prev) * 100))}%` : "—",
		};
	});

	const interviews = at("interview") + at("offer");
	const offers = at("offer");
	const responseRate = appliedOn > 0 ? Math.round(((reached[2] ?? 0) / appliedOn) * 100) : 0;

	const tiles = [
		{ label: "Total applications", value: format.format(total), sub: "in this view" },
		{ label: "Applied", value: format.format(appliedOn), sub: "past saved" },
		{ label: "Response rate", value: `${format.format(responseRate)}%`, sub: "reached screening" },
		{ label: "Interviews", value: format.format(interviews), sub: "interview or beyond" },
		{ label: "Offers", value: format.format(offers), sub: closed > 0 ? `${format.format(closed)} closed` : "so far" },
	];

	return { total, tiles, funnel, closed };
}

export type TimelineBucket = { label: string; count: number };

// Bucket application dates into the last `weeks` calendar weeks (Sunday-started) so the Insights
// view can show application velocity over time — a dimension the funnel/tiles don't capture.
export function computeTimeline(applications: readonly OutcomeSource[], locale: string, weeks = 8): TimelineBucket[] {
	const format = new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric" });
	const msWeek = 7 * 86_400_000;
	const startOfWeek = new Date();
	startOfWeek.setHours(0, 0, 0, 0);
	startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

	const buckets = Array.from({ length: weeks }, (_, i) => {
		const start = new Date(startOfWeek.getTime() - (weeks - 1 - i) * msWeek);
		return { start: start.getTime(), label: format.format(start), count: 0 };
	});

	const first = buckets[0]?.start ?? 0;
	for (const application of applications) {
		if (furthestStage(application) < PIPELINE.indexOf("applied")) continue;
		const time = applicationSentAt(application)?.getTime();
		if (time === undefined || time < first) continue;
		const index = Math.min(weeks - 1, Math.floor((time - first) / msWeek));
		const bucket = buckets[index];
		if (bucket) bucket.count++;
	}

	return buckets.map(({ label, count }) => ({ label, count }));
}
