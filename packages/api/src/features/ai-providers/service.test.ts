import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { dbMock, queryMock, queryState } = vi.hoisted(() => {
	const state = {
		rows: [] as unknown[],
		whereArg: undefined as unknown,
		orderByArgs: [] as unknown[],
		updateRows: undefined as unknown[] | undefined,
		updateWhere: undefined as unknown,
	};
	const query = {
		from: vi.fn(() => query),
		where: vi.fn((arg: unknown) => {
			state.whereArg = arg;
			return query;
		}),
		orderBy: vi.fn((...args: unknown[]) => {
			state.orderByArgs = args;
			return query;
		}),
		limit: vi.fn(async () => state.rows),
	};
	const update = {
		set: vi.fn(() => update),
		where: vi.fn((arg: unknown) => {
			state.updateWhere = arg;
			return update;
		}),
		returning: vi.fn(async () => state.updateRows ?? state.rows),
	};

	return {
		dbMock: { select: vi.fn(() => query), update: vi.fn(() => update) },
		queryMock: query,
		queryState: state,
	};
});

vi.mock("@reactive-resume/db/client", () => ({ db: dbMock }));
vi.mock("@reactive-resume/db/schema", () => ({
	aiProvider: {
		id: "ai_provider.id",
		userId: "ai_provider.user_id",
		label: "ai_provider.label",
		provider: "ai_provider.provider",
		model: "ai_provider.model",
		baseUrl: "ai_provider.base_url",
		encryptedApiKey: "ai_provider.encrypted_api_key",
		apiKeySalt: "ai_provider.api_key_salt",
		apiKeyHash: "ai_provider.api_key_hash",
		apiKeyPreview: "ai_provider.api_key_preview",
		testStatus: "ai_provider.test_status",
		testError: "ai_provider.test_error",
		lastTestedAt: "ai_provider.last_tested_at",
		lastUsedAt: "ai_provider.last_used_at",
		enabled: "ai_provider.enabled",
		isDefault: "ai_provider.is_default",
		createdAt: "ai_provider.created_at",
		updatedAt: "ai_provider.updated_at",
	},
}));
vi.mock("drizzle-orm", () => ({
	and: (...conditions: unknown[]) => ({ type: "and", conditions }),
	asc: (value: unknown) => ({ type: "asc", value }),
	desc: (value: unknown) => ({ type: "desc", value }),
	eq: (left: unknown, right: unknown) => ({ type: "eq", left, right }),
	isNull: (value: unknown) => ({ type: "isNull", value }),
	ne: (left: unknown, right: unknown) => ({ type: "ne", left, right }),
	sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ type: "sql", strings: [...strings], values }),
}));
vi.mock("@reactive-resume/env/server", () => ({ env: { AUTH_SECRET: "synthetic-test-auth-secret" } }));
vi.mock("../ai/credentials", () => ({
	assertCredentialEncryptionConfigured: vi.fn(),
	decryptCredential: vi.fn(() => "decrypted-key"),
	encryptCredential: vi.fn(),
}));
vi.mock("../ai/service", () => ({ testConnection: vi.fn() }));
vi.mock("../ai/url-policy", () => ({ resolveAiBaseUrl: vi.fn() }));

const { aiProvidersService } = await import("./service");
const { resolveAiBaseUrl } = await import("../ai/url-policy");

function providerRow(overrides: Record<string, unknown> = {}) {
	return {
		id: "provider-1",
		userId: "user-1",
		label: "OpenAI",
		provider: "openai",
		model: "gpt-5-mini",
		baseUrl: null,
		encryptedApiKey: "encrypted-key",
		apiKeySalt: "salt",
		apiKeyHash: "hash",
		apiKeyPreview: "preview",
		testStatus: "success",
		testError: null,
		lastTestedAt: new Date("2026-07-01T00:00:00Z"),
		lastUsedAt: new Date("2026-07-07T00:00:00Z"),
		enabled: true,
		isDefault: false,
		createdAt: new Date("2026-07-01T00:00:00Z"),
		updatedAt: new Date("2026-07-01T00:00:00Z"),
		...overrides,
	};
}

