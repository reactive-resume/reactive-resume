import { ORPCError } from "@orpc/client";
import z from "zod";
import { protectedProcedure } from "../../context";
import { aiProviderResponseSchema } from "../../dto/ai-provider";
import { aiRequestRateLimit } from "../../middleware/rate-limit";
import { paginate, paginationShape } from "../../pagination";
import { providerInput, updateProviderInput } from "./inputs";
import { aiProvidersService } from "./service";

function isInvalidAiBaseUrl(error: unknown) {
	return error instanceof Error && error.message === "INVALID_AI_BASE_URL";
}

// Each procedure lists the ones it can fail with.
const providerErrors = {
	BAD_REQUEST: { message: "That provider setup isn't valid. Check the base URL and try again.", status: 400 },
	BAD_GATEWAY: {
		message: "The AI provider returned an error or couldn't be reached. Try again, or check its settings.",
		status: 502,
	},
	FORBIDDEN: { message: "AI is set up by the server administrator and can't be changed here.", status: 403 },
	NOT_FOUND: { message: "This AI provider no longer exists. Reload and choose another provider.", status: 404 },
	PRECONDITION_FAILED: {
		message: "AI providers aren't available on this server. Ask the server administrator to set ENCRYPTION_SECRET.",
		status: 412,
	},
};
const { BAD_REQUEST, BAD_GATEWAY, FORBIDDEN, NOT_FOUND, PRECONDITION_FAILED } = providerErrors;

function throwInvalidProviderConfig(): never {
	throw new ORPCError("BAD_REQUEST", { message: BAD_REQUEST.message });
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
		.output(z.array(aiProviderResponseSchema))
		.errors({ PRECONDITION_FAILED })
		.input(z.object(paginationShape).default({}))
		.handler(async ({ context, input }) =>
			paginate(await aiProvidersService.list({ userId: context.user.id }), input, context.resHeaders),
		),

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
		.output(aiProviderResponseSchema)
		.errors({ BAD_REQUEST, FORBIDDEN, PRECONDITION_FAILED })
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
		.output(aiProviderResponseSchema)
		.errors({ BAD_REQUEST, FORBIDDEN, NOT_FOUND, PRECONDITION_FAILED })
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
		.errors({ FORBIDDEN, PRECONDITION_FAILED })
		.handler(({ context, input }) => aiProvidersService.delete({ id: input.id, userId: context.user.id })),

	setDefault: protectedProcedure
		.route({
			method: "POST",
			path: "/ai-providers/{id}/default",
			tags: ["AI Providers"],
			operationId: "setDefaultAiProvider",
			summary: "Make an AI provider the default",
			description:
				"Makes a tested, enabled provider the one used whenever no provider is chosen. The previous default stops being one.",
		})
		.input(z.object({ id: z.string() }))
		.output(aiProviderResponseSchema)
		.errors({
			BAD_REQUEST: { message: "Test and turn on this provider before making it the default.", status: 400 },
			FORBIDDEN,
			NOT_FOUND,
			PRECONDITION_FAILED,
		})
		.handler(({ context, input }) => aiProvidersService.setDefault({ id: input.id, userId: context.user.id })),

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
		.output(aiProviderResponseSchema)
		.use(aiRequestRateLimit)
		.errors({ BAD_REQUEST, FORBIDDEN, BAD_GATEWAY, NOT_FOUND, PRECONDITION_FAILED })
		.handler(async ({ context, input, signal }) => {
			try {
				return await aiProvidersService.test({ id: input.id, userId: context.user.id, signal });
			} catch (error) {
				if (isInvalidAiBaseUrl(error)) throwInvalidProviderConfig();
				if (error instanceof ORPCError) throw error;
				throw new ORPCError("BAD_GATEWAY", {
					message: "Couldn't reach the AI provider. Check its settings and try again.",
				});
			}
		}),
};
