import type { LanguageModel } from "ai";
import { ORPCError } from "@orpc/client";
import { generateText } from "ai";
import { z } from "zod";
import { safetySystemPrompt } from "@reactive-resume/ai/prompts";

// A provider that stops responding can't hold a standalone request open forever. Streamed chats have their own budgets.
// Self-hosted local models that need longer (a CPU model reading a long PDF) can raise AI_REQUEST_TIMEOUT_MS.
const AI_REQUEST_TIMEOUT_MS = z.coerce
	.number()
	.int()
	.positive()
	.max(2_147_483_647)
	.catch(300_000)
	.parse(process.env.AI_REQUEST_TIMEOUT_MS?.trim() || undefined);

export function aiDeadline(signal?: AbortSignal) {
	const timeout = AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export type GenerateJsonPrompt = {
	system?: string;
	prompt: string;
};

/**
 * `generateText` plus tolerant JSON extraction and Zod validation.
 *
 * The SDK's `generateObject` is not wired for every provider this app supports, and several
 * providers wrap JSON in prose or a code fence whatever the prompt says, so the response is parsed
 * defensively: strip a fence if there is one, take the outermost braces, then validate.
 */
export async function generateJson<T>(
	model: LanguageModel,
	{ system, prompt }: GenerateJsonPrompt,
	schema: z.ZodType<T>,
	signal?: AbortSignal,
): Promise<T> {
	const { text } = await generateText({
		model,
		abortSignal: aiDeadline(signal),
		system: `${safetySystemPrompt}\n\n${system ?? ""}`,
		messages: [{ role: "user", content: prompt }],
	});

	const fenceStart = text.indexOf("```");
	const fenceEnd = fenceStart === -1 ? -1 : text.indexOf("```", fenceStart + 3);
	const candidate = fenceEnd === -1 ? text : text.slice(fenceStart + 3, fenceEnd);

	const start = candidate.indexOf("{");
	const end = candidate.lastIndexOf("}");
	if (start === -1 || end === -1 || end < start) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "The AI response couldn't be read. Try again, or choose another model.",
		});
	}

	return schema.parse(JSON.parse(candidate.slice(start, end + 1)));
}
