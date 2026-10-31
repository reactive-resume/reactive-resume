import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { startStorageCleanupScheduler } from "./storage-cleanup";

const run = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
const report = vi.hoisted(() => vi.fn());
vi.mock("@reactive-resume/api/features/storage/cleanup", () => ({
	runStorageCleanup: run,
	reportStorageCleanupSummary: report,
}));

beforeEach(() => {
	vi.useFakeTimers();
	run.mockReset().mockResolvedValue({ completed: 0, missing: 0, failed: 0, partial: 0, abandoned: 0 });
	report.mockReset();
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

it("starts immediately, skips overlapping ticks, and drains active work before stopping", async () => {
	const first = Promise.withResolvers<unknown>();
	run.mockReturnValueOnce(first.promise);
	const scheduler = startStorageCleanupScheduler();
	await vi.advanceTimersByTimeAsync(0);
	expect(run).toHaveBeenCalledTimes(1);
	await vi.advanceTimersByTimeAsync(120_000);
	expect(run).toHaveBeenCalledTimes(1);

	first.resolve({ completed: 1 });
	await vi.advanceTimersByTimeAsync(60_000);
	expect(run).toHaveBeenCalledTimes(2);

	const stopped = vi.fn();
	const drain = scheduler.stop().then(stopped);
	await vi.advanceTimersByTimeAsync(120_000);
	await drain;
	expect(stopped).toHaveBeenCalledOnce();
	await vi.advanceTimersByTimeAsync(60_000);
	expect(run).toHaveBeenCalledTimes(2);
});

it("forwards a resolved failure summary to the sanitized signal", async () => {
	const summary = { completed: 0, missing: 0, failed: 1, partial: 1, abandoned: 1 };
	run.mockResolvedValueOnce(summary);
	const scheduler = startStorageCleanupScheduler();
	try {
		await vi.advanceTimersByTimeAsync(0);
		expect(report).toHaveBeenCalledWith(summary);
	} finally {
		await scheduler.stop();
	}
});

it("logs a failed tick without exposing cleanup payloads, then retries later", async () => {
	const log = vi.spyOn(console, "error").mockImplementation(() => {});
	run.mockRejectedValueOnce(new Error("private storage key"));
	const scheduler = startStorageCleanupScheduler();
	try {
		await vi.advanceTimersByTimeAsync(0);
		expect(log).toHaveBeenCalledOnce();
		expect(JSON.stringify(log.mock.calls)).not.toContain("private storage key");
		await vi.advanceTimersByTimeAsync(60_000);
		expect(run).toHaveBeenCalledTimes(2);
	} finally {
		await scheduler.stop();
	}
});
