import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pool = vi.hoisted(() => ({
	query: vi.fn().mockResolvedValue(undefined),
	connect: vi.fn(),
}));

vi.mock("@reactive-resume/db/client", () => ({ getPool: () => pool }));
const redis = vi.hoisted(() => ({ getRedis: vi.fn(), publish: vi.fn(), duplicate: vi.fn() }));
vi.mock("@reactive-resume/db/redis", () => ({
	getRedis: redis.getRedis,
	redisKey: (key: string) => `reactive-resume:preview:${key}`,
}));

beforeEach(() => {
	vi.clearAllMocks();
	redis.getRedis.mockReturnValue(null);
});

const { publishResumeUpdated, subscribeResumeUpdated } = await import("./events");

const exampleEvent = {
	type: "resume.updated" as const,
	resumeId: "r1",
	userId: "u1",
	updatedAt: "2024-01-01T00:00:00Z",
	mutation: "patch" as const,
};

describe("publishResumeUpdated", () => {
	it("publishes through namespaced Redis when configured without querying Postgres", async () => {
		redis.getRedis.mockReturnValue(redis);
		await publishResumeUpdated(exampleEvent);
		expect(redis.publish).toHaveBeenCalledWith("reactive-resume:preview:resume_updated", JSON.stringify(exampleEvent));
		expect(pool.query).not.toHaveBeenCalled();
	});

	it("issues a pg_notify with the channel and serialized event", async () => {
		pool.query.mockClear();

		await publishResumeUpdated(exampleEvent);

		expect(pool.query).toHaveBeenCalledTimes(1);
		// oxlint-disable-next-line typescript/no-non-null-assertion -- The assertion above verifies the query call exists before destructuring it.
		const [sql, params] = pool.query.mock.calls[0]!;
		expect(sql).toBe("SELECT pg_notify($1, $2)");
		expect(params?.[0]).toBe("resume_updated");
		expect(JSON.parse(params?.[1] as string)).toEqual(exampleEvent);
	});
});

function makeSubscriber() {
	const emitter = new EventEmitter();
	return Object.assign(emitter, {
		subscribe: vi.fn().mockResolvedValue(1),
		disconnect: vi.fn(),
		send(channel: string, payload: string) {
			emitter.emit("message", channel, payload);
		},
	});
}

describe("Redis resume subscriptions", () => {
	it("uses a dedicated subscriber, filters messages, and closes it on abort", async () => {
		const subscriber = makeSubscriber();
		redis.getRedis.mockReturnValue(redis);
		redis.duplicate.mockReturnValue(subscriber);
		const controller = new AbortController();
		const iterator = subscribeResumeUpdated({ resumeId: "r1", userId: "u1", signal: controller.signal });
		const first = iterator.next();
		const channel = "reactive-resume:preview:resume_updated";
		subscriber.send("other", JSON.stringify(exampleEvent));
		subscriber.send(channel, "not json");
		subscriber.send(channel, JSON.stringify({ ...exampleEvent, userId: "other" }));
		subscriber.send(channel, JSON.stringify(exampleEvent));
		expect(await first).toEqual({ done: false, value: exampleEvent });
		const next = iterator.next();
		controller.abort();
		expect((await next).done).toBe(true);
		expect(redis.duplicate).toHaveBeenCalledWith({ commandTimeout: 5_000 });
		expect(subscriber.subscribe).toHaveBeenCalledWith(channel);
		expect(subscriber.disconnect).toHaveBeenCalledTimes(1);
		expect(subscriber.listenerCount("message")).toBe(0);
		expect(subscriber.listenerCount("error")).toBe(0);
		expect(pool.connect).not.toHaveBeenCalled();
	});

	it("disconnects if aborted while the Redis subscription is still connecting", async () => {
		const subscriber = makeSubscriber();
		subscriber.subscribe.mockReturnValue(new Promise(() => {}));
		redis.getRedis.mockReturnValue(redis);
		redis.duplicate.mockReturnValue(subscriber);
		const controller = new AbortController();
		const iterator = subscribeResumeUpdated({ resumeId: "r1", userId: "u1", signal: controller.signal });
		const next = iterator.next();
		controller.abort();
		expect((await next).done).toBe(true);
		expect(subscriber.disconnect).toHaveBeenCalledTimes(1);
	});

	it("closes the duplicate when subscription setup fails", async () => {
		const subscriber = makeSubscriber();
		subscriber.subscribe.mockRejectedValue(new Error("subscribe failed"));
		redis.getRedis.mockReturnValue(redis);
		redis.duplicate.mockReturnValue(subscriber);
		const iterator = subscribeResumeUpdated({ resumeId: "r1", userId: "u1" });
		await expect(iterator.next()).rejects.toThrow("subscribe failed");
		expect(subscriber.disconnect).toHaveBeenCalledTimes(1);
	});
});

const makeFakeClient = () => {
	const emitter = new EventEmitter();
	return Object.assign(emitter, {
		query: vi.fn().mockResolvedValue(undefined),
		release: vi.fn(),
		__notify(channel: string, payload: string) {
			emitter.emit("notification", { channel, payload });
		},
	});
};

describe("subscribeResumeUpdated", () => {
	it("yields events whose resumeId and userId match the subscription", async () => {
		const client = makeFakeClient();
		pool.connect.mockResolvedValueOnce(client);

		const controller = new AbortController();
		const iterator = subscribeResumeUpdated({
			resumeId: "r1",
			userId: "u1",
			signal: controller.signal,
		});

		// Kick the generator so listeners are installed, then push a notification.
		const firstP = iterator.next();
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		client.__notify("resume_updated", JSON.stringify(exampleEvent));

		const first = await firstP;
		expect(first.done).toBe(false);
		expect(first.value).toEqual(exampleEvent);

		controller.abort();
		const last = await iterator.next();
		expect(last.done).toBe(true);

		expect(client.query).toHaveBeenCalledWith("LISTEN resume_updated");
		expect(client.query).toHaveBeenCalledWith("UNLISTEN resume_updated");
		expect(client.release).toHaveBeenCalled();
	});
});
