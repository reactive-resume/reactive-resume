import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
	run: vi.fn<() => Promise<{ processed: number }>>(),
	cleanup: vi.fn<() => Promise<unknown>>(),
	env: {
		CRON_SECRET: "synthetic-career-runner-secret-32-characters" as string | undefined,
	},
}));
vi.mock("@reactive-resume/env/server", () => ({ env: mocks.env }));
vi.mock("@reactive-resume/api/features/career/jobs", () => ({ runCareerJobs: mocks.run }));
vi.mock("@reactive-resume/api/features/storage/cleanup", () => ({
	runStorageCleanup: mocks.cleanup,
	reportStorageCleanupSummary: vi.fn(),
}));

beforeEach(() => {
	mocks.run.mockReset().mockResolvedValue({ processed: 2 });
	mocks.cleanup.mockReset().mockResolvedValue({ completed: 0, missing: 0, failed: 0, partial: 0, abandoned: 0 });
	mocks.env.CRON_SECRET = "synthetic-career-runner-secret-32-characters";
});

describe("career scheduler authentication", () => {
	it("hides an unconfigured runner", async () => {
		mocks.env.CRON_SECRET = undefined;
		const { handleCareerJobs } = await import("./career-jobs");
		const response = await handleCareerJobs(new Request("http://localhost:3000/api/career/run", { method: "POST" }));
		expect(response.status).toBe(404);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(mocks.run).not.toHaveBeenCalled();
	});

	it.each([undefined, "Bearer short", "Bearer synthetic-career-runner-secret-32-characterX"])(
		"rejects invalid authorization %s without running paid work",
		async (authorization) => {
			const { handleCareerJobs } = await import("./career-jobs");
			const response = await handleCareerJobs(
				new Request("http://localhost:3000/api/career/run", {
					method: "POST",
					headers: authorization ? { authorization } : {},
				}),
			);
			expect(response.status).toBe(401);
			expect(response.headers.get("cache-control")).toBe("no-store");
			expect(await response.text()).toBe("");
			expect(mocks.run).not.toHaveBeenCalled();
		},
	);

	it("keeps the career tick result when storage cleanup fails", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		mocks.cleanup.mockRejectedValueOnce(new Error("private storage key"));
		const { handleCareerJobs } = await import("./career-jobs");
		const response = await handleCareerJobs(
			new Request("http://localhost:3000/api/career/run", {
				method: "POST",
				headers: { authorization: `Bearer ${mocks.env.CRON_SECRET}` },
			}),
		);
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ processed: 2 });
		expect(log).toHaveBeenCalledOnce();
		expect(JSON.stringify(log.mock.calls)).not.toContain("private storage key");
	});

	it.each(["GET", "POST"])("runs one bounded %s tick for CRON_SECRET", async (method) => {
		const { handleCareerJobs } = await import("./career-jobs");
		const response = await handleCareerJobs(
			new Request("http://localhost:3000/api/career/run", {
				method,
				headers: { authorization: `Bearer ${mocks.env.CRON_SECRET}` },
			}),
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		await expect(response.json()).resolves.toEqual({ processed: 2 });
		expect(mocks.run).toHaveBeenCalledTimes(1);
	});
});
