import { describe, expect, it, vi } from "vitest";

vi.mock("@reactive-resume/db/client", () => ({ db: {} }));
vi.mock("@reactive-resume/db/schema", () => ({
	agentThread: {
		id: "agent_threads.id",
		userId: "agent_threads.user_id",
		activeRunId: "agent_threads.active_run_id",
		deletedAt: "agent_threads.deleted_at",
		status: "agent_threads.status",
		activeStreamId: "agent_threads.active_stream_id",
	},
	agentMessage: {},
	agentAction: {},
}));
vi.mock("drizzle-orm", () => ({
	and: (...conditions: unknown[]) => ({ type: "and", conditions }),
	eq: (left: unknown, right: unknown) => ({ type: "eq", left, right }),
	isNull: (value: unknown) => ({ type: "isNull", value }),
	sql: () => ({}),
}));

const { claimActiveAgentRun, clearActiveAgentRunIfCurrent, isStaleAgentRun, reapStaleAgentRun } =
	await import("./runs");

const NOW = new Date("2026-08-20T12:00:00.000Z");

function minutesBefore(minutes: number) {
	return new Date(NOW.getTime() - minutes * 60_000);
}

describe("isStaleAgentRun", () => {
	it("is true once the run outlives the TTL", () => {
		expect(isStaleAgentRun({ activeRunId: "run-1", activeRunStartedAt: minutesBefore(14) }, NOW)).toBe(false);
		expect(isStaleAgentRun({ activeRunId: "run-1", activeRunStartedAt: minutesBefore(16) }, NOW)).toBe(true);
	});
});

function createRunStateDb(returningRows: unknown[] = []) {
	const returning = vi.fn(async () => returningRows);
	const where = vi.fn(() => ({ returning }));
	const set = vi.fn(() => ({ where }));
	const update = vi.fn(() => ({ set }));

	return {
		database: { update },
		set,
		update,
		where,
	};
}

describe("agent run state", () => {
	it("claims an active run only when the thread still has no active run", async () => {
		const db = createRunStateDb([{ id: "thread-1" }]);

		await expect(
			claimActiveAgentRun(
				{ threadId: "thread-1", userId: "user-1", runId: "run-1", streamId: "stream-1" },
				db.database as never,
			),
		).resolves.toBe(true);

		expect(db.update).toHaveBeenCalledWith(expect.objectContaining({ id: "agent_threads.id" }));
		expect(db.set).toHaveBeenCalledWith({
			activeRunId: "run-1",
			activeStreamId: "stream-1",
			activeRunStartedAt: expect.any(Date),
		});
		expect(db.where).toHaveBeenCalledWith({
			type: "and",
			conditions: [
				{ type: "eq", left: "agent_threads.id", right: "thread-1" },
				{ type: "eq", left: "agent_threads.user_id", right: "user-1" },
				{ type: "isNull", value: "agent_threads.active_run_id" },
				{ type: "isNull", value: "agent_threads.deleted_at" },
				{ type: "eq", left: "agent_threads.status", right: "active" },
			],
		});
	});

	it("clears active run state only for the matching run and stream", async () => {
		const db = createRunStateDb();

		await clearActiveAgentRunIfCurrent(
			{ threadId: "thread-1", userId: "user-1", runId: "run-1", streamId: "stream-1" },
			db.database as never,
		);

		expect(db.set).toHaveBeenCalledWith({ activeRunId: null, activeStreamId: null, activeRunStartedAt: null });
		expect(db.where).toHaveBeenCalledWith({
			type: "and",
			conditions: [
				{ type: "eq", left: "agent_threads.id", right: "thread-1" },
				{ type: "eq", left: "agent_threads.user_id", right: "user-1" },
				{ type: "eq", left: "agent_threads.active_run_id", right: "run-1" },
				{ type: "eq", left: "agent_threads.active_stream_id", right: "stream-1" },
			],
		});
	});
});

type ScriptedReaperDb = {
	updates: Array<{ set: unknown }>;
};

function scriptedReaperDatabase(input: { drafts: Array<Record<string, unknown>>; clearMatches?: boolean }) {
	const state: ScriptedReaperDb = { updates: [] };
	let selectCall = 0;

	return {
		state,
		select: () => {
			const call = selectCall;
			selectCall += 1;
			return {
				from: () => ({
					where: async () => (call === 0 ? input.drafts : []),
				}),
			};
		},
		update: () => ({
			set: (set: unknown) => {
				state.updates.push({ set });
				return {
					where: () =>
						Object.assign(Promise.resolve(undefined), {
							returning: async () => ((input.clearMatches ?? true) ? [{ id: "thread-1" }] : []),
						}),
				};
			},
		}),
	};
}

describe("reapStaleAgentRun", () => {
	it("clears the run claim and flips streaming drafts to canceled", async () => {
		const database = scriptedReaperDatabase({
			drafts: [
				{
					id: "row-1",
					uiMessage: { id: "ui-1", role: "assistant", parts: [{ type: "text", text: "Editing…" }] },
				},
			],
		});

		await reapStaleAgentRun(
			{ threadId: "thread-1", userId: "user-1", runId: "run-1", streamId: "stream-1" },
			database as never,
		);

		// First update clears the run claim; second flips the draft.
		expect(database.state.updates[0]?.set).toMatchObject({ activeRunId: null, activeStreamId: null });
		expect(database.state.updates[1]?.set).toMatchObject({ status: "canceled" });
	});

	// Regression: a concurrent request/replica can claim a replacement run (and insert a live
	// draft) between the stale read and this reap. When the conditional clear matches nothing,
	// the loser must not flip any draft.
	it("does not touch drafts when another reaper already cleared or replaced the run", async () => {
		const database = scriptedReaperDatabase({
			drafts: [{ id: "row-live", uiMessage: { id: "ui-live", role: "assistant", parts: [] } }],
			clearMatches: false,
		});

		await reapStaleAgentRun(
			{ threadId: "thread-1", userId: "user-1", runId: "run-stale", streamId: "stream-stale" },
			database as never,
		);

		// Only the (no-op) conditional clear ran; no draft status flip.
		expect(database.state.updates).toHaveLength(1);
		expect(database.state.updates[0]?.set).toMatchObject({ activeRunId: null });
	});
});
