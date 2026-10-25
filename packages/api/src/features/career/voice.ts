import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createMistral } from "@ai-sdk/mistral";
import { createOpenAI } from "@ai-sdk/openai";
import { createXai } from "@ai-sdk/xai";
import { ORPCError } from "@orpc/client";
import { createGateway, generateSpeech, transcribe } from "ai";
import { and, eq, isNull, desc } from "drizzle-orm";
import { createSelectSchema } from "drizzle-zod";
import { match } from "ts-pattern";
import z from "zod";
import { AI_VOICE_MODELS } from "@reactive-resume/ai/types";
import { db } from "@reactive-resume/db/client";
import { careerTranscript } from "@reactive-resume/db/schema";
import { protectedProcedure } from "../../context";
import { aiVoiceRateLimit } from "../../middleware/rate-limit";
import { aiProvidersService } from "../ai-providers/service";
import { aiTransport, resolveAiBaseUrl } from "../ai/url-policy";
import { requireCareerApplication } from "./service";

const procedure = protectedProcedure.use(aiVoiceRateLimit);

/** The connection for one voice job, refused unless it offers that model (see `AI_VOICE_MODELS`). */
async function voiceConnection(userId: string, id: string, kind: "transcription" | "speech", model: string) {
	const provider = await aiProvidersService.getRunnableById({ userId, id });
	if (provider.id !== id || !AI_VOICE_MODELS[provider.provider]?.[kind].includes(model))
		throw new ORPCError("BAD_REQUEST", {
			message:
				kind === "transcription"
					? "Choose a connection that can transcribe speech."
					: "Choose a connection that can read text aloud.",
		});
	return {
		provider: provider.provider,
		settings: { apiKey: provider.apiKey, baseURL: resolveAiBaseUrl(provider), ...aiTransport() },
	};
}

type VoiceConnection = Awaited<ReturnType<typeof voiceConnection>>;

const transcriptionModel = ({ provider, settings }: VoiceConnection, model: string) =>
	match(provider)
		.with("openai", () => createOpenAI(settings).transcription(model))
		.with("gemini", () => createGoogleGenerativeAI(settings).transcription(model))
		.with("mistral", () => createMistral(settings).transcription(model))
		.with("xai", () => createXai(settings).transcription(model))
		.with("groq", () => createGroq(settings).transcription(model))
		.with("vercel-ai-gateway", () => createGateway(settings).transcription(model))
		.otherwise(() => null);

const speechModel = ({ provider, settings }: VoiceConnection, model: string) =>
	match(provider)
		.with("openai", () => createOpenAI(settings).speech(model))
		.with("gemini", () => createGoogleGenerativeAI(settings).speech(model))
		.with("mistral", () => createMistral(settings).speech(model))
		.with("xai", () => createXai(settings).speech())
		.with("vercel-ai-gateway", () => createGateway(settings).speech(model))
		.otherwise(() => null);

