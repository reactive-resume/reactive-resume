import { ORPCError } from "@orpc/client";
import { AISDKError } from "ai";
import { flattenError, ZodError, z } from "zod";
import { resumeDataSchema } from "@reactive-resume/schema/resume/data";
import { protectedProcedure } from "../../context";
import { aiRequestRateLimit } from "../../middleware/rate-limit";
import { aiProvidersService } from "../ai-providers/service";
import { assertDocumentVersion } from "../documents/ownership";
import { atsReviewInputSchema, atsReviewOutputSchema, reviewResumeText } from "./ats-review";
import { improveInputSchema, improveLine, improveOutputSchema } from "./improve";
import { reportAiContent } from "./reports";
import { aiService, fileInputSchema } from "./service";
import { beginWritingReview, readWritingReview, saveWritingReview } from "./writing-review";

/**
 * Every AI procedure fails the same ways: no ENCRYPTION_SECRET, a bad base URL, the provider erroring (its cause kept
 * for upstream error reporters), or the model returning a shape that can't be used, named per procedure.
 */
function rethrowAiError(error: unknown, invalidStructure: string): never {
	if (error instanceof Error && error.message === "AI_CREDENTIAL_ENCRYPTION_UNAVAILABLE")
		throw new ORPCError("PRECONDITION_FAILED", {
			message: "AI providers aren't available on this server. Ask the server administrator to set ENCRYPTION_SECRET.",
		});
	if (error instanceof Error && error.message === "INVALID_AI_BASE_URL")
		throw new ORPCError("BAD_REQUEST", {
			message: "That provider setup isn't valid. Check the base URL and try again.",
		});
	if (error instanceof AISDKError)
		throw new ORPCError("BAD_GATEWAY", {
			message: "Couldn't reach the AI provider. Check its settings and try again.",
			cause: error,
		});
	if (error instanceof ZodError)
		throw new ORPCError("BAD_REQUEST", { message: invalidStructure, cause: flattenError(error) });
	throw error;
}

const aiErrors = {
	BAD_GATEWAY: {
		message: "The AI provider returned an error or couldn't be reached. Try again, or check its settings.",
		status: 502,
	},
	BAD_REQUEST: {
		message: "The AI response wasn't in the expected format. Try again, or choose another model.",
		status: 400,
	},
} as const;

async function getRunnableProvider(userId: string, aiProviderId?: string) {
	const provider = aiProviderId
		? await aiProvidersService.getRunnableById({ id: aiProviderId, userId })
		: await aiProvidersService.getDefaultRunnable({ userId });

	if (!provider)
		throw new ORPCError("BAD_REQUEST", {
			message: "Test and turn on an AI provider in Settings → AI & developer first.",
		});

	return provider;
}

