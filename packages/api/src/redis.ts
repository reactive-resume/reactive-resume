import type { Ratelimiter } from "@orpc/experimental-ratelimit";
import type { MemoryRatelimiterOptions } from "@orpc/experimental-ratelimit/memory";
import { MemoryRatelimiter } from "@orpc/experimental-ratelimit/memory";
import { RedisRatelimiter } from "@orpc/experimental-ratelimit/redis";
import { getCoordination } from "@reactive-resume/db/coordination";
import { getRedis, redisKey } from "@reactive-resume/db/redis";

export function createRateLimiter(name: string, config: MemoryRatelimiterOptions): Ratelimiter {
	const memory = new MemoryRatelimiter(config);
	const client = getRedis();
	if (!client)
		return {
			async limit(key) {
				const service = getCoordination();
				if (!service) return memory.limit(key);
				const result = await service.consume(redisKey("rate-limit", name, key), {
					window: config.window,
					max: config.maxRequests,
				});
				return { success: result.allowed, remaining: result.remaining, reset: result.reset };
			},
		};
	const shared = new RedisRatelimiter({
		...config,
		prefix: `${redisKey("rate-limit", name)}:`,
		eval: (script, numKeys, ...args) => client.eval(script, numKeys, ...args),
	});
	return {
		async limit(key) {
			try {
				return await shared.limit(key);
			} catch (error) {
				// Keep requests available and still limited per instance while Redis is unreachable.
				console.error(`[redis] Rate limiter "${name}" unavailable; using per-instance limits`, error);
				return memory.limit(key);
			}
		},
	};
}
