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
	return ["reactive-resume", env.DEPLOYMENT_NAMESPACE, ...parts].join(":");
}
