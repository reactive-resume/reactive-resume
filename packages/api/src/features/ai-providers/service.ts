import type { AIProvider, AiVoiceOperation } from "@reactive-resume/ai/types";
import type { DbOrTx } from "@reactive-resume/db/client";
import { createHmac } from "node:crypto";
import { ORPCError } from "@orpc/client";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { aiProviderSchema } from "@reactive-resume/ai/types";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { env } from "@reactive-resume/env/server";
import { assertCredentialEncryptionConfigured, decryptCredential, encryptCredential } from "../ai/credentials";
import { approvedAiProviderId, assertAiDestination } from "../ai/destination";
import { testConnection } from "../ai/service";
import { resolveAiBaseUrl } from "../ai/url-policy";
import { lockUser } from "../documents/ownership";

type AiProviderRecord = typeof schema.aiProvider.$inferSelect;

export type AiProviderResponse = {
	managed: boolean;
	id: string;
	label: string;
	provider: AIProvider;
	model: string;
	baseURL: string | null;
	enabled: boolean;
	isDefault: boolean;
	testStatus: string;
	testError: string | null;
	testErrorKind: string | null;
	apiKeyPreview: string;
	apiKeyFingerprint: string;
	recipientVersion: string;
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

/** Stable across tests and usage; credential replacement requires fresh recipient approval. */
function recipientVersion(row: AiProviderRecord, credentialRevision = row.encryptedApiKey) {
	return createHmac("sha256", env.AUTH_SECRET)
		.update(
			JSON.stringify(["ai-recipient-v1", row.userId, row.id, row.provider, row.model, row.baseUrl, credentialRevision]),
		)
		.digest("hex");
}

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
		isDefault: row.isDefault,
		testStatus: row.testStatus,
		testError: row.testError,
		testErrorKind: row.testErrorKind ?? null,
		apiKeyPreview: row.apiKeyPreview,
		// The hash identifies the key without revealing it; the ciphertext and salt never leave the server.
		apiKeyFingerprint: row.apiKeyHash,
		recipientVersion: recipientVersion(row),
		lastTestedAt: row.lastTestedAt,
		lastUsedAt: row.lastUsedAt,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

function normalizeBaseUrl(input: { provider: AIProvider; baseURL?: string | null }) {
	const trimmed = input.baseURL?.trim() ?? "";
	if (!trimmed) {
		if (input.provider === "openai-compatible")
			throw new ORPCError("BAD_REQUEST", { message: "Enter the base URL of your OpenAI-compatible service." });
		return null;
	}

	return resolveAiBaseUrl({ provider: input.provider, baseURL: trimmed });
}

async function getOwnedProvider(input: { id: string; userId: string }, reader: DbOrTx = db) {
	if (input.id === serverProviderId(input.userId)) throw new ORPCError("NOT_FOUND");
	const [provider] = await reader
		.select()
		.from(schema.aiProvider)
		.where(and(eq(schema.aiProvider.id, input.id), eq(schema.aiProvider.userId, input.userId)))
		.limit(1);

	if (!provider) throw new ORPCError("NOT_FOUND");

	return provider;
}

const serverProviderId = (userId: string) => `server-ai:${userId}`;

/** The caller holds the owner lock; revoke both future runs and work already claimed by a worker. */
async function pauseProviderSchedules(tx: DbOrTx, input: { id: string; userId: string }) {
	const schedules = await tx
		.update(schema.careerSchedule)
		.set({ enabled: false, aiProviderVersion: null })
		.where(and(eq(schema.careerSchedule.userId, input.userId), eq(schema.careerSchedule.aiProviderId, input.id)))
		.returning({ id: schema.careerSchedule.id });
	if (schedules.length)
		await tx
			.update(schema.careerJob)
			.set({ status: "canceled", lease: null, leaseUntil: null })
			.where(
				and(
					eq(schema.careerJob.userId, input.userId),
					inArray(
						schema.careerJob.scheduleId,
						schedules.map((schedule) => schedule.id),
					),
					sql`${schema.careerJob.status} in ('queued', 'running')`,
				),
			);
}

/**
 * How a connection is picked when nobody chose one: the default, then the oldest. Lists
 * use the same order, so the first usable connection on screen is the one the server uses.
 */
const automaticOrder = [desc(schema.aiProvider.isDefault), asc(schema.aiProvider.createdAt), asc(schema.aiProvider.id)];

function assertPersonalProvidersAllowed() {
	if (env.AI_PROVIDER)
		throw new ORPCError("FORBIDDEN", {
			message: "AI is set up by the server administrator and can't be changed here.",
		});
}

/** A persisted reference keeps Assistant thread foreign keys valid; server credentials stay in the environment. */
async function serverProvider(userId: string, reader: DbOrTx = db) {
	if (!env.AI_PROVIDER || !env.AI_MODEL) return null;
	const apiKey = env.AI_API_KEY ?? "";
	const values = {
		userId,
		label: "Server AI",
		provider: env.AI_PROVIDER,
		model: env.AI_MODEL,
		baseUrl: env.AI_BASE_URL ?? null,
		enabled: true,
		isDefault: true,
		testStatus: "success",
		encryptedApiKey: "",
		apiKeySalt: "",
		apiKeyHash: "",
		apiKeyPreview: "",
	};
	const [row] = await reader
		.insert(schema.aiProvider)
		.values({ id: serverProviderId(userId), ...values })
		.onConflictDoUpdate({ target: schema.aiProvider.id, set: values })
		.returning();
	if (!row) throw new Error("SERVER_AI_PROVIDER_UNAVAILABLE");
	// Environment settings and key are captured together before the database await.
	return {
		...toResponse(row),
		recipientVersion: recipientVersion(row, apiKey),
		apiKey,
		baseURL: values.baseUrl ?? "",
	};
}

export const aiProvidersService = {
	/** Final short authorization: domain checks first, captured recipient availability last; no locks during HTTP. */
	authorize: async (input: { userId: string; id: string }, check?: (reader: DbOrTx) => Promise<void>) => {
		await db.transaction(async (tx) => {
			await lockUser(tx, input.userId);
			await check?.(tx);
			await aiProvidersService.assertAvailable(input, tx);
		});
	},
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
			.orderBy(...automaticOrder);

		return providers.map(toResponse);
	},

	/** Checks availability of an already captured recipient without resolving new settings or credentials. */
	assertAvailable: async (input: { id: string; userId: string }, reader: DbOrTx) => {
		if (input.id === serverProviderId(input.userId)) {
			if (!env.AI_PROVIDER || !env.AI_MODEL)
				throw new ORPCError("BAD_REQUEST", { message: "AI is no longer configured on this server." });
			return;
		}
		const [provider] = await reader
			.select({ enabled: schema.aiProvider.enabled, testStatus: schema.aiProvider.testStatus })
			.from(schema.aiProvider)
			.where(and(eq(schema.aiProvider.id, input.id), eq(schema.aiProvider.userId, input.userId)))
			.for("share");
		if (!provider) throw new ORPCError("NOT_FOUND");
		if (!provider.enabled || provider.testStatus !== "success")
			throw new ORPCError("BAD_REQUEST", { message: "Test and turn on this AI provider before using it." });
	},

	getRunnableById: async (input: { id: string; userId: string; voice?: AiVoiceOperation }, reader: DbOrTx = db) => {
		approvedAiProviderId();
		const global = await serverProvider(input.userId, reader);
		if (global) {
			assertAiDestination(global, input.voice);
			return global;
		}
		assertCredentialEncryptionConfigured();

		const provider = await getOwnedProvider(input, reader);
		if (!provider.enabled || provider.testStatus !== "success") {
			throw new ORPCError("BAD_REQUEST", { message: "Test and turn on this AI provider before using it." });
		}

		assertAiDestination(toResponse(provider), input.voice);
		return {
			...toResponse(provider),
			apiKey: decryptCredential(provider.encryptedApiKey),
			baseURL: provider.baseUrl ?? "",
		};
	},

	getDefaultRunnable: async (input: { userId: string }) => {
		const approved = approvedAiProviderId();
		if (approved) return aiProvidersService.getRunnableById({ ...input, id: approved });
		const global = await serverProvider(input.userId);
		if (global) {
			assertAiDestination(global);
			return global;
		}
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
			.orderBy(...automaticOrder)
			.limit(1);

		if (provider) assertAiDestination(toResponse(provider));
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
		const providerChanged = input.provider !== undefined && input.provider !== existing.provider;
		const nextBaseUrl =
			input.baseURL !== undefined || providerChanged
				? normalizeBaseUrl({ provider, baseURL: input.baseURL !== undefined ? input.baseURL : existing.baseUrl })
				: existing.baseUrl;
		const modelChanged = input.model !== undefined && input.model.trim() !== existing.model;
		const baseUrlChanged = input.baseURL !== undefined && nextBaseUrl !== existing.baseUrl;
		const hostChanged = providerChanged || baseUrlChanged;

		// The saved key only goes where it was saved for: a new provider or address needs the key sent with it.
		if (hostChanged && nextApiKey === undefined) {
			throw new ORPCError("BAD_REQUEST", {
				message: "Enter the API key again to change the provider or base URL.",
			});
		}

		// On a new host the key is replaced even when empty (Ollama runs without one).
		const encrypted = nextApiKey || hostChanged ? encryptCredential(nextApiKey ?? "") : {};
		const credentialChanged = !!nextApiKey;
		const runtimeChanged = credentialChanged || providerChanged || modelChanged || baseUrlChanged;

		if (input.enabled === true && existing.testStatus !== "success" && !runtimeChanged) {
			throw new ORPCError("BAD_REQUEST", { message: "Test this AI provider before turning it on." });
		}

		const [updated] = await db.transaction(async (tx) => {
			await tx.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.id, input.userId)).for("update");
			const updated = await tx
				.update(schema.aiProvider)
				.set({
					...(input.label !== undefined ? { label: input.label.trim() } : {}),
					...(input.provider !== undefined ? { provider: input.provider } : {}),
					...(input.model !== undefined ? { model: input.model.trim() } : {}),
					...(input.baseURL !== undefined || providerChanged ? { baseUrl: nextBaseUrl } : {}),
					...(input.enabled !== undefined ? { userDisabled: !input.enabled } : {}),
					...(input.enabled !== undefined && !runtimeChanged ? { enabled: input.enabled } : {}),
					...(runtimeChanged
						? { enabled: false, testStatus: "untested", lastTestedAt: null, testError: null, testErrorKind: null }
						: {}),
					...encrypted,
				})
				.where(
					and(
						eq(schema.aiProvider.id, input.id),
						eq(schema.aiProvider.userId, input.userId),
						eq(schema.aiProvider.provider, existing.provider),
						eq(schema.aiProvider.model, existing.model),
						existing.baseUrl === null
							? isNull(schema.aiProvider.baseUrl)
							: eq(schema.aiProvider.baseUrl, existing.baseUrl),
						eq(schema.aiProvider.encryptedApiKey, existing.encryptedApiKey),
						eq(schema.aiProvider.testStatus, existing.testStatus),
						eq(schema.aiProvider.enabled, existing.enabled),
					),
				)
				.returning();
			if ((runtimeChanged || input.enabled === false) && updated.length) await pauseProviderSchedules(tx, input);
			return updated;
		});

		if (!updated) throw new ORPCError("CONFLICT", { message: "The provider changed. Reload it before saving again." });
		return toResponse(updated);
	},

	delete: async (input: { id: string; userId: string }) => {
		assertPersonalProvidersAllowed();
		assertCredentialEncryptionConfigured();

		await db.transaction(async (tx) => {
			await tx.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.id, input.userId)).for("update");
			await pauseProviderSchedules(tx, input);
			await tx
				.delete(schema.aiProvider)
				.where(and(eq(schema.aiProvider.id, input.id), eq(schema.aiProvider.userId, input.userId)));
			await tx.execute(sql`update ${schema.aiProvider} set is_default = true where id = (
    select id from ${schema.aiProvider} where user_id = ${input.userId} and enabled and test_status = 'success'
    and not exists (select 1 from ${schema.aiProvider} where user_id = ${input.userId} and is_default)
    order by created_at, id limit 1
   )`);
		});
	},

	test: async (input: { id: string; userId: string; signal?: AbortSignal | undefined }) => {
		assertPersonalProvidersAllowed();
		assertCredentialEncryptionConfigured();

		const provider = await getOwnedProvider(input);
		assertAiDestination(toResponse(provider));
		const parsedProvider = aiProviderSchema.parse(provider.provider);
		const apiKey = decryptCredential(provider.encryptedApiKey);
		// A result applies only to the settings it tested: an edit made while the request ran resets the connection
		// to untested, and a late result must not mark the new settings as working.
		const tested = and(
			eq(schema.aiProvider.id, input.id),
			eq(schema.aiProvider.userId, input.userId),
			eq(schema.aiProvider.provider, provider.provider),
			eq(schema.aiProvider.model, provider.model),
			provider.baseUrl === null ? isNull(schema.aiProvider.baseUrl) : eq(schema.aiProvider.baseUrl, provider.baseUrl),
			eq(schema.aiProvider.encryptedApiKey, provider.encryptedApiKey),
			eq(schema.aiProvider.userDisabled, provider.userDisabled),
		);
		const changed = () =>
			new ORPCError("CONFLICT", { message: "The provider changed during the test. Test it again." });

		await db.transaction(async (tx) => {
			await lockUser(tx, input.userId);
			const current = await getOwnedProvider(input, tx);
			if (toResponse(current).recipientVersion !== toResponse(provider).recipientVersion) throw changed();
		});
		input.signal?.throwIfAborted();
		try {
			const result = await testConnection({
				provider: parsedProvider,
				signal: input.signal,
				model: provider.model,
				apiKey,
				baseURL: provider.baseUrl ?? "",
			});

			// A provider that answers "no" is a completed test, not a failed request: it comes back as
			// data so the client can show why, instead of a generic transport error.
			const [updated] = await db
				.update(schema.aiProvider)
				.set({
					enabled: result.ok && !provider.userDisabled,
					testStatus: result.ok ? "success" : "failure",
					testError: result.ok ? null : result.message,
					testErrorKind: result.ok ? null : result.kind,
					lastTestedAt: new Date(),
				})
				.where(tested)
				.returning();

			if (!updated) throw changed();
			if (updated.enabled && result.ok) {
				// Serialize the first successful default with explicit changes, across all server processes.
				await db.transaction(async (tx) => {
					await tx
						.select({ id: schema.user.id })
						.from(schema.user)
						.where(eq(schema.user.id, input.userId))
						.for("update");
					await tx.execute(sql`update ${schema.aiProvider} set is_default = true
						where id = ${input.id} and user_id = ${input.userId} and enabled and test_status = 'success'
						and not exists (select 1 from ${schema.aiProvider} where user_id = ${input.userId} and is_default)`);
				});
			}
			return toResponse(await getOwnedProvider(input));
		} catch (error) {
			if (error instanceof ORPCError && error.code === "CONFLICT") throw error;
			// Only unexpected failures reach here now: provider-side outcomes come back as data above.
			await db
				.update(schema.aiProvider)
				.set({
					enabled: false,
					testStatus: "failure",
					testError:
						error instanceof Error && error.message === "INVALID_AI_BASE_URL"
							? "Check the provider base URL."
							: "Failed to test provider.",
					testErrorKind: error instanceof Error && error.message === "INVALID_AI_BASE_URL" ? "url" : "unknown",
					lastTestedAt: new Date(),
				})
				.where(tested);

			throw error;
		}
	},

	/** Makes one tested, switched-on connection the default; the previous default stops being one. */
	setDefault: async (input: { id: string; userId: string }) => {
		assertPersonalProvidersAllowed();
		const provider = await getOwnedProvider(input);
		if (!provider.enabled || provider.testStatus !== "success")
			throw new ORPCError("BAD_REQUEST", {
				message: "Test and turn on this provider before making it the default.",
			});
		const [updated] = await db.transaction(async (tx) => {
			await tx.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.id, input.userId)).for("update");
			const [current] = await tx
				.select()
				.from(schema.aiProvider)
				.where(and(eq(schema.aiProvider.id, input.id), eq(schema.aiProvider.userId, input.userId)));
			if (!current?.enabled || current.testStatus !== "success")
				throw new ORPCError("CONFLICT", {
					message: "The provider changed. Test and turn it on before choosing the default.",
				});
			await tx
				.update(schema.aiProvider)
				.set({ isDefault: false })
				.where(and(eq(schema.aiProvider.userId, input.userId), eq(schema.aiProvider.isDefault, true)));
			return tx
				.update(schema.aiProvider)
				.set({ isDefault: true })
				.where(and(eq(schema.aiProvider.id, input.id), eq(schema.aiProvider.userId, input.userId)))
				.returning();
		});
		if (!updated) throw new ORPCError("NOT_FOUND");
		return toResponse(updated);
	},

	markUsed: async (input: { id: string; userId: string }) => {
		await db
			.update(schema.aiProvider)
			.set({ lastUsedAt: new Date() })
			.where(and(eq(schema.aiProvider.id, input.id), eq(schema.aiProvider.userId, input.userId)));
	},
};
