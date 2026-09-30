import type { Application } from "./types";
import type { ApplicationStatus } from "@reactive-resume/schema/applications/data";
import { STAGES } from "@reactive-resume/schema/applications/data";
import { PIPELINE } from "./stages";

export type StageCount = { status: ApplicationStatus; count: number };

// The forward pipeline (closed is a terminal outcome, handled separately).
const FORWARD: ApplicationStatus[] = ["saved", "applied", "screening", "interview", "offer"];

export type Insights = {
	total: number;
	tiles: { label: string; value: string; sub: string }[];
	funnel: { label: string; color: string; count: number; reached: number; pct: number; conv: string }[];
	closed: number;
};

// Pure function of the raw per-stage counts, so it's trivially testable and shared by every
// chart in the Insights view. "reached[i]" assumes the pipeline is monotonic for currently
// active applications (an app at Interview has passed through Screening).
export function computeInsights(byStage: StageCount[]): Insights {
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
			label: stage?.label ?? status,
			color: stage?.color ?? "var(--stage-saved)",
			count: at(status),
			reached: reachedCount,
			pct: total > 0 ? Math.round((reachedCount / total) * 100) : 0,
			conv: prev > 0 ? `${Math.round((reachedCount / prev) * 100)}%` : "—",
		};
	});

	const interviews = at("interview") + at("offer");
	const offers = at("offer");
	const responseRate = appliedOn > 0 ? Math.round(((reached[2] ?? 0) / appliedOn) * 100) : 0;

	const tiles = [
		{ label: "Total applications", value: String(total), sub: "in this view" },
		{ label: "Applied", value: String(appliedOn), sub: "past saved" },
		{ label: "Response rate", value: `${responseRate}%`, sub: "reached screening" },
		{ label: "Interviews", value: String(interviews), sub: "interview or beyond" },
		{ label: "Offers", value: String(offers), sub: closed > 0 ? `${closed} closed` : "so far" },
	];

	return { total, tiles, funnel, closed };
}

export type TimelineBucket = { label: string; count: number };

// Bucket application dates into the last `weeks` calendar weeks (Sunday-started) so the Insights
// view can show application velocity over time — a dimension the funnel/tiles don't capture.
export function computeTimeline(applications: readonly OutcomeSource[], weeks = 8): TimelineBucket[] {
	const msWeek = 7 * 86_400_000;
	const startOfWeek = new Date();
	startOfWeek.setHours(0, 0, 0, 0);
	startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

	const buckets = Array.from({ length: weeks }, (_, i) => {
		const start = new Date(startOfWeek.getTime() - (weeks - 1 - i) * msWeek);
		return { start: start.getTime(), label: `${start.getMonth() + 1}/${start.getDate()}`, count: 0 };
	});

	const first = buckets[0]?.start ?? 0;
	for (const application of applications) {
		if (furthestStage(application) < PIPELINE.indexOf("applied")) continue;
		const time = sentAt(application).getTime();
		if (time < first) continue;
		const index = Math.min(weeks - 1, Math.floor((time - first) / msWeek));
		const bucket = buckets[index];
		if (bucket) bucket.count++;
	}

	return buckets.map(({ label, count }) => ({ label, count }));
}

type OutcomeSource = Pick<Application, "status" | "closedReason" | "activity" | "appliedAt" | "resumeId">;

const DAY_MS = 86_400_000;
const REPLY_STAGES = new Set<ApplicationStatus>(["screening", "interview", "offer"]);

const stageEntries = (application: OutcomeSource) =>
	application.activity
		.flatMap((entry) => (entry.type === "stage" ? [{ stage: entry.stage, at: new Date(entry.at) }] : []))
		.sort((a, b) => a.at.getTime() - b.at.getTime());

/** How far along the pipeline an application ever got, from its stage history; closed ones keep their furthest stage. */
function furthestStage(application: OutcomeSource) {
	const stages = [...stageEntries(application).map((entry) => entry.stage), application.status];
	return Math.max(...stages.map((stage) => PIPELINE.indexOf(stage)));
}

/** When the application was sent: its first stage at Applied or beyond, else the applied date on record. */
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
	const sorted = [...values].sort((a, b) => a - b);
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

/**
 * How applications turned out: the funnel of stages reached, how many heard back and how fast, and whether
 * resumes made for the job got more replies than the base resume. `isTailored` says whether an application's
 * linked resume was made for it.
 */
export function computeOutcomes(
	applications: readonly OutcomeSource[],
	isTailored: (application: OutcomeSource) => boolean,
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
