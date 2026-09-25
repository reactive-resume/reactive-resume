import { beforeEach, describe, expect, it, vi } from "vitest";

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
	it("leaves Better Auth's default storage intact without Redis", async () => {
		mocks.redis = null;
		const { authRateLimitStorage } = await import("./rate-limit");
		expect(authRateLimitStorage).toBeUndefined();
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

	it("fails closed when Redis fails or returns malformed data", async () => {
		const { authRateLimitStorage } = await import("./rate-limit");
		mocks.eval.mockRejectedValueOnce(new Error("connection unavailable")).mockResolvedValueOnce(null);
		for (let attempt = 0; attempt < 2; attempt++) {
			expect(await authRateLimitStorage?.consume("sign-in:ip", { window: 10, max: 3 })).toEqual({
				allowed: false,
				retryAfter: 10,
			});
		}
	});
});
