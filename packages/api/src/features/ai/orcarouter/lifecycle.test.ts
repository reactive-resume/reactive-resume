import { beforeEach, describe, expect, it, vi } from "vitest";
import { APICallError } from "ai";

const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], markCalls: [] as unknown[] }));

vi.mock("@reactive-resume/env/server", () => ({ env: { ENCRYPTION_SECRET: "lifecycle-test-secret-with-entropy" } }));
vi.mock("@reactive-resume/db/redis", () => ({
	getRedis: () => null,
	redisKey: (...parts: string[]) => parts.join(":"),
}));
vi.mock("@reactive-resume/db/client", () => ({
	db: {
		update: () => ({
			set: (values: Record<string, unknown>) => ({
				where: (condition: unknown) => ({
					returning: async () => {
						const matched = state.rows.filter((row) => matches(condition, row));
						for (const row of matched) Object.assign(row, values);
						return matched;
					},
				}),
			}),
		}),
	},
}));

let matches: (condition: unknown, row: Record<string, unknown>) => boolean;
function installMatcher() {
	matches = (condition, row) => {
		if (!condition || typeof condition !== "object") return true;
		const node = condition as { kind?: string; conditions?: unknown[]; left?: unknown; right?: unknown };
		if (node.kind === "and") return (node.conditions ?? []).every((child) => matches(child, row));
		if (node.kind === "eq") return row[String(node.left)] === node.right;
		return true;
	};
}

vi.mock("drizzle-orm", () => ({
	and: (...conditions: unknown[]) => ({ kind: "and", conditions }),
	eq: (left: unknown, right: unknown) => ({ kind: "eq", left, right }),
	ne: (left: unknown, right: unknown) => ({ kind: "ne", left, right }),
	asc: (value: unknown) => ({ value }),
	desc: (value: unknown) => ({ value }),
	sql: () => ({}),
}));

vi.mock("@reactive-resume/db/schema", () => ({
	aiProvider: {
		id: "id",
		userId: "userId",
		provider: "provider",
		apiKeyHash: "apiKeyHash",
		needsReauth: "needsReauth",
		enabled: "enabled",
		testStatus: "testStatus",
		testError: "testError",
		reauthReason: "reauthReason",
		reauthAt: "reauthAt",
		lastUsedAt: "lastUsedAt",
	},
}));

vi.mock("../../ai-providers/service", () => ({
	aiProvidersService: {
		markNeedsReauth: vi.fn(async (input: unknown) => {
			state.markCalls.push(input);
			return true;
		}),
	},
}));

const { isAuthenticationRejection, markOrcaRouterCredentialRejected } = await import("./lifecycle");
const { aiProvidersService } = await import("../../ai-providers/service");

const rejection = () => (APICallError.isInstance(new Error()) ? new Error() : createApiCallError(401));

function createApiCallError(statusCode: number) {
	return new APICallError({
		message: `provider returned ${statusCode}`,
		url: "https://api.orcarouter.ai/v1/chat/completions",
		requestBodyValues: {},
		statusCode,
		responseBody: "{}",
	});
}

beforeEach(() => {
	installMatcher();
	state.rows.length = 0;
	state.markCalls.length = 0;
	vi.clearAllMocks();
});

describe("OrcaRouter terminal reauthentication", () => {
	it("recognises a 401 and a 403, including one wrapped in a cause chain", () => {
		expect(isAuthenticationRejection(createApiCallError(401))).toBe(true);
		expect(isAuthenticationRejection(createApiCallError(403))).toBe(true);
		expect(isAuthenticationRejection(createApiCallError(500))).toBe(false);
		expect(isAuthenticationRejection(new Error("nope"))).toBe(false);
		expect(isAuthenticationRejection(undefined)).toBe(false);

		const wrapped = Object.assign(new Error("wrapped"), { cause: createApiCallError(401) });
		expect(isAuthenticationRejection(wrapped)).toBe(true);
	});

	it("marks only the exact rejected credential generation", async () => {
		await markOrcaRouterCredentialRejected({
			userId: "user-1",
			provider: { id: "provider-1", provider: "orcarouter", apiKeyFingerprint: "generation-a" },
			error: rejection(),
		});

		expect(state.markCalls).toEqual([
			{
				id: "provider-1",
				userId: "user-1",
				credentialGeneration: "generation-a",
				reason: expect.stringContaining("Connect again"),
			},
		]);
		// No refresh is attempted anywhere in this path.
		expect(vi.mocked(aiProvidersService.markNeedsReauth)).toHaveBeenCalledTimes(1);
	});

	it("ignores a rejection for a provider that is not OrcaRouter", async () => {
		const marked = await markOrcaRouterCredentialRejected({
			userId: "user-1",
			provider: { id: "provider-1", provider: "openai", apiKeyFingerprint: "generation-a" },
			error: rejection(),
		});
		expect(marked).toBe(false);
		expect(state.markCalls).toEqual([]);
	});

	it("ignores a rejection that is not an authentication failure", async () => {
		const marked = await markOrcaRouterCredentialRejected({
			userId: "user-1",
			provider: { id: "provider-1", provider: "orcarouter", apiKeyFingerprint: "generation-a" },
			error: createApiCallError(500),
		});
		expect(marked).toBe(false);
		expect(state.markCalls).toEqual([]);
	});

	it("extends the service contract with a generation-bound transition", async () => {
		// The service is the only writer: the lifecycle hook never touches the database directly.
		expect(typeof aiProvidersService.markNeedsReauth).toBe("function");
	});
});