describe("aiProvidersService", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		queryState.rows = [];
		queryState.whereArg = undefined;
		queryState.orderByArgs = [];
		queryState.updateRows = undefined;
		queryState.updateWhere = undefined;
	});

	it("prefers the default enabled and tested provider, then the most recently used, then creation order", async () => {
		queryState.rows = [providerRow({ id: "first-created" })];

		await expect(aiProvidersService.getDefaultRunnable({ userId: "user-1" })).resolves.toMatchObject({
			id: "first-created",
			apiKey: "decrypted-key",
		});

		expect(queryState.whereArg).toEqual({
			type: "and",
			conditions: [
				{ type: "eq", left: "ai_provider.user_id", right: "user-1" },
				{ type: "eq", left: "ai_provider.enabled", right: true },
				{ type: "eq", left: "ai_provider.test_status", right: "success" },
				{ type: "ne", left: "ai_provider.id", right: "server-ai:user-1" },
			],
		});
		expect(queryState.orderByArgs).toEqual([
			{ type: "desc", value: "ai_provider.is_default" },
			{
				type: "desc",
				value: {
					type: "sql",
					strings: ["coalesce(", ", '1970-01-01T00:00:00.000Z'::timestamptz)"],
					values: ["ai_provider.last_used_at"],
				},
			},
			{ type: "asc", value: "ai_provider.created_at" },
		]);
		expect(queryMock.limit).toHaveBeenCalledWith(1);
	});

	it("sends a saved key only to the host it was saved for", async () => {
		queryState.rows = [providerRow()];
		vi.mocked(resolveAiBaseUrl).mockReturnValue("https://other.example/v1");
		const owner = { id: "provider-1", userId: "user-1" };

		for (const change of [{ baseURL: "https://other.example/v1" }, { provider: "anthropic" as const }])
			await expect(aiProvidersService.update({ ...owner, ...change })).rejects.toMatchObject({
				code: "BAD_REQUEST",
				message: "Enter the API key again to change the provider or base URL.",
			});
		expect(dbMock.update).not.toHaveBeenCalled();

		await expect(
			aiProvidersService.update({ ...owner, baseURL: "https://other.example/v1", apiKey: "new-key" }),
		).resolves.toMatchObject({ id: "provider-1" });
	});

	it("rejects an update if the destination or credential changed after the ownership read", async () => {
		queryState.rows = [providerRow()];
		queryState.updateRows = [];
		await expect(
			aiProvidersService.update({ id: "provider-1", userId: "user-1", apiKey: "new-key" }),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(queryState.updateWhere).toMatchObject({
			conditions: expect.arrayContaining([
				{ type: "eq", left: "ai_provider.provider", right: "openai" },
				{ type: "isNull", value: "ai_provider.base_url" },
				{ type: "eq", left: "ai_provider.encrypted_api_key", right: "encrypted-key" },
			]),
		});
	});
	it("binds recipient version to owner, provider, model, full URL and encrypted credential revision", async () => {
		queryState.rows = [providerRow()];
		const original = await aiProvidersService.getDefaultRunnable({ userId: "user-1" });
		expect(original?.recipientVersion).toMatch(/^[a-f0-9]{64}$/);
		for (const change of [
			{ id: "other" },
			{ userId: "other" },
			{ provider: "anthropic" },
			{ model: "other" },
			{ baseUrl: "https://other.example/v1" },
			{ encryptedApiKey: "replacement" },
		]) {
			queryState.rows = [providerRow(change)];
			expect((await aiProvidersService.getDefaultRunnable({ userId: "user-1" }))?.recipientVersion).not.toBe(
				original?.recipientVersion,
			);
		}
	});
});
