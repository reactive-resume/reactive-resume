import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], updates: [] as Record<string, unknown>[] }));

vi.mock("@reactive-resume/env/server", () => ({ env: { ENCRYPTION_SECRET: "seam-test-secret-with-enough-entropy" } }));
vi.mock("@reactive-resume/db/redis", () => ({
	getRedis: () => null,
	redisKey: (...parts: string[]) => parts.join(":"),
}));
vi.mock("@reactive-resume/db/client", () => ({
	db: {
		update: () => ({
			set: (values: Record<string, unknown>) => ({
				where: (condition: unknown) => {
					// The builder is both awaited directly and used through `.returning()`, so the match is
					// computed once: a second pass would re-filter rows the first pass already changed.
					let matched: Record<string, unknown>[] | undefined;
					const apply = () => {
						if (matched) return matched;
						state.updates.push(values);
						matched = state.rows.filter((row) => matches(condition, row));
						for (const row of matched) Object.assign(row, values);
						return matched;
					};
					return Object.assign(Promise.resolve(apply()), { returning: async () => apply() });
				},
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
		lastUsedAt: "lastUsedAt",
	},
}));

const { aiProvidersService } = await import("../../ai-providers/service");

beforeEach(() => {
	installMatcher();
	state.rows.length = 0;
	state.updates.length = 0;
});

describe("generation-bound reauthentication transition", () => {
	it("moves only the credential generation that made the rejected request", async () => {
		state.rows.push(
			{ id: "provider-1", userId: "user-1", needsReauth: false, apiKeyHash: "old-generation", enabled: true },
			{ id: "provider-1", userId: "user-1", needsReauth: false, apiKeyHash: "new-generation", enabled: true },
		);

		// A stale failure from the old request arrives after a reconnect replaced the credential.
		const transitioned = await aiProvidersService.markNeedsReauth({
			id: "provider-1",
			userId: "user-1",
			credentialGeneration: "old-generation",
			reason: "rejected",
		});

		expect(transitioned).toBe(true);
		expect(state.rows[0]).toMatchObject({ needsReauth: true, enabled: false, testStatus: "failure" });
		// The freshly reauthorized credential is untouched, and no refresh was attempted.
		expect(state.rows[1]).toMatchObject({ needsReauth: false, enabled: true });
	});

	it("leaves a newer credential alone when a late failure names an old generation", async () => {
		state.rows.push({ id: "provider-1", userId: "user-1", needsReauth: false, apiKeyHash: "new-generation" });

		const transitioned = await aiProvidersService.markNeedsReauth({
			id: "provider-1",
			userId: "user-1",
			credentialGeneration: "old-generation",
			reason: "rejected",
		});

		expect(transitioned).toBe(false);
		expect(state.rows[0]).toMatchObject({ needsReauth: false });
	});

	it("is idempotent: an already-marked credential is not re-transitioned", async () => {
		state.rows.push({ id: "provider-1", userId: "user-1", needsReauth: true, apiKeyHash: "generation-a" });

		const transitioned = await aiProvidersService.markNeedsReauth({
			id: "provider-1",
			userId: "user-1",
			credentialGeneration: "generation-a",
			reason: "rejected again",
		});

		expect(transitioned).toBe(false);
	});

	it("does not touch another user's provider", async () => {
		state.rows.push({ id: "provider-1", userId: "user-2", needsReauth: false, apiKeyHash: "generation-a" });

		const transitioned = await aiProvidersService.markNeedsReauth({
			id: "provider-1",
			userId: "user-1",
			credentialGeneration: "generation-a",
			reason: "rejected",
		});

		expect(transitioned).toBe(false);
		expect(state.rows[0]).toMatchObject({ needsReauth: false });
	});

	it("clears the reauth state without deleting the stored secret", async () => {
		state.rows.push({ id: "provider-1", userId: "user-1", needsReauth: true, encryptedApiKey: "ciphertext-kept" });

		await aiProvidersService.clearReauth({ id: "provider-1", userId: "user-1" });

		expect(state.rows[0]).toMatchObject({ needsReauth: false, reauthReason: null, encryptedApiKey: "ciphertext-kept" });
	});
});