export const careerVoiceRouter = {
	transcripts: protectedProcedure
		.route({ method: "GET", path: "/career/voice/transcripts", tags: ["Career"], operationId: "listCareerTranscripts" })
		.input(z.object({ applicationId: z.string().nullable().default(null) }))
		.output(z.array(createSelectSchema(careerTranscript)))
		.handler(async ({ context, input }) => {
			await requireCareerApplication({ userId: context.user.id, applicationId: input.applicationId });
			return db
				.select()
				.from(careerTranscript)
				.where(
					and(
						eq(careerTranscript.userId, context.user.id),
						input.applicationId
							? eq(careerTranscript.applicationId, input.applicationId)
							: isNull(careerTranscript.applicationId),
					),
				)
				.orderBy(desc(careerTranscript.createdAt))
				.limit(100);
		}),
	transcribe: procedure
		.route({
			method: "POST",
			path: "/career/voice/transcribe",
			tags: ["Career"],
			operationId: "transcribeCareerAnswer",
		})
		.input(
			z.object({
				providerId: z.string().min(1),
				model: z.string().min(1).max(100),
				applicationId: z.string().nullable().default(null),
				audio: z
					.file()
					.max(2 * 1024 * 1024)
					.mime(["audio/webm", "audio/mp4", "audio/mpeg", "audio/mp3", "audio/wav", "audio/ogg"]),
			}),
		)
		.output(z.object({ id: z.string(), text: z.string() }))
		.handler(async ({ context, input }) => {
			await requireCareerApplication({ userId: context.user.id, applicationId: input.applicationId });
			const connection = await voiceConnection(context.user.id, input.providerId, "transcription", input.model);
			const model = transcriptionModel(connection, input.model);
			if (!model) throw new ORPCError("BAD_REQUEST", { message: "Choose a connection that can transcribe speech." });
			try {
				// Raw audio exists only for this request; no storage object or operational log contains it.
				const result = await transcribe({
					model,
					audio: new Uint8Array(await input.audio.arrayBuffer()),
					maxRetries: 0,
					abortSignal: AbortSignal.timeout(60_000),
					telemetry: { recordInputs: false, recordOutputs: false },
				});
				const text = result.text.slice(0, 40_000);
				const [row] = await db
					.insert(careerTranscript)
					.values({
						userId: context.user.id,
						applicationId: input.applicationId,
						original: text,
						edited: text,
						model: input.model,
					})
					.returning({ id: careerTranscript.id });
				if (!row) throw new Error("Transcript was not saved.");
				return { id: row.id, text };
			} catch {
				throw new ORPCError("BAD_GATEWAY", {
					message: "Couldn't transcribe the recording. It's still on this device, so try again or type your answer.",
				});
			}
		}),
	saveTranscript: procedure
		.route({
			method: "PUT",
			path: "/career/voice/transcripts/{id}",
			tags: ["Career"],
			operationId: "editCareerTranscript",
		})
		.input(z.object({ id: z.string(), text: z.string().trim().min(1).max(40_000) }))
		.output(z.void())
		.handler(async ({ context, input }) => {
			const [row] = await db
				.update(careerTranscript)
				.set({ edited: input.text })
				.where(and(eq(careerTranscript.id, input.id), eq(careerTranscript.userId, context.user.id)))
				.returning({ id: careerTranscript.id });
			if (!row) throw new ORPCError("NOT_FOUND");
		}),
	deleteTranscript: protectedProcedure
		.route({
			method: "DELETE",
			path: "/career/voice/transcripts/{id}",
			tags: ["Career"],
			operationId: "deleteCareerTranscript",
		})
		.input(z.object({ id: z.string() }))
		.output(z.void())
		.handler(async ({ context, input }) => {
			await db
				.delete(careerTranscript)
				.where(and(eq(careerTranscript.id, input.id), eq(careerTranscript.userId, context.user.id)));
		}),
	speak: procedure
		.route({ method: "POST", path: "/career/voice/speak", tags: ["Career"], operationId: "speakCareerQuestion" })
		.input(
			z.object({
				providerId: z.string().min(1),
				model: z.string().min(1).max(100),
				text: z.string().trim().min(1).max(2000),
			}),
		)
		.output(z.object({ audio: z.string(), mediaType: z.string() }))
		.handler(async ({ context, input }) => {
			const connection = await voiceConnection(context.user.id, input.providerId, "speech", input.model);
			const model = speechModel(connection, input.model);
			if (!model) throw new ORPCError("BAD_REQUEST", { message: "Choose a connection that can read text aloud." });
			try {
				const result = await generateSpeech({
					model,
					text: input.text,
					// OpenAI's speech models need a voice; the others have a default one.
					...(connection.provider === "openai" || input.model.startsWith("openai/") ? { voice: "alloy" } : {}),
					maxRetries: 0,
					abortSignal: AbortSignal.timeout(30_000),
					telemetry: { recordInputs: false, recordOutputs: false },
				});
				return { audio: result.audio.base64, mediaType: result.audio.mediaType };
			} catch {
				throw new ORPCError("BAD_GATEWAY", {
					message: "Spoken audio is unavailable. Continue with the text question.",
				});
			}
		}),
};
