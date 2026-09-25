import { describe, expect, it, vi } from "vitest";
import { claimActiveAgentRun, clearActiveAgentRunIfCurrent } from "./runs";
import { createAgentStreamLifecycle, emptyAgentStream } from "./streams";

vi.mock("@reactive-resume/db/client", () => ({ db: { update: vi.fn() } }));
vi.mock("@reactive-resume/db/schema", () => ({
	agentThread: {
		id: "agent_threads.id",
		userId: "agent_threads.user_id",
		activeRunId: "agent_threads.active_run_id",
		deletedAt: "agent_threads.deleted_at",
		status: "agent_threads.status",
		activeStreamId: "agent_threads.active_stream_id",
	},
}));
vi.mock("drizzle-orm", () => ({
	and: (...conditions: unknown[]) => ({ type: "and", conditions }),
	eq: (left: unknown, right: unknown) => ({ type: "eq", left, right }),
	isNull: (value: unknown) => ({ type: "isNull", value }),
}));

async function readStreamChunks(reader: ReadableStreamDefaultReader<string>, chunks: string[]): Promise<string[]> {
	const { done, value } = await reader.read();

	if (done) return chunks;

	chunks.push(value);
	return readStreamChunks(reader, chunks);
}

function readStream(stream: ReadableStream<string>) {
	return readStreamChunks(stream.getReader(), []);
}

function createRunStateDb(returningRows: unknown[] = []) {
	const returning = vi.fn(async () => returningRows);
	const where = vi.fn(() => ({ returning }));
	const set = vi.fn(() => ({ where }));
	const update = vi.fn(() => ({ set }));

	return {
		database: { update },
		returning,
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

	it("reports a failed claim when the guarded update claims no rows", async () => {
		const db = createRunStateDb([]);

		await expect(
			claimActiveAgentRun(
				{ threadId: "thread-1", userId: "user-1", runId: "run-1", streamId: "stream-1" },
				db.database as never,
			),
		).resolves.toBe(false);
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

	it("clears active run state with a null stream guard when no stream id was recorded", async () => {
		const db = createRunStateDb();

		await clearActiveAgentRunIfCurrent(
			{ threadId: "thread-1", userId: "user-1", runId: "run-1", streamId: null },
			db.database as never,
		);

		expect(db.where).toHaveBeenCalledWith({
			type: "and",
			conditions: [
				{ type: "eq", left: "agent_threads.id", right: "thread-1" },
				{ type: "eq", left: "agent_threads.user_id", right: "user-1" },
				{ type: "eq", left: "agent_threads.active_run_id", right: "run-1" },
				{ type: "isNull", value: "agent_threads.active_stream_id" },
			],
		});
	});
});

describe("agent stream lifecycle", () => {
	it("returns a closed stream when no active stream id exists", async () => {
		const lifecycle = createAgentStreamLifecycle({
			getContext: () => {
				throw new Error("context should not be used");
			},
		});

		await expect(readStream(await lifecycle.resume(null))).resolves.toEqual([]);
	});

	it("creates a resumable stream from UI message SSE chunks", async () => {
		const createNewResumableStream = vi.fn(async (_streamId: string, makeStream: () => ReadableStream<string>) =>
			makeStream(),
		);
		const lifecycle = createAgentStreamLifecycle({
			getContext: () => ({
				createNewResumableStream,
				resumeExistingStream: vi.fn(),
			}),
		});

		const stream = await lifecycle.create(
			"stream-1",
			() =>
				new ReadableStream({
					start(controller) {
						controller.enqueue({ type: "text-start", id: "text-1" });
						controller.enqueue({ type: "text-delta", id: "text-1", delta: "Hello" });
						controller.close();
					},
				}),
		);

		await expect(readStream(stream)).resolves.toEqual([
			'data: {"type":"text-start","id":"text-1"}\n\n',
			'data: {"type":"text-delta","id":"text-1","delta":"Hello"}\n\n',
			"data: [DONE]\n\n",
		]);
		expect(createNewResumableStream).toHaveBeenCalledWith("stream-1", expect.any(Function));
	});

	it("returns a closed stream when the active stream is missing or already done", async () => {
		const lifecycle = createAgentStreamLifecycle({
			getContext: () => ({
				createNewResumableStream: vi.fn(),
				resumeExistingStream: vi.fn(async () => null),
			}),
		});

		await expect(readStream(await lifecycle.resume("stream-1"))).resolves.toEqual([]);
		await expect(readStream(emptyAgentStream())).resolves.toEqual([]);
	});
});
