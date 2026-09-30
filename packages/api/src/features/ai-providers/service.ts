import type { AIProvider } from "@reactive-resume/ai/types";
import { ORPCError } from "@orpc/client";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { aiProviderSchema } from "@reactive-resume/ai/types";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { env } from "@reactive-resume/env/server";
import { assertCredentialEncryptionConfigured, decryptCredential, encryptCredential } from "../ai/credentials";
import { testConnection } from "../ai/service";
import { resolveAiBaseUrl } from "../ai/url-policy";

type AiProviderRecord = typeof schema.aiProvider.$inferSelect;

export type AiProviderResponse = {
	managed: boolean;
	id: string;
	label: string;
	provider: AIProvider;
	model: string;
	baseURL: string | null;
	enabled: boolean;
	testStatus: string;
	testError: string | null;
	apiKeyPreview: string;
	apiKeyFingerprint: string;
	lastTestedAt: Date | null;
	lastUsedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
};

type CreateAiProviderInput = {
	userId: string;
	label: string;
	provider: AIProvider;
	model: string;
	baseURL?: string | null;
	apiKey: string;
};

type UpdateAiProviderInput = {
	id: string;
	userId: string;
	label?: string;
	provider?: AIProvider;
	model?: string;
	baseURL?: string | null;
	apiKey?: string;
	enabled?: boolean;
};

