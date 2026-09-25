import type { BetterAuthOptions } from "better-auth";
import { getRedis, redisKey } from "@reactive-resume/db/redis";

// Match Better Auth's rolling inactivity window: only accepted requests extend it.
const consumeScript = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if count >= tonumber(ARGV[2]) then
  return {0, math.max(1, math.ceil(redis.call('PTTL', KEYS[1]) / 1000))}
end
redis.call('INCR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], ARGV[1])
return {1, 0}
`;

const redis = getRedis();

export const authRateLimitStorage: NonNullable<BetterAuthOptions["rateLimit"]>["customStorage"] = redis
	? {
			async consume(key, rule) {
				try {
					const result = await redis.eval(consumeScript, 1, redisKey("auth", key), rule.window * 1_000, rule.max);
					if (!Array.isArray(result) || result.length !== 2) throw new Error("Invalid rate limit result");
					return { allowed: result[0] === 1, retryAfter: result[0] === 1 ? null : Number(result[1]) };
				} catch {
					return { allowed: false, retryAfter: rule.window };
				}
			},
		}
	: undefined;
