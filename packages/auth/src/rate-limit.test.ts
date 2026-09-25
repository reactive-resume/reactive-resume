import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	env: { REDIS_URL: undefined as string | undefined, DEPLOYMENT_NAMESPACE: "preview-1" },
	eval: vi.fn(),
	on: vi.fn(),
	construct: vi.fn(),
}));
vi.mock("@reactive-resume/env/server", () => ({ env: mocks.env }));
vi.mock("ioredis", () => ({
	Redis: class {
		eval = mocks.eval;
		on = mocks.on;
		constructor(...args: unknown[]) {
			mocks.construct(...args);
		}
	},
}));

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	mocks.env.REDIS_URL = "redis://example.test:6379";
});

describe("authRateLimitStorage", () => {
	it("leaves Better Auth's default storage intact without Redis", async () => {
		mocks.env.REDIS_URL = undefined;
		const { authRateLimitStorage } = await import("./rate-limit");
		expect(authRateLimitStorage).toBeUndefined();
		expect(mocks.construct).not.toHaveBeenCalled();
	});

	it("lazily shares a client and atomically consumes namespaced limits in milliseconds", async () => {
		const { authRateLimitStorage } = await import("./rate-limit");
		expect(mocks.construct).not.toHaveBeenCalled();
		mocks.eval.mockResolvedValueOnce([1, 0]).mockResolvedValueOnce([0, 7]);
		expect(await authRateLimitStorage?.consume("sign-in:ip", { window: 10, max: 3 })).toEqual({
			allowed: true,
			retryAfter: null,
		});
		expect(await authRateLimitStorage?.consume("sign-in:ip", { window: 10, max: 3 })).toEqual({
			allowed: false,
			retryAfter: 7,
		});
		expect(mocks.construct).toHaveBeenCalledTimes(1);
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
