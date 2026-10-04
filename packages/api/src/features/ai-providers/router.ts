import { ORPCError } from "@orpc/client";
import z from "zod";
import { protectedProcedure } from "../../context";
import { aiProviderResponseSchema } from "../../dto/ai-provider";
import { aiRequestRateLimit } from "../../middleware/rate-limit";
import { paginate, paginationShape } from "../../pagination";
import { orcaRouterConnectService } from "../ai/orcarouter/connect";
import {
	fetchOrcaRouterModels,
	OrcaRouterCatalogAuthError,
	ORCAROUTER_DEFAULT_ENTRY_POINT,
	ORCAROUTER_ENTRY_POINTS,
	ORCAROUTER_ENTRY_POINT_FILTERS,
} from "../ai/orcarouter/discovery";
import { resolveOrcaRouterOrigins } from "../ai/orcarouter/origins";
import { providerInput, updateProviderInput } from "./inputs";
import { aiProvidersService } from "./service";

function toCatalogModel(model: {
	id: string;
	name: string;
	contextLength: number | null;
	inputModalities: string[];
	reasoningEfforts: string[];
	verifiedFallback: boolean;
}) {
	return {
		id: model.id,
		name: model.name,
		contextLength: model.contextLength,
		inputModalities: model.inputModalities,
		reasoningEfforts: model.reasoningEfforts,
		verifiedFallback: model.verifiedFallback,
	};
}

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
		.output(z.array(aiProviderResponseSchema))
		.errors({
			PRECONDITION_FAILED: { message: "AI agent workspace is not configured.", status: 412 },
		})
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
		.output(aiProviderResponseSchema)
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
		.output(aiProviderResponseSchema)
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

	/**
	 * OrcaRouter's model list for one entry point. The API key never leaves the server: this procedure
	 * returns only the fields a selector needs, already filtered for the entry point it was asked about.
	 */
	orcaCatalog: protectedProcedure
		.route({
			method: "POST",
			path: "/ai-providers/{id}/orca-catalog",
			tags: ["AI Providers"],
			operationId: "listOrcaRouterModels",
			summary: "List OrcaRouter models for one entry point",
			description:
				"Reads the OrcaRouter model catalog server-side with the stored key and returns the models that entry point can actually use, filtered by capability and declared input modalities. Falls back to a small verified list, marked as such, when the catalog is unreachable.",
		})
		.input(
			z.object({
				id: z.string(),
				entryPoint: z.enum(ORCAROUTER_ENTRY_POINTS).default(ORCAROUTER_DEFAULT_ENTRY_POINT),
			}),
		)
		.output(
			z.object({
				source: z.enum(["live", "seed"]),
				degradedReason: z.string().nullable(),
				fetchedAt: z.string().nullable(),
				models: z.array(
					z.object({
						id: z.string(),
						name: z.string(),
						contextLength: z.number().nullable(),
						inputModalities: z.array(z.string()),
						reasoningEfforts: z.array(z.string()),
						verifiedFallback: z.boolean(),
					}),
				),
			}),
		)
		.errors({
			BAD_REQUEST: { message: "OrcaRouter is not configured as expected.", status: 400 },
			FORBIDDEN: { message: "AI is managed by the server.", status: 403 },
			NOT_FOUND: { message: "AI provider was not found.", status: 404 },
			PRECONDITION_FAILED: { message: "AI agent workspace is not configured.", status: 412 },
		})
		.handler(async ({ context, input }) => {
			// The catalog is readable while a fresh row still has no model to test, so this uses the
			// ownership-checked lookup rather than the runnable-provider gate.
			const provider = await aiProvidersService.getOwnedSecret({ id: input.id, userId: context.user.id });
			const filter = ORCAROUTER_ENTRY_POINT_FILTERS[input.entryPoint];
			const origins = resolveOrcaRouterOrigins();

			try {
				const result = await fetchOrcaRouterModels({ origins, apiKey: provider.apiKey, filter });
				return {
					source: result.source,
					degradedReason: result.degradedReason,
					fetchedAt: result.fetchedAt,
					models: result.models.map(toCatalogModel),
				};
			} catch (error) {
				if (error instanceof OrcaRouterCatalogAuthError) {
					// The relay rejected the stored key. This is terminal reauthentication, not a retry.
					await aiProvidersService.markNeedsReauth({
						id: input.id,
						userId: context.user.id,
						credentialGeneration: null,
						reason: error.message,
					});
					throw new ORPCError("FORBIDDEN", {
						message: "OrcaRouter rejected this provider's API key. Enter a new key or connect again.",
					});
				}
				throw error;
			}
		}),

	/**
	 * Starts an OrcaRouter PKCE authorization. The verifier stays on the server; the client only ever
	 * receives the consent URL to open and an id to complete the attempt with.
	 */
	orcaConnectBegin: protectedProcedure
		.route({
			method: "POST",
			path: "/ai-providers/orca/connect",
			tags: ["AI Providers"],
			operationId: "beginOrcaRouterConnect",
			summary: "Start an OrcaRouter connect flow",
			description:
				"Begins an OAuth 2.0 + PKCE (out-of-band) authorization against OrcaRouter and returns the consent URL to open. The PKCE verifier is generated server-side and never leaves the server.",
		})
		.input(
			z.object({
				providerId: z.string().optional(),
				label: z.string().trim().max(60).optional(),
				loginHint: z.string().trim().max(200).optional(),
				workspaceHint: z.string().trim().max(120).optional(),
				prompt: z.enum(["consent"]).optional(),
			}),
		)
		.output(z.object({ connectId: z.string(), authorizeUrl: z.string(), expiresInSeconds: z.number() }))
		.errors({
			BAD_REQUEST: { message: "OrcaRouter is not configured as expected.", status: 400 },
			NOT_FOUND: { message: "AI provider was not found.", status: 404 },
			PRECONDITION_FAILED: { message: "AI agent workspace is not configured.", status: 412 },
		})
		.handler(async ({ context, input }) => {
			try {
				return await orcaRouterConnectService.begin({
					userId: context.user.id,
					providerId: input.providerId ?? null,
					label: input.label ?? null,
					loginHint: input.loginHint ?? null,
					workspaceHint: input.workspaceHint ?? null,
					prompt: input.prompt ?? null,
				});
			} catch (error) {
				if (isInvalidAiBaseUrl(error)) throwInvalidProviderConfig();
				throw error;
			}
		}),

	orcaConnectComplete: protectedProcedure
		.route({
			method: "POST",
			path: "/ai-providers/orca/connect/{connectId}/complete",
			tags: ["AI Providers"],
			operationId: "completeOrcaRouterConnect",
			summary: "Finish an OrcaRouter connect flow",
			description:
				"Exchanges the code OrcaRouter displayed for a normal OrcaRouter API key and stores it encrypted. The PKCE verifier is only ever used on the server.",
		})
		.input(z.object({ connectId: z.string(), code: z.string().trim().min(1) }))
		.output(z.object({ id: z.string(), method: z.literal("pkce"), scope: z.string().nullable() }))
		.errors({
			BAD_REQUEST: { message: "That code could not be exchanged.", status: 400 },
			FORBIDDEN: { message: "AI is managed by the server.", status: 403 },
			PRECONDITION_FAILED: { message: "AI agent workspace is not configured.", status: 412 },
		})
		.handler(async ({ context, input }) => {
			try {
				const result = await orcaRouterConnectService.complete({
					userId: context.user.id,
					connectId: input.connectId,
					code: input.code,
				});
				return { id: result.providerId, method: result.method, scope: result.scope };
			} catch (error) {
				if (error instanceof ORPCError) throw error;
				if (isInvalidAiBaseUrl(error)) throwInvalidProviderConfig();
				throw new ORPCError("BAD_REQUEST", { message: "Could not finish connecting to OrcaRouter." });
			}
		}),

	orcaConnectCancel: protectedProcedure
		.route({
			method: "POST",
			path: "/ai-providers/orca/connect/{connectId}/cancel",
			tags: ["AI Providers"],
			operationId: "cancelOrcaRouterConnect",
			summary: "Cancel an OrcaRouter connect flow",
			description:
				"Releases a pending connect attempt. Safe to call for any reason — cancel, timeout, unmount, or page unload — and idempotent.",
		})
		.input(z.object({ connectId: z.string() }))
		.output(z.object({ status: z.literal("cancelled") }))
		.handler(({ context, input }) =>
			orcaRouterConnectService.cancel({ connectId: input.connectId, userId: context.user.id }),
		),
};
