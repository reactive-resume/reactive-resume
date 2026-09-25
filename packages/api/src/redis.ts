import type { Ratelimiter } from "@orpc/experimental-ratelimit";
import type { MemoryRatelimiterOptions } from "@orpc/experimental-ratelimit/memory";
import { MemoryRatelimiter } from "@orpc/experimental-ratelimit/memory";
import { RedisRatelimiter } from "@orpc/experimental-ratelimit/redis";
import { Redis } from "ioredis";
import { env } from "@reactive-resume/env/server";

let redis: Redis | undefined;

export function getRedis(): Redis | null {
	const url = env.REDIS_URL?.trim();
	if (!url) return null;
	if (!redis) {
		redis = new Redis(url, {
			lazyConnect: true,
			maxRetriesPerRequest: 2,
			connectTimeout: 5_000,
			commandTimeout: 5_000,
		});
		redis.on("error", (error) => console.error("[redis] Connection error", error));
	}
	return redis;
}

export function redisKey(...parts: string[]): string {
	return ["reactive-resume", env.DEPLOYMENT_NAMESPACE || "default", ...parts].join(":");
}

export function createRateLimiter(name: string, config: MemoryRatelimiterOptions): Ratelimiter {
	const client = getRedis();
	if (!client) return new MemoryRatelimiter(config);
	return new RedisRatelimiter({
		...config,
		prefix: `${redisKey("rate-limit", name)}:`,
		eval: (script, numKeys, ...args) => client.eval(script, numKeys, ...args),
	});
}
