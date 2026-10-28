import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({ eval: vi.fn(), redis: null as { eval: ReturnType<typeof vi.fn> } | null }));
vi.mock("@reactive-resume/db/redis", () => ({
	getRedis: () => mocks.redis,
	redisKey: (...parts: string[]) => ["reactive-resume", "preview-1", ...parts].join(":"),
}));

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	mocks.redis = { eval: mocks.eval };
});

describe("authRateLimitStorage", () => {
	it("retains active limits when outage traffic fills the fallback map", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const { authRateLimitStorage } = await import("./rate-limit");
		mocks.eval.mockRejectedValue(new Error("offline"));
		const rule = { window: 3600, max: 1 };
		expect((await authRateLimitStorage?.consume("protected-login", rule))?.allowed).toBe(true);
		for (let i = 0; i < 10_005; i++) await authRateLimitStorage?.consume(`other-${i}`, rule);
		expect((await authRateLimitStorage?.consume("protected-login", rule))?.allowed).toBe(false);
		expect((await authRateLimitStorage?.consume("new-key", rule))?.allowed).toBe(false);
	});
	it("atomically consumes namespaced limits in milliseconds", async () => {
		const { authRateLimitStorage } = await import("./rate-limit");
		mocks.eval.mockResolvedValueOnce([1, 0]).mockResolvedValueOnce([0, 7]);
		expect(await authRateLimitStorage?.consume("sign-in:ip", { window: 10, max: 3 })).toEqual({
			allowed: true,
			retryAfter: null,
		});
		expect(await authRateLimitStorage?.consume("sign-in:ip", { window: 10, max: 3 })).toEqual({
			allowed: false,
			retryAfter: 7,
		});
		expect(mocks.eval).toHaveBeenCalledWith(
			expect.stringContaining("redis.call('PEXPIRE', KEYS[1], ARGV[1])"),
			1,
			"reactive-resume:preview-1:auth:sign-in:ip",
			10_000,
			3,
		);
	});

	it("falls back to per-instance limits when Redis fails or returns malformed data", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const { authRateLimitStorage } = await import("./rate-limit");
		mocks.eval.mockRejectedValue(new Error("connection unavailable"));
		const rule = { window: 10, max: 2 };
		expect(await authRateLimitStorage?.consume("sign-in:ip", rule)).toEqual({ allowed: true, retryAfter: null });
		mocks.eval.mockResolvedValue(null);
		expect(await authRateLimitStorage?.consume("sign-in:ip", rule)).toEqual({ allowed: true, retryAfter: null });
		expect(await authRateLimitStorage?.consume("sign-in:ip", rule)).toEqual({ allowed: false, retryAfter: 10 });
		expect(await authRateLimitStorage?.consume("other:ip", rule)).toEqual({ allowed: true, retryAfter: null });
	});
});
