import { ORPCError } from "@orpc/server";
import { env } from "@reactive-resume/env/server";
import { createRateLimiter } from "../../redis";

const requestLimiter = createRateLimiter("mcp-requests", { maxRequests: 600, window: 60_000 });
const userLimiter = createRateLimiter("mcp-user-requests", { maxRequests: 600, window: 60_000 });

async function consume(limiter: typeof requestLimiter, key: string) {
	if (env.FLAG_DISABLE_API_RATE_LIMIT) return;
	const result = await limiter.limit(key);
	if (!result.success) {
		throw new ORPCError("TOO_MANY_REQUESTS", {
			message: "Too many MCP requests. Retry after the rate limit resets.",
			data: { reset: result.reset },
		});
	}
}

export const consumeMcpRequestLimit = (trustedClient: string) => consume(requestLimiter, trustedClient || "unknown");
export const consumeMcpUserLimit = (userId: string) => consume(userLimiter, userId);
