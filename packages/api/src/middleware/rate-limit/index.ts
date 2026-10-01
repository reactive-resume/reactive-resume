import type { Ratelimiter } from "@orpc/experimental-ratelimit";
import { createRatelimitMiddleware } from "@orpc/experimental-ratelimit";
import { ORPCError } from "@orpc/server";
import { env } from "@reactive-resume/env/server";
import { rateLimitConfig } from "@reactive-resume/utils/rate-limit";
import { createRateLimiter } from "../../redis";

const isRateLimitEnabled = process.env.NODE_ENV === "production" && !env.FLAG_DISABLE_API_RATE_LIMIT;

type ContextWithHeaders = {
	reqHeaders?: Headers;
	user?: { id: string } | null;
	trustedClient?: string;
};

export function getClientKey(trustedClient?: string): string {
	return `ip:${trustedClient?.trim() || "unknown"}`;
}

function getUserKey(context: ContextWithHeaders): string {
	return context.user?.id ?? "anon";
}

function getInputKeyPart(input: unknown): string {
	if (!input || typeof input !== "object") return "no-input";

	const inputRecord = input as Record<string, unknown>;

	const fields = ["resumeId", "threadId", "conversationId", "messageId", "fileId", "id"] as const;
	for (const field of fields) {
		const value = inputRecord[field];
		if (typeof value !== "string") continue;

		const trimmedValue = value.trim();
		if (trimmedValue) return `${field}:${trimmedValue}`;
	}

	const username = inputRecord.username;
	const slug = inputRecord.slug;

	if (typeof username === "string" && typeof slug === "string") return `${username}:${slug}`;

	return "no-id";
}

const resumePasswordLimiter = createRateLimiter("resumePasswordLimiter", rateLimitConfig.orpc.resumePassword);
const pdfLimiter = createRateLimiter("pdfLimiter", rateLimitConfig.orpc.pdfExport);
const resumeDownloadLimiter = createRateLimiter("resumeDownloadLimiter", rateLimitConfig.orpc.pdfExport);
const aiLimiter = createRateLimiter("aiLimiter", rateLimitConfig.orpc.aiRequest);
const storageUploadLimiter = createRateLimiter("storageUploadLimiter", rateLimitConfig.orpc.storageUpload);
const storageDeleteLimiter = createRateLimiter("storageDeleteLimiter", rateLimitConfig.orpc.storageDelete);
const resumeMutationLimiter = createRateLimiter("resumeMutationLimiter", rateLimitConfig.orpc.resumeMutations);
const disabledLimiter = {
	// oxlint-disable-next-line require-await -- The limiter contract returns a Promise even when rate limiting is disabled.
	limit: async () => ({
		success: true,
		remaining: Number.POSITIVE_INFINITY,
		reset: Date.now(),
	}),
};

const productionLimiter = (limiter: Ratelimiter) => (isRateLimitEnabled ? limiter : disabledLimiter);

export const resumePasswordRateLimit = createRatelimitMiddleware<
	ContextWithHeaders,
	{ username: string; slug: string }
>({
	limiter: productionLimiter(resumePasswordLimiter),
	key: ({ context }, input) => `resume-password:${input.username}:${input.slug}:${getClientKey(context.trustedClient)}`,
});

export const pdfExportRateLimit = createRatelimitMiddleware<ContextWithHeaders, { id: string }>({
	limiter: productionLimiter(pdfLimiter),
	key: ({ context }, input) => `pdf-export:${getUserKey(context)}:${input.id}`,
});

/** Shared by REST exports and signed download links, at the actual rendering boundary. */
export async function consumePdfExportLimit(input: { id: string; userId: string; resHeaders?: Headers }) {
	const result = await productionLimiter(pdfLimiter).limit(`pdf-export:${input.userId}:${input.id}`);
	const reset = result.reset ?? Date.now() + 60_000;
	input.resHeaders?.set("ratelimit-remaining", String(result.remaining));
	input.resHeaders?.set("ratelimit-reset", String(reset));
	if (!result.success) {
		input.resHeaders?.set("retry-after", String(Math.max(1, Math.ceil((reset - Date.now()) / 1000))));
		throw new ORPCError("TOO_MANY_REQUESTS", { data: { reset } });
	}
}

export const resumeDownloadRateLimit = createRatelimitMiddleware<
	ContextWithHeaders,
	{ username: string; slug: string }
>({
	limiter: productionLimiter(resumeDownloadLimiter),
	key: ({ context }, input) =>
		`resume-download:${input.username}:${input.slug}:${getUserKey(context)}:${getClientKey(context.trustedClient)}`,
});

export const aiRequestRateLimit = createRatelimitMiddleware<ContextWithHeaders, unknown>({
	limiter: productionLimiter(aiLimiter),
	key: ({ context }, input) => `ai-request:${getUserKey(context)}:${getInputKeyPart(input)}`,
});

export const storageUploadRateLimit = createRatelimitMiddleware<ContextWithHeaders, unknown>({
	limiter: productionLimiter(storageUploadLimiter),
	key: ({ context }) => `storage-upload:${getUserKey(context)}`,
});

export const storageDeleteRateLimit = createRatelimitMiddleware<ContextWithHeaders, { filename: string }>({
	limiter: productionLimiter(storageDeleteLimiter),
	key: ({ context }, input) => `storage-delete:${getUserKey(context)}:${input.filename}`,
});

export const resumeMutationRateLimit = createRatelimitMiddleware<ContextWithHeaders, unknown>({
	limiter: productionLimiter(resumeMutationLimiter),
	key: ({ context }, input) => `resume-mutation:${getUserKey(context)}:${getInputKeyPart(input)}`,
});

const pdfAnalysisLimiter = createRateLimiter("pdfAnalysisLimiter", rateLimitConfig.orpc.pdfExport);
export const pdfAnalysisRateLimit = createRatelimitMiddleware<ContextWithHeaders, unknown>({
	limiter: productionLimiter(pdfAnalysisLimiter),
	key: ({ context }) => `pdf-analysis:${getClientKey(context.trustedClient)}`,
});
