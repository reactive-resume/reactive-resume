import { ORPCError } from "@orpc/server";
import { createRateLimiter } from "../../redis";

type PublicRenderRateLimitInput = {
	/** Sanitized transport identity supplied by the server adapter, never by request headers. */
	trustedClient: string;
	resumeId: string;
};

export type PublicRenderRateLimiter = {
	consume(input: PublicRenderRateLimitInput): Promise<void>;
};

export function createPublicRenderRateLimiter(
	options: { capacity?: number; refillWindowMs?: number } = {},
): PublicRenderRateLimiter {
	const limiter = createRateLimiter("public-render", {
		maxRequests: options.capacity ?? 6,
		window: options.refillWindowMs ?? 60_000,
	});

	return {
		async consume(input) {
			const trustedClient = input.trustedClient.trim() || "unknown";
			const { success } = await limiter.limit(`${trustedClient}:${input.resumeId}`);

			if (!success) {
				throw new ORPCError("RATE_LIMIT_EXCEEDED", {
					status: 429,
					message: "Public resume rendering rate limit exceeded.",
				});
			}
		},
	};
}

export const publicRenderRateLimiter = createPublicRenderRateLimiter();
