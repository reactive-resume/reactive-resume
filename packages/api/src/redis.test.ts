import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ evalScript: vi.fn(), redis: null as { eval: ReturnType<typeof vi.fn> } | null }));

vi.mock("@reactive-resume/db/redis", () => ({
	getRedis: () => mocks.redis,
	redisKey: (...parts: string[]) => ["reactive-resume", "preview-123", ...parts].join(":"),
}));

beforeEach(() => {
	vi.clearAllMocks();
	mocks.redis = null;
});

describe("createRateLimiter", () => {
	it("uses in-memory limits when Redis is absent", async () => {
		const { createRateLimiter } = await import("./redis");
		const limiter = createRateLimiter("test", { maxRequests: 1, window: 60_000 });
		await expect(limiter.limit("visitor")).resolves.toMatchObject({ success: true });
		await expect(limiter.limit("visitor")).resolves.toMatchObject({ success: false });
	});

	it("namespaces the Redis limiter", async () => {
		mocks.redis = { eval: mocks.evalScript };
		const { createRateLimiter } = await import("./redis");
		mocks.evalScript.mockResolvedValue([1, 5, 4, 1000]);
		const limiter = createRateLimiter("pdf", { maxRequests: 5, window: 60_000 });
		await expect(limiter.limit("user-1")).resolves.toMatchObject({ success: true, remaining: 4 });
		expect(mocks.evalScript).toHaveBeenCalledWith(
			expect.any(String),
			1,
			"reactive-resume:preview-123:rate-limit:pdf:user-1",
			expect.any(String),
			"60000",
			"5",
		);
		mocks.evalScript.mockRejectedValueOnce(new Error("Redis unavailable"));
		await expect(limiter.limit("user-1")).rejects.toThrow("Redis unavailable");
	});
});
