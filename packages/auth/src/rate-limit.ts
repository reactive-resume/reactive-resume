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

// Per-instance fallback while Redis is unreachable: login stays available and still rate limited.
const localCounts = new Map<string, { count: number; expiresAt: number }>();

function consumeLocally(key: string, rule: { window: number; max: number }) {
	const now = Date.now();
	const entry = localCounts.get(key);
	const active = entry && entry.expiresAt > now ? entry : undefined;
	if (active && active.count >= rule.max) {
		return { allowed: false, retryAfter: Math.max(1, Math.ceil((active.expiresAt - now) / 1000)) };
	}
	// ponytail: clear-all bound on outage memory; an LRU is unnecessary for a temporary fallback.
	if (localCounts.size >= 10_000) localCounts.clear();
	localCounts.set(key, { count: (active?.count ?? 0) + 1, expiresAt: now + rule.window * 1_000 });
	return { allowed: true, retryAfter: null };
}

export const authRateLimitStorage: NonNullable<BetterAuthOptions["rateLimit"]>["customStorage"] = redis
	? {
			async consume(key, rule) {
				try {
					const result = await redis.eval(consumeScript, 1, redisKey("auth", key), rule.window * 1_000, rule.max);
					if (!Array.isArray(result) || result.length !== 2) throw new Error("Invalid rate limit result");
					return { allowed: result[0] === 1, retryAfter: result[0] === 1 ? null : Number(result[1]) };
				} catch (error) {
					console.error("[auth] Redis rate limit unavailable; using per-instance limits", error);
					return consumeLocally(key, rule);
				}
			},
		}
	: undefined;
