import type { AiProviderResponse } from "./service";
import { ORPCError } from "@orpc/client";
import { type } from "@orpc/server";
import z from "zod";
import { protectedProcedure } from "../../context";
import { aiRequestRateLimit } from "../../middleware/rate-limit";
import { providerInput, updateProviderInput } from "./inputs";
import { aiProvidersService } from "./service";

function isInvalidAiBaseUrl(error: unknown) {
	return error instanceof Error && error.message === "INVALID_AI_BASE_URL";
}

function throwInvalidProviderConfig(): never {
	throw new ORPCError("BAD_REQUEST", { message: "Invalid AI provider configuration." });
}

export const aiProvidersRouter = {
	list: protectedProcedure
		.route({
			method: "GET",
			path: "/ai-providers",
			tags: ["AI Providers"],
			operationId: "listAiProviders",
			summary: "List saved AI providers",
			description: "Lists saved provider/model/API key combinations for the authenticated user. API keys are redacted.",
		})
		.output(type<AiProviderResponse[]>())
		.errors({
			PRECONDITION_FAILED: { message: "AI agent workspace is not configured.", status: 412 },
		})
		.handler(({ context }) => aiProvidersService.list({ userId: context.user.id })),

	create: protectedProcedure
		.route({
			method: "POST",
			path: "/ai-providers",
			tags: ["AI Providers"],
			operationId: "createAiProvider",
			summary: "Create saved AI provider",
			description: "Stores an encrypted provider/model/API key combination. The key is never returned.",
		})
		.input(providerInput)
		.output(type<AiProviderResponse>())
		.errors({
			BAD_REQUEST: { message: "Invalid AI provider configuration.", status: 400 },
			FORBIDDEN: { message: "AI is managed by the server.", status: 403 },
			PRECONDITION_FAILED: { message: "AI agent workspace is not configured.", status: 412 },
		})
		.handler(async ({ context, input }) => {
			try {
				return await aiProvidersService.create({
					userId: context.user.id,
					label: input.label,
					provider: input.provider,
					model: input.model,
					...(input.baseURL !== undefined ? { baseURL: input.baseURL } : {}),
					apiKey: input.apiKey,
				});
			} catch (error) {
				if (isInvalidAiBaseUrl(error)) throwInvalidProviderConfig();
				throw error;
			}
		}),

	update: protectedProcedure
		.route({
			method: "PATCH",
			path: "/ai-providers/{id}",
			tags: ["AI Providers"],
			operationId: "updateAiProvider",
			summary: "Update saved AI provider",
			description:
				"Updates a saved provider/model/API key combination. Updating the key requires retesting before use.",
		})
		.input(updateProviderInput)
		.output(type<AiProviderResponse>())
		.errors({
			BAD_REQUEST: { message: "Invalid AI provider configuration.", status: 400 },
			FORBIDDEN: { message: "AI is managed by the server.", status: 403 },
			NOT_FOUND: { message: "AI provider was not found.", status: 404 },
			PRECONDITION_FAILED: { message: "AI agent workspace is not configured.", status: 412 },
		})
		.handler(async ({ context, input }) => {
			try {
				return await aiProvidersService.update({
					id: input.id,
					userId: context.user.id,
					...(input.label !== undefined ? { label: input.label } : {}),
					...(input.provider !== undefined ? { provider: input.provider } : {}),
					...(input.model !== undefined ? { model: input.model } : {}),
					...(input.baseURL !== undefined ? { baseURL: input.baseURL } : {}),
					...(input.apiKey !== undefined ? { apiKey: input.apiKey } : {}),
					...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
				});
			} catch (error) {
				if (isInvalidAiBaseUrl(error)) throwInvalidProviderConfig();
				throw error;
			}
		}),

	delete: protectedProcedure
		.route({
			method: "DELETE",
			path: "/ai-providers/{id}",
			tags: ["AI Providers"],
			operationId: "deleteAiProvider",
			summary: "Delete saved AI provider",
			description: "Deletes a saved provider/model/API key combination.",
		})
		.input(z.object({ id: z.string() }))
		.output(z.void())
		.errors({
			FORBIDDEN: { message: "AI is managed by the server.", status: 403 },
			PRECONDITION_FAILED: { message: "AI agent workspace is not configured.", status: 412 },
		})
		.handler(({ context, input }) => aiProvidersService.delete({ id: input.id, userId: context.user.id })),

	test: protectedProcedure
		.route({
			method: "POST",
			path: "/ai-providers/{id}/test",
			tags: ["AI Providers"],
			operationId: "testAiProvider",
			summary: "Test saved AI provider",
			description: "Decrypts the saved API key server-side and validates the provider/model connection.",
		})
		.input(z.object({ id: z.string() }))
		.output(type<AiProviderResponse>())
		.use(aiRequestRateLimit)
		.errors({
			BAD_REQUEST: { message: "Invalid AI provider configuration.", status: 400 },
			FORBIDDEN: { message: "AI is managed by the server.", status: 403 },
			BAD_GATEWAY: { message: "The AI provider returned an error or is unreachable.", status: 502 },
			NOT_FOUND: { message: "AI provider was not found.", status: 404 },
			PRECONDITION_FAILED: { message: "AI agent workspace is not configured.", status: 412 },
		})
		.handler(async ({ context, input }) => {
			try {
				return await aiProvidersService.test({ id: input.id, userId: context.user.id });
			} catch (error) {
				if (isInvalidAiBaseUrl(error)) throwInvalidProviderConfig();
				if (error instanceof ORPCError) throw error;
				throw new ORPCError("BAD_GATEWAY", { message: "Could not reach the AI provider." });
			}
		}),
};