function toResponse(row: AiProviderRecord): AiProviderResponse {
	const provider = aiProviderSchema.parse(row.provider);

	return {
		managed: row.id === serverProviderId(row.userId),
		id: row.id,
		label: row.label,
		provider,
		model: row.model,
		baseURL: row.baseUrl,
		enabled: row.enabled,
		testStatus: row.testStatus,
		testError: row.testError,
		apiKeyPreview: row.apiKeyPreview,
		// The hash identifies the key without revealing it; the ciphertext and salt never leave the server.
		apiKeyFingerprint: row.apiKeyHash,
		lastTestedAt: row.lastTestedAt,
		lastUsedAt: row.lastUsedAt,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

function normalizeBaseUrl(input: { provider: AIProvider; baseURL?: string | null }) {
	const trimmed = input.baseURL?.trim() ?? "";
	if (!trimmed) return null;

	return resolveAiBaseUrl({ provider: input.provider, baseURL: trimmed });
}

async function getOwnedProvider(input: { id: string; userId: string }) {
	if (input.id === serverProviderId(input.userId)) throw new ORPCError("NOT_FOUND");
	const [provider] = await db
		.select()
		.from(schema.aiProvider)
		.where(and(eq(schema.aiProvider.id, input.id), eq(schema.aiProvider.userId, input.userId)))
		.limit(1);

	if (!provider) throw new ORPCError("NOT_FOUND");

	return provider;
}

const serverProviderId = (userId: string) => `server-ai:${userId}`;

function assertPersonalProvidersAllowed() {
	if (env.AI_PROVIDER) throw new ORPCError("FORBIDDEN", { message: "AI is managed by the server." });
}

/** A persisted reference keeps Assistant thread foreign keys valid; server credentials stay in the environment. */
async function serverProvider(userId: string) {
	if (!env.AI_PROVIDER || !env.AI_MODEL) return null;
	const values = {
		userId,
		label: "Server AI",
		provider: env.AI_PROVIDER,
		model: env.AI_MODEL,
		baseUrl: env.AI_BASE_URL ?? null,
		enabled: true,
		testStatus: "success",
		encryptedApiKey: "",
		apiKeySalt: "",
		apiKeyHash: "",
		apiKeyPreview: "",
	};
	const [row] = await db
		.insert(schema.aiProvider)
		.values({ id: serverProviderId(userId), ...values })
		.onConflictDoUpdate({ target: schema.aiProvider.id, set: values })
		.returning();
	if (!row) throw new Error("SERVER_AI_PROVIDER_UNAVAILABLE");
	return { ...toResponse(row), apiKey: env.AI_API_KEY ?? "", baseURL: env.AI_BASE_URL ?? "" };
}

export const aiProvidersService = {
	list: async (input: { userId: string }) => {
		const global = await serverProvider(input.userId);
		if (global) {
			const { apiKey: _apiKey, ...response } = global;
			return [response];
		}
		assertCredentialEncryptionConfigured();

		const providers = await db
			.select()
			.from(schema.aiProvider)
			.where(and(eq(schema.aiProvider.userId, input.userId), ne(schema.aiProvider.id, serverProviderId(input.userId))))
			.orderBy(
				desc(sql<Date>`coalesce(${schema.aiProvider.lastUsedAt}, '1970-01-01T00:00:00.000Z'::timestamptz)`),
				asc(schema.aiProvider.createdAt),
			);

		return providers.map(toResponse);
	},

	getRunnableById: async (input: { id: string; userId: string }) => {
		const global = await serverProvider(input.userId);
		if (global) return global;
		assertCredentialEncryptionConfigured();

		const provider = await getOwnedProvider(input);
		if (!provider.enabled || provider.testStatus !== "success") {
			throw new ORPCError("BAD_REQUEST", { message: "AI provider must be tested and enabled before use." });
		}

		return {
			...toResponse(provider),
			apiKey: decryptCredential(provider.encryptedApiKey),
			baseURL: provider.baseUrl ?? "",
		};
	},

	getDefaultRunnable: async (input: { userId: string }) => {
		const global = await serverProvider(input.userId);
		if (global) return global;
		assertCredentialEncryptionConfigured();

		const [provider] = await db
			.select()
			.from(schema.aiProvider)
			.where(
				and(
					eq(schema.aiProvider.userId, input.userId),
					eq(schema.aiProvider.enabled, true),
					eq(schema.aiProvider.testStatus, "success"),
					ne(schema.aiProvider.id, serverProviderId(input.userId)),
				),
			)
			.orderBy(
				desc(sql<Date>`coalesce(${schema.aiProvider.lastUsedAt}, '1970-01-01T00:00:00.000Z'::timestamptz)`),
				asc(schema.aiProvider.createdAt),
			)
			.limit(1);

		return provider
			? {
					...toResponse(provider),
					apiKey: decryptCredential(provider.encryptedApiKey),
					baseURL: provider.baseUrl ?? "",
				}
			: null;
	},

	create: async (input: CreateAiProviderInput) => {
		assertPersonalProvidersAllowed();
		assertCredentialEncryptionConfigured();

		const encrypted = encryptCredential(input.apiKey.trim());
		const [provider] = await db
			.insert(schema.aiProvider)
			.values({
				userId: input.userId,
				label: input.label.trim(),
				provider: input.provider,
				model: input.model.trim(),
				baseUrl: normalizeBaseUrl(input),
				...encrypted,
			})
			.returning();

		if (!provider) throw new Error("AI_PROVIDER_CREATE_FAILED");

		return toResponse(provider);
	},

	update: async (input: UpdateAiProviderInput) => {
		assertPersonalProvidersAllowed();
		assertCredentialEncryptionConfigured();

		const existing = await getOwnedProvider(input);
		const provider = input.provider ?? aiProviderSchema.parse(existing.provider);
		const nextApiKey = input.apiKey?.trim();
		const encrypted = nextApiKey ? encryptCredential(nextApiKey) : {};
		const credentialChanged = !!nextApiKey;
		const nextBaseUrl =
			input.baseURL !== undefined ? normalizeBaseUrl({ provider, baseURL: input.baseURL }) : existing.baseUrl;
		const providerChanged = input.provider !== undefined && input.provider !== existing.provider;
		const modelChanged = input.model !== undefined && input.model.trim() !== existing.model;
		const baseUrlChanged = input.baseURL !== undefined && nextBaseUrl !== existing.baseUrl;
		const runtimeChanged = credentialChanged || providerChanged || modelChanged || baseUrlChanged;

		if (input.enabled === true && existing.testStatus !== "success" && !runtimeChanged) {
			throw new ORPCError("BAD_REQUEST", { message: "AI provider must be tested successfully before enabling." });
		}

		const [updated] = await db
			.update(schema.aiProvider)
			.set({
				...(input.label !== undefined ? { label: input.label.trim() } : {}),
				...(input.provider !== undefined ? { provider: input.provider } : {}),
				...(input.model !== undefined ? { model: input.model.trim() } : {}),
				...(input.baseURL !== undefined ? { baseUrl: nextBaseUrl } : {}),
				...(input.enabled !== undefined && !runtimeChanged ? { enabled: input.enabled } : {}),
				...(runtimeChanged ? { enabled: false, testStatus: "untested", lastTestedAt: null, testError: null } : {}),
				...encrypted,
			})
			.where(and(eq(schema.aiProvider.id, input.id), eq(schema.aiProvider.userId, input.userId)))
			.returning();

		if (!updated) throw new ORPCError("NOT_FOUND");
		return toResponse(updated);
	},

	delete: async (input: { id: string; userId: string }) => {
		assertPersonalProvidersAllowed();
		assertCredentialEncryptionConfigured();

		await db
			.delete(schema.aiProvider)
			.where(and(eq(schema.aiProvider.id, input.id), eq(schema.aiProvider.userId, input.userId)));
	},

	test: async (input: { id: string; userId: string }) => {
		assertPersonalProvidersAllowed();
		assertCredentialEncryptionConfigured();

		const provider = await getOwnedProvider(input);
		const parsedProvider = aiProviderSchema.parse(provider.provider);
		const apiKey = decryptCredential(provider.encryptedApiKey);

		try {
			const result = await testConnection({
				provider: parsedProvider,
				model: provider.model,
				apiKey,
				baseURL: provider.baseUrl ?? "",
			});

			// A provider that answers "no" is a completed test, not a failed request: it comes back as
			// data so the client can show why, instead of a generic transport error.
			const [updated] = await db
				.update(schema.aiProvider)
				.set({
					enabled: result.ok,
					testStatus: result.ok ? "success" : "failure",
					testError: result.ok ? null : result.message,
					lastTestedAt: new Date(),
				})
				.where(and(eq(schema.aiProvider.id, input.id), eq(schema.aiProvider.userId, input.userId)))
				.returning();

			if (!updated) throw new ORPCError("NOT_FOUND");
			return toResponse(updated);
		} catch (error) {
			// Only unexpected failures reach here now: provider-side outcomes come back as data above.
			await db
				.update(schema.aiProvider)
				.set({
					enabled: false,
					testStatus: "failure",
					testError: error instanceof Error ? error.message : "Failed to test provider.",
					lastTestedAt: new Date(),
				})
				.where(and(eq(schema.aiProvider.id, input.id), eq(schema.aiProvider.userId, input.userId)));

			throw error;
		}
	},

	markUsed: async (input: { id: string; userId: string }) => {
		await db
			.update(schema.aiProvider)
			.set({ lastUsedAt: new Date() })
			.where(and(eq(schema.aiProvider.id, input.id), eq(schema.aiProvider.userId, input.userId)));
	},
};
