import type z from "zod";
import { ORPCError } from "@orpc/client";
import { APICallError, generateText, RetryError } from "ai";
import { safetySystemPrompt } from "@reactive-resume/ai/prompts";
import { aiDeadline, generateJson as sharedGenerateJson } from "./generate-json";

// --- AI provider failure translation ------------------------------------------
// The AI SDK surfaces provider-side failures as `APICallError` (HTTP 4xx/5xx from
// the provider) or `RetryError` with `reason: "maxRetriesExceeded"`.  Translating
// only those to BAD_GATEWAY gives the client an actionable status code instead of
// an opaque 500.  Validation, credential, model-resolution, and response-parsing
// errors rethrow unchanged.

function isAiProviderGatewayError(error: unknown): boolean {
	if (APICallError.isInstance(error)) return true;
	if (RetryError.isInstance(error) && error.reason === "maxRetriesExceeded") return true;
	return false;
}

/** Throws a BAD_GATEWAY ORPCError, preserving the original cause for upstream error reporters. */
function throwAiProviderGatewayError(cause?: unknown): never {
	throw new ORPCError("BAD_GATEWAY", {
		message: "Couldn't reach the AI provider. Check its settings and try again.",
		cause,
	});
}

/**
 * Wrapper around the shared `generateJson` that translates AI provider failures
 * to BAD_GATEWAY.  Accepts the same prompt shape as the shared module.
 * Exported for tests.
 */
export async function generateJson<T>(
	model: Parameters<typeof sharedGenerateJson>[0],
	prompt: { system?: string; prompt: string },
	schema: z.ZodType<T>,
	signal?: AbortSignal,
	maxRetries?: number,
) {
	try {
		return await sharedGenerateJson(model, prompt, schema, signal, maxRetries);
	} catch (error) {
		if (isAiProviderGatewayError(error)) throwAiProviderGatewayError(error);
		throw error;
	}
}

/** Exported for tests: provider-failure translation shared by every copilot procedure. */
export async function generatePlainText(
	model: Parameters<typeof sharedGenerateJson>[0],
	prompt: string,
	signal?: AbortSignal,
) {
	try {
		const { text } = await generateText({
			model,
			abortSignal: aiDeadline(signal),
			maxRetries: 0,
			system: safetySystemPrompt,
			messages: [{ role: "user", content: prompt }],
		});
		return text.trim();
	} catch (error) {
		if (isAiProviderGatewayError(error)) throwAiProviderGatewayError(error);
		throw error;
	}
}