export const aiRouter = {
	reportContent: reportAiContent,
	capabilities: protectedProcedure
		.route({ method: "GET", path: "/ai/capabilities", tags: ["AI"], operationId: "getAiCapabilities" })
		.input(z.object({}).default({}))
		.output(z.object({ recipientApproval: z.literal(1), explicitNoAi: z.literal(true) }))
		.handler(() => ({ recipientApproval: 1 as const, explicitNoAi: true as const })),
	writingReview: protectedProcedure
		.route({
			method: "GET",
			path: "/ai/writing-review/{resumeId}",
			tags: ["AI"],
			operationId: "getWritingReview",
			summary: "Get the saved writing review for a resume",
		})
		.input(z.object({ resumeId: z.string() }))
		.output(
			z
				.object({
					inputText: z.string(),
					passages: z.array(z.object({ id: z.string(), where: z.string(), text: z.string() })),
					review: atsReviewOutputSchema,
					reviewedAt: z.date(),
				})
				.nullable(),
		)
		.handler(({ context, input }) => readWritingReview(context.user.id, input.resumeId)),
	parsePdf: protectedProcedure
		.route({
			method: "POST",
			path: "/ai/parse-pdf",
			tags: ["AI"],
			operationId: "parseResumePdf",
			summary: "Parse a PDF file into resume data",
			description:
				"Extracts structured resume data from a PDF file with one of the user's saved AI providers: the one named by `aiProviderId`, or their default. Send the file as a base64-encoded string. Returns a complete ResumeData object and saves nothing.",
			successDescription: "The PDF was successfully parsed into structured resume data.",
		})
		.input(z.object({ aiProviderId: z.string().optional(), file: fileInputSchema }))
		.use(aiRequestRateLimit)
		.errors(aiErrors)
		.output(resumeDataSchema)
		.handler(async ({ context, input, signal }) => {
			try {
				const provider = await getRunnableProvider(context.user.id, input.aiProviderId);
				await aiProvidersService.authorize({ userId: context.user.id, id: provider.id });
				signal?.throwIfAborted();
				return await aiService.parsePdf({
					provider: provider.provider,
					model: provider.model,
					apiKey: provider.apiKey,
					baseURL: provider.baseURL ?? "",
					file: input.file,
					signal,
				});
			} catch (error) {
				rethrowAiError(error, "The AI returned resume data in the wrong format. Try again, or choose another model.");
			}
		}),

	parseDocx: protectedProcedure
		.route({
			method: "POST",
			path: "/ai/parse-docx",
			tags: ["AI"],
			operationId: "parseResumeDocx",
			summary: "Parse a DOCX file into resume data",
			description:
				"Extracts structured resume data from a DOCX or DOC file with one of the user's saved AI providers: the one named by `aiProviderId`, or their default. Send the file as a base64-encoded string with the document's media type. Returns a complete ResumeData object and saves nothing.",
			successDescription: "The DOCX was successfully parsed into structured resume data.",
		})
		.input(
			z.object({
				aiProviderId: z.string().optional(),
				file: fileInputSchema,
				mediaType: z.enum([
					"application/msword",
					"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
				]),
			}),
		)
		.use(aiRequestRateLimit)
		.errors(aiErrors)
		.output(resumeDataSchema)
		.handler(async ({ context, input, signal }) => {
			try {
				const provider = await getRunnableProvider(context.user.id, input.aiProviderId);
				await aiProvidersService.authorize({ userId: context.user.id, id: provider.id });
				signal?.throwIfAborted();
				return await aiService.parseDocx({
					provider: provider.provider,
					model: provider.model,
					apiKey: provider.apiKey,
					baseURL: provider.baseURL ?? "",
					mediaType: input.mediaType,
					file: input.file,
					signal,
				});
			} catch (error) {
				rethrowAiError(error, "The AI returned resume data in the wrong format. Try again, or choose another model.");
			}
		}),

	atsReview: protectedProcedure
		.route({
			method: "POST",
			path: "/ai/ats-review",
			tags: ["AI"],
			operationId: "atsReview",
			summary: "Review extracted resume text",
			description:
				"Reviews the plain text extracted from a resume PDF and returns qualitative feedback: a summary, rewrite suggestions, strengths, and — when a job description is supplied — how the candidate's experience lines up with the role. Deliberately returns no score: the deterministic ATS report owns the only number in this feature. Requires authentication and AI credentials.",
			successDescription: "Qualitative review returned successfully.",
		})
		.input(atsReviewInputSchema)
		.use(aiRequestRateLimit)
		.output(atsReviewOutputSchema)
		.errors(aiErrors)
		.handler(async ({ context, input, signal }) => {
			try {
				const requestedAt = new Date();
				const resume = input.resumeId ? await beginWritingReview(context.user.id, input.resumeId) : null;
				const provider = await getRunnableProvider(context.user.id, input.aiProviderId);
				await aiProvidersService.authorize({ userId: context.user.id, id: provider.id }, async (tx) => {
					if (resume) await assertDocumentVersion(tx, context.user.id, { kind: "resume", ...resume });
				});
				signal?.throwIfAborted();

				const review = await reviewResumeText({
					...input,
					signal,
					provider: provider.provider,
					model: provider.model,
					apiKey: provider.apiKey,
					baseURL: provider.baseURL ?? "",
				});
				if (input.resumeId && resume)
					await saveWritingReview({
						requestGeneration: resume.generation,
						resumeId: input.resumeId,
						userId: context.user.id,
						inputText: input.extractedText,
						passages: input.passages,
						review,
						requestedAt,
						reviewedAt: new Date(),
					});
				return review;
			} catch (error) {
				rethrowAiError(error, "The AI returned the review in the wrong format. Try again, or choose another model.");
			}
		}),

	improve: protectedProcedure
		.route({
			method: "POST",
			path: "/ai/improve",
			tags: ["AI"],
			operationId: "improveLine",
			summary: "Suggest a rewrite of one line",
			description:
				"Suggests a rewrite of one line of a resume or cover letter: a stronger verb, an added result, a shorter version, or the user's own request. Returns the new line, a short reason, and whether it states anything the input didn't, so the user can check it. Writes nothing. Requires authentication and AI credentials.",
			successDescription: "The suggested line.",
		})
		.input(improveInputSchema)
		.use(aiRequestRateLimit)
		.output(improveOutputSchema)
		.errors(aiErrors)
		.handler(async ({ context, input, signal }) => {
			try {
				const provider = await getRunnableProvider(context.user.id, input.aiProviderId);
				await aiProvidersService.authorize({ userId: context.user.id, id: provider.id });
				signal?.throwIfAborted();

				return await improveLine({
					...input,
					signal,
					provider: provider.provider,
					model: provider.model,
					apiKey: provider.apiKey,
					baseURL: provider.baseURL ?? "",
				});
			} catch (error) {
				rethrowAiError(error, "The AI returned suggestions in the wrong format. Try again, or choose another model.");
			}
		}),
};
