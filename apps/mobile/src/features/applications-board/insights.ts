// Insights maths, ported from apps/web/src/features/applications/insights.ts. Everything derives from the shared
// applications list (it holds every application, closed ones included), so the figures match the server's stats
// without a second query. Weeks are bucketed on the user's clock. Pure: Node runs it in the M5-T3 scenarios.
import type { ApplicationSummary as Application } from "../applications/types";
import type { ApplicationStatus } from "@reactive-resume/schema/applications/data";
import { zonedParts } from "../reminders/schedule.ts";

const DAY_MS = 86_400_000;
const PIPELINE: readonly ApplicationStatus[] = ["saved", "applied", "screening", "interview", "offer"];
const REPLY_STAGES = new Set<ApplicationStatus>(["screening", "interview", "offer"]);

type OutcomeSource = Pick<Application, "status" | "closedReason" | "activity" | "appliedAt" | "resumeId">;

const stageEntries = (application: OutcomeSource) =>
	application.activity
		.flatMap((entry) => (entry.type === "stage" ? [{ stage: entry.stage, at: new Date(entry.at) }] : []))
		.sort((a, b) => a.at.getTime() - b.at.getTime());

/** How far along the pipeline an application ever got; closed ones keep their furthest stage. */
function furthestStage(application: OutcomeSource) {
	const stages = [...stageEntries(application).map((entry) => entry.stage), application.status];
	return Math.max(...stages.map((stage) => PIPELINE.indexOf(stage)));
}

/** When it was sent: its first stage at Applied or beyond, else the applied date on record. */
function sentAt(application: OutcomeSource) {
	const applied = PIPELINE.indexOf("applied");
	return (
		stageEntries(application).find((entry) => PIPELINE.indexOf(entry.stage) >= applied)?.at ??
		new Date(application.appliedAt)
	);
}

/** The first reply after sending: moving on to screening or beyond, or being turned down. */
function firstReply(application: OutcomeSource) {
	const since = sentAt(application).getTime();
	return stageEntries(application).find(
		(entry) =>
			entry.at.getTime() >= since &&
			(REPLY_STAGES.has(entry.stage) || (entry.stage === "closed" && application.closedReason === "not-selected")),
	)?.at;
}

function median(values: number[]) {
	if (values.length === 0) return null;
	const sorted = values.toSorted((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? (sorted[middle] ?? null) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

export type Outcomes = {
	/** Applications that ever reached each stage from Applied on, closed ones included. */
	funnel: { status: ApplicationStatus; reached: number }[];
	sent: number;
	heardBack: number;
	medianDaysToReply: number | null;
	/** Sent applications whose linked resume was made for them, against those sent with another resume. */
	tailored: { sent: number; replied: number };
	base: { sent: number; replied: number };
};

/** The funnel of stages reached, how many heard back and how fast, and tailored against base resumes. */
export function computeOutcomes<T extends OutcomeSource>(
	applications: readonly T[],
	isTailored: (application: T) => boolean,
): Outcomes {
	const sent = applications.filter((application) => furthestStage(application) >= PIPELINE.indexOf("applied"));
	const replies = sent.map((application) => ({ application, reply: firstReply(application) }));
	const withReplies = replies.filter((entry) => entry.reply !== undefined);
	const compare = (tailored: boolean) => {
		const group = replies.filter(({ application }) => application.resumeId && isTailored(application) === tailored);
		return { sent: group.length, replied: group.filter((entry) => entry.reply !== undefined).length };
	};

	return {
		funnel: (["applied", "screening", "interview", "offer"] as const).map((status) => ({
			status,
			reached: sent.filter((application) => furthestStage(application) >= PIPELINE.indexOf(status)).length,
		})),
		sent: sent.length,
		heardBack: withReplies.length,
		medianDaysToReply: median(
			withReplies.map(({ application, reply }) =>
				Math.round(((reply?.getTime() ?? 0) - sentAt(application).getTime()) / DAY_MS),
			),
		),
		tailored: compare(true),
		base: compare(false),
	};
}

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
		const day = dayNumber(sentAt(application), timeZone);
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
