import { ORPCError } from "@orpc/server";
import { createRateLimiter } from "../../redis";

const limiter = createRateLimiter("public-render", { maxRequests: 6, window: 60_000 });
// Each resume has its own budget per visitor; this one bounds a visitor rendering many resumes.
const clientLimiter = createRateLimiter("public-render-client", { maxRequests: 30, window: 60_000 });

export const publicRenderRateLimiter = {
	/** `trustedClient` is the sanitized transport identity supplied by the server adapter, never by request headers. */
	async consume(input: { trustedClient: string; resumeId: string }) {
		const trustedClient = input.trustedClient.trim() || "unknown";
		const client = await clientLimiter.limit(trustedClient);
		const { success } = client.success ? await limiter.limit(`${trustedClient}:${input.resumeId}`) : client;

		if (!success) {
			throw new ORPCError("RATE_LIMIT_EXCEEDED", {
				status: 429,
				message: "Too many requests for this resume. Try again in a few minutes.",
			});
		}
	},
};
