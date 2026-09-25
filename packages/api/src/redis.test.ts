import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const env = { REDIS_URL: "", DEPLOYMENT_NAMESPACE: "" };
	const evalScript = vi.fn();
	const on = vi.fn();
	const Redis = vi.fn(
		class {
			eval = evalScript;
			on = on;
		},
	);
	return { env, evalScript, on, Redis };
});

vi.mock("@reactive-resume/env/server", () => ({ env: mocks.env }));
vi.mock("ioredis", () => ({ Redis: mocks.Redis }));

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	mocks.env.REDIS_URL = "";
	mocks.env.DEPLOYMENT_NAMESPACE = "";
});

describe("shared Redis", () => {
	it("retains working memory limits when Redis is absent", async () => {
		const { getRedis, createRateLimiter, redisKey } = await import("./redis");
		expect(getRedis()).toBeNull();
		expect(redisKey("views", "resume-1")).toBe("reactive-resume:default:views:resume-1");
		const limiter = createRateLimiter("test", { maxRequests: 1, window: 60_000 });
		await expect(limiter.limit("visitor")).resolves.toMatchObject({ success: true });
		await expect(limiter.limit("visitor")).resolves.toMatchObject({ success: false });
		expect(mocks.Redis).not.toHaveBeenCalled();
	});

	it("lazily shares a client and namespaces the installed Redis limiter", async () => {
		mocks.env.REDIS_URL = "rediss://example.test:6379";
		mocks.env.DEPLOYMENT_NAMESPACE = "preview-123";
		const { getRedis, createRateLimiter } = await import("./redis");
		expect(mocks.Redis).not.toHaveBeenCalled();
		const client = getRedis();
		expect(getRedis()).toBe(client);
		expect(mocks.Redis).toHaveBeenCalledExactlyOnceWith(mocks.env.REDIS_URL, {
			lazyConnect: true,
			maxRetriesPerRequest: 2,
			connectTimeout: 5_000,
			commandTimeout: 5_000,
		});
		expect(mocks.on).toHaveBeenCalledWith("error", expect.any(Function));
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
