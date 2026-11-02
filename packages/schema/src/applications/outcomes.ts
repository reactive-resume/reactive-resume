import type { ApplicationClosedReason, ApplicationStatus, ApplicationTimelineEntry } from "./data";

const PIPELINE: readonly ApplicationStatus[] = ["saved", "applied", "screening", "interview", "offer"];
export type OutcomeSource = {
	status: ApplicationStatus;
	closedReason: ApplicationClosedReason | null;
	activity: readonly ApplicationTimelineEntry[];
	appliedAt: Date | string;
	resumeId: string | null;
};

const DAY_MS = 86_400_000;
const REPLY_STAGES = new Set<ApplicationStatus>(["screening", "interview", "offer"]);

/** Applications per source, most first; applications without a source are left out (as the server's stats). */
export function countSources(applications: readonly { source: string | null }[]) {
	const counts = new Map<string, number>();
	for (const { source } of applications) if (source) counts.set(source, (counts.get(source) ?? 0) + 1);
	return [...counts].map(([source, count]) => ({ source, count })).toSorted((a, b) => b.count - a.count);
}

// Moves between lanes of one stage aren't milestones: only canonical stage changes count.
const stageEntries = (application: OutcomeSource) =>
	application.activity
		.flatMap((entry) =>
			entry.type === "stage" && entry.canonicalTransition !== false ? [{ ...entry, at: new Date(entry.at) }] : [],
		)
		.sort((a, b) => a.at.getTime() - b.at.getTime());

/** How far along the pipeline an application ever got, from its stage history; closed ones keep their furthest stage. */
export function furthestStage(application: OutcomeSource) {
	const stages = [...stageEntries(application).map((entry) => entry.stage), application.status];
	return Math.max(...stages.map((stage) => PIPELINE.indexOf(stage)));
}

/** A recorded Applied date, or a legacy date without canonical history; a later-stage event cannot date its own submission. */
export function applicationSentAt(application: OutcomeSource): Date | undefined {
	const entries = stageEntries(application).filter((entry) => !entry.dateUnknown);
	const applied = entries.find((entry) => entry.stage === "applied");
	if (applied) return applied.at;
	const legacy = new Date(application.appliedAt);
	if (
		(application.status === "applied" || entries.length === 0) &&
		!application.activity.some(
			(entry) => entry.type === "stage" && entry.canonicalTransition !== false && entry.dateUnknown,
		)
	)
		return legacy;
	return undefined;
}

/** The first reply after sending: moving on to screening or beyond, or being turned down. */
function firstReply(application: OutcomeSource) {
	const since = applicationSentAt(application)?.getTime() ?? -Infinity;
	return (
		application.activity
			.flatMap((entry) => (entry.type === "stage" ? [{ ...entry, at: new Date(entry.at) }] : []))
			// An undated imported reply predates later moves, even when those moves are backdated.
			.sort((a, b) => Number(!!b.dateUnknown) - Number(!!a.dateUnknown) || a.at.getTime() - b.at.getTime())
			.find(
				(entry) =>
					(entry.dateUnknown || entry.at.getTime() >= since) &&
					((entry.canonicalTransition !== false && REPLY_STAGES.has(entry.stage)) ||
						(entry.stage === "closed" &&
							(entry.closedReason === undefined ? application.closedReason : entry.closedReason) === "not-selected")),
			)
	);
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
			withReplies.flatMap(({ application, reply }) => {
				const sent = applicationSentAt(application);
				return sent && reply && !reply.dateUnknown ? [Math.round((reply.at.getTime() - sent.getTime()) / DAY_MS)] : [];
			}),
		),
		tailored: compare(true),
		base: compare(false),
	};
}
