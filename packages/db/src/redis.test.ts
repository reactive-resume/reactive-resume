import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const env = { REDIS_URL: "", DEPLOYMENT_NAMESPACE: "default" };
	const on = vi.fn();
	const Redis = vi.fn(
		class {
			on = on;
		},
	);
	return { env, on, Redis };
});

vi.mock("@reactive-resume/env/server", () => ({ env: mocks.env }));
vi.mock("ioredis", () => ({ Redis: mocks.Redis }));

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	mocks.env.REDIS_URL = "";
	mocks.env.DEPLOYMENT_NAMESPACE = "default";
});

describe("shared Redis", () => {
	it("returns no client when Redis is not configured", async () => {
		const { getRedis } = await import("./redis");
		expect(getRedis()).toBeNull();
		expect(mocks.Redis).not.toHaveBeenCalled();
	});

	it("lazily creates one shared client", async () => {
		mocks.env.REDIS_URL = "rediss://example.test:6379";
		const { getRedis } = await import("./redis");
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
	});

	it("namespaces keys by deployment", async () => {
		mocks.env.DEPLOYMENT_NAMESPACE = "preview-123";
		const { redisKey } = await import("./redis");
		expect(redisKey("views", "resume-1")).toBe("reactive-resume:preview-123:views:resume-1");
	});
});
