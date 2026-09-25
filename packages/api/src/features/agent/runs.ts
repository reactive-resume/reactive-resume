import type { UIMessage } from "ai";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";

type AgentRunStateDb = Pick<typeof db, "update">;
type AgentRunReaperDb = Pick<typeof db, "select" | "update">;

// Deliberately TTL-only (no controller-map heuristic) so reaping stays multi-replica-safe. The TTL
// exceeds the 10-minute run wall clock, so a live run always dies by its own timeout first.
export const STALE_AGENT_RUN_TTL_MS = 15 * 60_000;

type StaleRunThreadFields = {
	activeRunId: string | null;
	activeRunStartedAt: Date | null;
};

export function isStaleAgentRun(thread: StaleRunThreadFields, now = new Date()) {
	if (!thread.activeRunId) return false;
	// A run claim without a start timestamp is a legacy row that can never age out on its own.
	if (!thread.activeRunStartedAt) return true;

	return now.getTime() - thread.activeRunStartedAt.getTime() > STALE_AGENT_RUN_TTL_MS;
}

export async function claimActiveAgentRun(
	input: { threadId: string; userId: string; runId: string; streamId: string },
	database: AgentRunStateDb = db,
) {
	const claimed = await database
		.update(schema.agentThread)
		.set({ activeRunId: input.runId, activeStreamId: input.streamId, activeRunStartedAt: new Date() })
		.where(
			and(
				eq(schema.agentThread.id, input.threadId),
				eq(schema.agentThread.userId, input.userId),
				isNull(schema.agentThread.activeRunId),
				isNull(schema.agentThread.deletedAt),
				eq(schema.agentThread.status, "active"),
			),
		)
		.returning({ id: schema.agentThread.id });

	return claimed.length === 1;
}

export async function clearActiveAgentRunIfCurrent(
	input: { threadId: string; userId: string; runId: string; streamId: string | null },
	database: AgentRunStateDb = db,
) {
	const cleared = await database
		.update(schema.agentThread)
		.set({ activeRunId: null, activeStreamId: null, activeRunStartedAt: null })
		.where(
			and(
				eq(schema.agentThread.id, input.threadId),
				eq(schema.agentThread.userId, input.userId),
				eq(schema.agentThread.activeRunId, input.runId),
				input.streamId === null
					? isNull(schema.agentThread.activeStreamId)
					: eq(schema.agentThread.activeStreamId, input.streamId),
			),
		)
		.returning({ id: schema.agentThread.id });

	return cleared.length === 1;
}

type ReapableActionRow = Pick<
	typeof schema.agentAction.$inferSelect,
	"id" | "resumeId" | "title" | "summary" | "operations" | "appliedUpdatedAt"
>;

function hasActionPart(message: UIMessage, actionId: string) {
	return message.parts.some((part) => {
		const output = (part as { output?: unknown }).output;
		return (
			part.type === "tool-apply_resume_patch" &&
			typeof output === "object" &&
			output !== null &&
			(output as { actionId?: unknown }).actionId === actionId
		);
	});
}

// Applied actions missing from a dead draft's parts get a synthetic call/result pair so the
// replayed history stays provider-valid (providers reject tool results without matching calls).
export function appendMissingActionParts(message: UIMessage, actions: ReapableActionRow[]): UIMessage {
	const missing = actions.filter((action) => !hasActionPart(message, action.id));
	if (missing.length === 0) return message;

	return {
		...message,
		parts: [
			...message.parts,
			...missing.map(
				(action) =>
					({
						type: "tool-apply_resume_patch",
						toolCallId: `synthetic-${action.id}`,
						state: "output-available",
						input: {
							title: action.title,
							...(action.summary ? { summary: action.summary } : {}),
							operations: action.operations,
						},
						output: {
							actionId: action.id,
							resumeId: action.resumeId,
							title: action.title,
							summary: action.summary,
							operations: action.operations,
							appliedUpdatedAt: action.appliedUpdatedAt.toISOString(),
							// Snapshot boundary: the `resume` key makes context pruning supersede older
							// full snapshots, and the null value forces a fresh read_resume — the edit
							// committed, but the post-patch document was lost with the crashed run.
							resume: null,
							note: "This edit was applied, but the run was interrupted before the updated resume could be recorded. Re-read the resume before making further edits.",
						},
					}) as UIMessage["parts"][number],
			),
		],
	};
}

// Reap = conditionally clear the run claim, then flip dead "streaming" drafts to canceled with
// their committed actions represented. Applied actions stay applied — they are real, individually
// revertable edits; auto-reverting on reap would be worse than the crash.
export async function reapStaleAgentRun(
	input: { threadId: string; userId: string; runId: string; streamId: string | null },
	database: AgentRunReaperDb = db,
) {
	// Snapshot drafts BEFORE clearing the claim: while the stale claim still holds, no new run can
	// start, so every "streaming" draft visible here belongs to the dead run — a draft inserted by
	// a replacement run claimed after this point is never in the snapshot.
	const drafts = await database
		.select()
		.from(schema.agentMessage)
		.where(
			and(
				eq(schema.agentMessage.threadId, input.threadId),
				eq(schema.agentMessage.userId, input.userId),
				eq(schema.agentMessage.status, "streaming"),
			),
		);

	// Concurrent reapers (another request or replica) race on this conditional clear; the loser
	// must not touch drafts — the thread has already moved on under a different run.
	const cleared = await clearActiveAgentRunIfCurrent(input, database);
	if (!cleared) return;

	for (const draft of drafts) {
		const actions = await database
			.select({
				id: schema.agentAction.id,
				resumeId: schema.agentAction.resumeId,
				title: schema.agentAction.title,
				summary: schema.agentAction.summary,
				operations: schema.agentAction.operations,
				appliedUpdatedAt: schema.agentAction.appliedUpdatedAt,
			})
			.from(schema.agentAction)
			.where(
				and(
					eq(schema.agentAction.messageId, draft.id),
					eq(schema.agentAction.kind, "resume_patch"),
					eq(schema.agentAction.status, "applied"),
				),
			);

		const message = appendMissingActionParts(draft.uiMessage as unknown as UIMessage, actions);
		await database
			.update(schema.agentMessage)
			.set({ status: "canceled", uiMessage: message as unknown as Record<string, unknown> })
			.where(
				and(
					eq(schema.agentMessage.id, draft.id),
					// A continuation can claim the thread right after our conditional clear and start
					// writing into this very row. Flip only the exact state we snapshotted — any
					// concurrent write changes status or uiMessage and makes this a no-op.
					eq(schema.agentMessage.status, "streaming"),
					sql`${schema.agentMessage.uiMessage} = ${JSON.stringify(draft.uiMessage)}::jsonb`,
				),
			);
	}
}

export async function reapStaleAgentRunsAtBoot(database: AgentRunReaperDb = db) {
	const threads = await database
		.select({
			id: schema.agentThread.id,
			userId: schema.agentThread.userId,
			activeRunId: schema.agentThread.activeRunId,
			activeStreamId: schema.agentThread.activeStreamId,
			activeRunStartedAt: schema.agentThread.activeRunStartedAt,
		})
		.from(schema.agentThread)
		.where(isNotNull(schema.agentThread.activeRunId));

	for (const thread of threads) {
		if (!isStaleAgentRun(thread) || !thread.activeRunId) continue;
		await reapStaleAgentRun(
			{ threadId: thread.id, userId: thread.userId, runId: thread.activeRunId, streamId: thread.activeStreamId },
			database,
		);
	}
}
