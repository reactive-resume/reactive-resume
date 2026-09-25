import type { Ratelimiter } from "@orpc/experimental-ratelimit";
import type { MemoryRatelimiterOptions } from "@orpc/experimental-ratelimit/memory";
import { MemoryRatelimiter } from "@orpc/experimental-ratelimit/memory";
import { RedisRatelimiter } from "@orpc/experimental-ratelimit/redis";
import { getRedis, redisKey } from "@reactive-resume/db/redis";

export function createRateLimiter(name: string, config: MemoryRatelimiterOptions): Ratelimiter {
	const client = getRedis();
	if (!client) return new MemoryRatelimiter(config);
	return new RedisRatelimiter({
		...config,
		prefix: `${redisKey("rate-limit", name)}:`,
		eval: (script, numKeys, ...args) => client.eval(script, numKeys, ...args),
	});
}
