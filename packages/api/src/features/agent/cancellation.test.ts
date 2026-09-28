import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const values = new Map<string, string>();
	const redis = {
		get: vi.fn(async (key: string) => values.get(key) ?? null),
		set: vi.fn((key: string, value: string) => {
			values.set(key, value);
			return Promise.resolve("OK");
		}),
		exists: vi.fn(async (key: string) => (values.has(key) ? 1 : 0)),
	};
	return { values, redis, getRedis: vi.fn((): typeof redis | null => redis) };
});

vi.mock("@reactive-resume/db/redis", () => ({
	getRedis: mocks.getRedis,
	redisKey: (...parts: string[]) => ["test", ...parts].join(":"),
}));

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	vi.useFakeTimers();
	mocks.values.clear();
	mocks.getRedis.mockReturnValue(mocks.redis);
});

afterEach(() => vi.useRealTimers());

describe("agent cancellation", () => {
	it("observes a durable stop requested before the owner starts monitoring", async () => {
		const { requestRunCancellation, monitorRunCancellation } = await import("./cancellation");
		await requestRunCancellation("run-1", "USER_STOPPED");
		expect(mocks.redis.set).toHaveBeenCalledWith("test:agent-cancellation:run-1", "USER_STOPPED", "PX", 900_000);
		const controller = new AbortController();
		const cleanup = await monitorRunCancellation("run-1", controller);
		expect(controller.signal.reason).toMatchObject({ name: "AbortError", message: "USER_STOPPED" });
		cleanup();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("aborts the owner when another instance requests cancellation", async () => {
		const remote = await import("./cancellation");
		vi.resetModules();
		const owner = await import("./cancellation");
		const controller = new AbortController();
		const cleanup = await owner.monitorRunCancellation("run-2", controller);
		await remote.requestRunCancellation("run-2", "USER_ARCHIVED");
		expect(controller.signal.aborted).toBe(false);
		await vi.advanceTimersByTimeAsync(1_000);
		expect(controller.signal.reason).toMatchObject({ name: "AbortError", message: "USER_ARCHIVED" });
		cleanup();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("cleanup stops polling and unregisters the local controller", async () => {
		const { monitorRunCancellation, requestRunCancellation } = await import("./cancellation");
		const controller = new AbortController();
		const cleanup = await monitorRunCancellation("run-3", controller);
		cleanup();
		await vi.advanceTimersByTimeAsync(5_000);
		expect(mocks.redis.get).toHaveBeenCalledTimes(1);
		await requestRunCancellation("run-3", "USER_STOPPED");
		expect(controller.signal.aborted).toBe(false);
	});

	it("aborts safely if Redis monitoring fails", async () => {
		const { monitorRunCancellation } = await import("./cancellation");
		const controller = new AbortController();
		mocks.redis.get.mockRejectedValueOnce(new Error("Disconnected"));
		const cleanup = await monitorRunCancellation("run-4", controller);
		expect(controller.signal.reason).toMatchObject({ name: "AbortError", message: "CANCELLATION_UNAVAILABLE" });
		cleanup();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("does not overlap polls or reschedule an in-flight check after cleanup", async () => {
		const { monitorRunCancellation } = await import("./cancellation");
		const cleanup = await monitorRunCancellation("slow-run", new AbortController());
		const result = Promise.withResolvers<string | null>();
		mocks.redis.get.mockReturnValueOnce(result.promise);
		await vi.advanceTimersByTimeAsync(5_000);
		expect(mocks.redis.get).toHaveBeenCalledTimes(2);
		cleanup();
		result.resolve(null);
		await result.promise;
		expect(vi.getTimerCount()).toBe(0);
	});

	it("retains local cancellation without Redis", async () => {
		mocks.getRedis.mockReturnValue(null);
		const { monitorRunCancellation, requestRunCancellation } = await import("./cancellation");
		const controller = new AbortController();
		const cleanup = await monitorRunCancellation("run-5", controller);
		await requestRunCancellation("run-5", "USER_DELETED");
		expect(controller.signal.reason).toMatchObject({ name: "AbortError", message: "USER_DELETED" });
		expect(mocks.redis.get).not.toHaveBeenCalled();
		expect(mocks.redis.set).not.toHaveBeenCalled();
		cleanup();
	});

	it("keeps heartbeating after abort until the owner releases the run", async () => {
		const { monitorRunCancellation } = await import("./cancellation");
		const controller = new AbortController();
		const cleanup = await monitorRunCancellation("run-6", controller);
		controller.abort();
		mocks.redis.set.mockClear();
		await vi.advanceTimersByTimeAsync(2_000);
		expect(mocks.redis.set).toHaveBeenCalledWith("test:agent-run-alive:run-6", "1", "PX", 10_000);
		cleanup();
		mocks.redis.set.mockClear();
		await vi.advanceTimersByTimeAsync(2_000);
		expect(mocks.redis.set).not.toHaveBeenCalled();
	});

	it("reports a run dead only after its heartbeat is gone and the start grace has passed", async () => {
		const { isRunAlive } = await import("./cancellation");
		const old = new Date(Date.now() - 60_000);
		expect(await isRunAlive("run-7", old)).toBe(false);
		expect(await isRunAlive("run-7", new Date())).toBe(true);
		mocks.values.set("test:agent-run-alive:run-7", "1");
		expect(await isRunAlive("run-7", old)).toBe(true);
		mocks.getRedis.mockReturnValue(null);
		mocks.values.clear();
		expect(await isRunAlive("run-7", old)).toBe(true);
	});
});
