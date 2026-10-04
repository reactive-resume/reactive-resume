import type { Server } from "node:http";
/**
 * End-to-end coverage of the OrcaRouter PKCE connect adapter.
 *
 * Everything from `orcaConnectBegin` down is the real thing: the connect service, the PKCE attempt
 * (fresh verifier/state, S256 challenge), the exchange request, and the project's AES-GCM credential
 * encryption as it is stored. A local fake auth server stands in for the OrcaRouter consent screen and
 * exchange endpoint; the database is an in-memory row store.
 */
import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const dbState = vi.hoisted(() => ({ rows: [] as Row[], inserted: [] as Row[] }));

const envMock = vi.hoisted(() => ({
	ENCRYPTION_SECRET: "pkce-test-encryption-secret-with-entropy",
	ORCA_AUTH_BASE_URL: "",
	ORCA_API_BASE_URL: "",
	ORCA_BASE_URL: "",
}));

vi.mock("@reactive-resume/env/server", () => ({ env: envMock }));

vi.mock("@reactive-resume/db/redis", () => ({
	getRedis: () => null,
	redisKey: (...parts: string[]) => parts.join(":"),
}));

vi.mock("@reactive-resume/db/client", () => {
	const db = {
		select: () => ({
			from: () => ({
				where: (condition: unknown) => ({
					orderBy: () => Promise.resolve(dbState.rows.filter((row) => matches(condition, row))),
					limit: async () => dbState.rows.filter((row) => matches(condition, row)),
				}),
			}),
		}),
		insert: () => ({
			values: (values: Row) => ({
				returning: async () => {
					const row = { id: `provider-${dbState.rows.length + 1}`, ...values };
					dbState.rows.push(row);
					dbState.inserted.push(row);
					return [row];
				},
			}),
		}),
		update: () => ({
			set: (values: Row) => ({
				// Supports both `.returning()` and a bare awaited `.where()`, as the service uses both.
				where: (condition: unknown) => {
					// The builder is both awaited directly and used through `.returning()`, so the match is
					// computed once: a second pass would re-filter rows the first pass already changed.
					let matched: Row[] | undefined;
					const apply = () => {
						if (matched) return matched;
						matched = dbState.rows.filter((row) => matches(condition, row));
						for (const row of matched) Object.assign(row, values);
						return matched;
					};
					return Object.assign(Promise.resolve(apply()), { returning: async () => apply() });
				},
			}),
		}),
	};
	void 0;
	return { db };
});

vi.mock("drizzle-orm", () => ({
	and: (...conditions: unknown[]) => ({ kind: "and", conditions }),
	eq: (left: unknown, right: unknown) => ({ kind: "eq", left, right }),
	ne: (left: unknown, right: unknown) => ({ kind: "ne", left, right }),
	asc: (value: unknown) => ({ kind: "asc", value }),
	desc: (value: unknown) => ({ kind: "desc", value }),
	sql: () => ({}),
	count: () => ({}),
}));

vi.mock("@reactive-resume/db/schema", () => ({
	aiProvider: {
		id: "id",
		userId: "userId",
		label: "label",
		provider: "provider",
		model: "model",
		baseUrl: "baseUrl",
		encryptedApiKey: "encryptedApiKey",
		apiKeySalt: "apiKeySalt",
		apiKeyHash: "apiKeyHash",
		apiKeyPreview: "apiKeyPreview",
		credentialMethod: "credentialMethod",
		credentialScope: "credentialScope",
		needsReauth: "needsReauth",
		reauthReason: "reauthReason",
		reauthAt: "reauthAt",
		testStatus: "testStatus",
		testError: "testError",
		lastTestedAt: "lastTestedAt",
		lastUsedAt: "lastUsedAt",
		enabled: "enabled",
		createdAt: "createdAt",
		updatedAt: "updatedAt",
	},
}));

let matches: (condition: unknown, row: Row) => boolean;

/** Minimal evaluator for the eq/and conditions the service builds against the mocked column tokens. */
function installMatcher() {
	matches = (condition: unknown, row: Row): boolean => {
		if (!condition || typeof condition !== "object") return true;
		const node = condition as { kind?: string; conditions?: unknown[]; left?: unknown; right?: unknown };
		if (node.kind === "and") return (node.conditions ?? []).every((child) => matches(child, row));
		if (node.kind === "eq") return row[String(node.left)] === node.right;
		if (node.kind === "ne") return row[String(node.left)] !== node.right;
		return true;
	};
}

const { orcaRouterConnectService } = await import("./connect");
const { decryptCredential } = await import("../credentials");
const { aiProvidersService } = await import("../../ai-providers/service");

type FakeConsent = {
	server: Server;
	baseUrl: string;
	/** Approving the consent screen: mints a one-time code bound to the challenge from an authorize URL. */
	approve: (authorizeUrl: string, scope?: string) => string;
	deny: (authorizeUrl: string) => void;
	/** Everything the fake endpoint received, so the test can assert exactly what was sent. */
	exchanges: Array<{ body: Record<string, string>; url: string }>;
	expireCode: (code: string) => void;
	reuseCode: (code: string) => void;
	reissue: (code: string, times: number) => void;
	failWith: (status: number, body: unknown) => void;
};

async function startFakeConsentServer(): Promise<FakeConsent> {
	const pending = new Map<string, { challenge: string; scope: string; used: boolean }>();
	const exchanges: FakeConsent["exchanges"] = [];
	let forced: { status: number; body: unknown } | null = null;

	const server = createServer((request, response) => {
		const url = new URL(request.url ?? "/", "http://127.0.0.1");
		if (request.method !== "POST" || url.pathname !== "/api/v1/auth/keys") {
			response.writeHead(404).end();
			return;
		}

		const chunks: Buffer[] = [];
		request.on("data", (chunk: Buffer) => chunks.push(chunk));
		request.on("end", () => {
			const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, string>;
			exchanges.push({ body, url: url.toString() });

			if (forced) {
				const { status, body: forcedBody } = forced;
				forced = null;
				response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(forcedBody));
				return;
			}

			const record = pending.get(body.code ?? "");
			if (!record || record.used) {
				response.writeHead(403, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "invalid_grant" }));
				return;
			}
			// The real endpoint hashes the presented verifier and compares it to the stored challenge.
			const computed = createHash("sha256")
				.update(body.code_verifier ?? "")
				.digest("base64url")
				.replace(/=+$/, "");
			if (computed !== record.challenge) {
				response.writeHead(403, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "invalid_grant" }));
				return;
			}
			if (body.code_challenge_method !== "S256") {
				response
					.writeHead(400, { "Content-Type": "application/json" })
					.end(JSON.stringify({ error: "invalid_request" }));
				return;
			}

			record.used = true;
			response
				.writeHead(200, { "Content-Type": "application/json" })
				.end(JSON.stringify({ key: "sk-orca-from-consent", user_id: "12345", scope: record.scope }));
		});
	});

	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as AddressInfo).port;

	return {
		server,
		baseUrl: `http://127.0.0.1:${port}`,
		exchanges,
		approve: (authorizeUrl, scope = "api") => {
			const url = new URL(authorizeUrl);
			const state = url.searchParams.get("state") ?? "";
			const code = `code-${state.slice(0, 8)}`;
			pending.set(code, { challenge: url.searchParams.get("code_challenge") ?? "", scope, used: false });
			return code;
		},
		deny: (authorizeUrl) => {
			const url = new URL(authorizeUrl);
			const state = url.searchParams.get("state") ?? "";
			pending.set(`denied-${state.slice(0, 8)}`, { challenge: "-", scope: "api", used: true });
		},
		expireCode: (code) => pending.delete(code),
		reuseCode: (code) => {
			const record = pending.get(code);
			if (record) record.used = true;
		},
		reissue: (code, times) => {
			const record = pending.get(code);
			if (record) record.used = times > 1;
		},
		failWith: (status, body) => {
			forced = { status, body };
		},
	};
}

let consent: FakeConsent;

beforeAll(async () => {
	installMatcher();
	consent = await startFakeConsentServer();
	envMock.ORCA_AUTH_BASE_URL = consent.baseUrl;
	envMock.ORCA_API_BASE_URL = `${consent.baseUrl}/v1`;
});

afterAll(async () => {
	await new Promise<void>((resolve) => consent.server.close(() => resolve()));
});

beforeEach(() => {
	dbState.rows.length = 0;
	dbState.inserted.length = 0;
	consent.exchanges.length = 0;
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("OrcaRouter PKCE connect adapter", () => {
	it("completes authorize → exchange → persist and stores the key encrypted", async () => {
		const begun = await orcaRouterConnectService.begin({ userId: "user-1", label: "Work" });

		// The authorize URL carries the challenge and state, never the verifier.
		const authorize = new URL(begun.authorizeUrl);
		expect(authorize.pathname).toBe("/auth");
		expect(authorize.searchParams.get("callback_url")).toBe("oob");
		expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
		expect(begun.authorizeUrl).not.toContain("code_verifier");

		const code = consent.approve(begun.authorizeUrl);
		const result = await orcaRouterConnectService.complete({ userId: "user-1", connectId: begun.connectId, code });

		expect(result).toMatchObject({ method: "pkce", scope: "api" });
		expect(consent.exchanges).toHaveLength(1);
		expect(consent.exchanges[0]?.url).toContain("/api/v1/auth/keys");

		// Persisted through the project's own credential store, encrypted, with the method recorded.
		const row = dbState.inserted.at(-1);
		expect(row?.provider).toBe("orcarouter");
		expect(row?.credentialMethod).toBe("pkce");
		expect(row?.credentialScope).toBe("api");
		expect(row?.needsReauth).toBe(false);
		expect(String(row?.encryptedApiKey)).not.toContain("sk-orca-from-consent");
		expect(decryptCredential(String(row?.encryptedApiKey))).toBe("sk-orca-from-consent");
		expect(row?.apiKeyPreview).toBe("sk-o...sent");
	});

	it("never sends the verifier to the browser or into the stored attempt the client can read", async () => {
		const begun = await orcaRouterConnectService.begin({ userId: "user-1" });
		const storedVerifier = (await orcaRouterConnectService.peekPendingAttempt(begun.connectId))?.verifier ?? null;

		expect(storedVerifier).toBeTruthy();
		expect(begun.authorizeUrl).not.toContain(String(storedVerifier));
		expect(JSON.stringify(begun)).not.toContain(String(storedVerifier));
	});

	it("makes each attempt use a fresh verifier and state", async () => {
		const first = await orcaRouterConnectService.begin({ userId: "user-1" });
		const second = await orcaRouterConnectService.begin({ userId: "user-1" });

		const firstVerifier = (await orcaRouterConnectService.peekPendingAttempt(first.connectId))?.verifier ?? null;
		const secondVerifier = (await orcaRouterConnectService.peekPendingAttempt(second.connectId))?.verifier ?? null;
		expect(firstVerifier).not.toBe(secondVerifier);

		const firstState = new URL(first.authorizeUrl).searchParams.get("state");
		const secondState = new URL(second.authorizeUrl).searchParams.get("state");
		expect(firstState).not.toBe(secondState);
	});

	it("rejects a code that has already been used, and does not keep the attempt", async () => {
		const begun = await orcaRouterConnectService.begin({ userId: "user-1" });
		const code = consent.approve(begun.authorizeUrl);
		await orcaRouterConnectService.complete({ userId: "user-1", connectId: begun.connectId, code });
		consent.reuseCode(code);

		// A second attempt reusing the same (now consumed) code is rejected by the endpoint.
		const second = await orcaRouterConnectService.begin({ userId: "user-1" });
		await expect(
			orcaRouterConnectService.complete({ userId: "user-1", connectId: second.connectId, code }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });

		// Terminal failures consume the attempt: it cannot be retried into a hot loop.
		await expect(
			orcaRouterConnectService.complete({ userId: "user-1", connectId: second.connectId, code }),
		).rejects.toMatchObject({ message: expect.stringContaining("expired or was cancelled") });
	});

	it("treats an expired code as terminal without retrying", async () => {
		const begun = await orcaRouterConnectService.begin({ userId: "user-1" });
		const code = consent.approve(begun.authorizeUrl);
		consent.expireCode(code);

		await expect(
			orcaRouterConnectService.complete({ userId: "user-1", connectId: begun.connectId, code }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(consent.exchanges).toHaveLength(1);
	});

	it("surfaces a scope downgrade instead of assuming the requested scope", async () => {
		const begun = await orcaRouterConnectService.begin({ userId: "user-1" });
		const code = consent.approve(begun.authorizeUrl, "connector");

		await expect(
			orcaRouterConnectService.complete({ userId: "user-1", connectId: begun.connectId, code }),
		).rejects.toMatchObject({ message: expect.stringContaining("less access") });
		expect(dbState.inserted).toHaveLength(0);
	});

	it("reports a 429 as a rate limit, not as a broken key", async () => {
		const begun = await orcaRouterConnectService.begin({ userId: "user-1" });
		const code = consent.approve(begun.authorizeUrl);
		consent.failWith(429, { error: "rate_limited" });

		await expect(
			orcaRouterConnectService.complete({ userId: "user-1", connectId: begun.connectId, code }),
		).rejects.toMatchObject({ message: expect.stringContaining("10 connections per day") });
	});

	it("reports a challenge-method rejection from the endpoint", async () => {
		const begun = await orcaRouterConnectService.begin({ userId: "user-1" });
		const code = consent.approve(begun.authorizeUrl);
		consent.failWith(400, { error: "invalid_request", error_description: "code_challenge_method mismatch" });

		await expect(
			orcaRouterConnectService.complete({ userId: "user-1", connectId: begun.connectId, code }),
		).rejects.toMatchObject({ message: "code_challenge_method mismatch" });
	});

	it("reports an unreachable endpoint with an actionable message", async () => {
		const begun = await orcaRouterConnectService.begin({ userId: "user-1" });
		const code = consent.approve(begun.authorizeUrl);
		const closed = consent.server;
		await new Promise<void>((resolve) => closed.close(() => resolve()));

		await expect(
			orcaRouterConnectService.complete({ userId: "user-1", connectId: begun.connectId, code }),
		).rejects.toMatchObject({ message: expect.stringContaining("Could not reach OrcaRouter") });

		// Restore the endpoint for the remaining tests.
		consent = await startFakeConsentServer();
		envMock.ORCA_AUTH_BASE_URL = consent.baseUrl;
		envMock.ORCA_API_BASE_URL = `${consent.baseUrl}/v1`;
	});

	it("answers a missing code and an unknown attempt without leaking details", async () => {
		const begun = await orcaRouterConnectService.begin({ userId: "user-1" });
		await expect(
			orcaRouterConnectService.complete({ userId: "user-1", connectId: begun.connectId, code: "  " }),
		).rejects.toMatchObject({ message: expect.stringContaining("Paste the code") });
		await expect(
			orcaRouterConnectService.complete({ userId: "user-1", connectId: "unknown", code: "c" }),
		).rejects.toMatchObject({ message: expect.stringContaining("expired or was cancelled") });
	});

	it("does not let another user complete or cancel an attempt", async () => {
		const begun = await orcaRouterConnectService.begin({ userId: "user-1" });
		const code = consent.approve(begun.authorizeUrl);

		await expect(
			orcaRouterConnectService.complete({ userId: "user-2", connectId: begun.connectId, code }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(await orcaRouterConnectService.status({ connectId: begun.connectId, userId: "user-2" })).toEqual({
			status: "cancelled",
		});
		// The owner can still finish it.
		await expect(
			orcaRouterConnectService.complete({ userId: "user-1", connectId: begun.connectId, code }),
		).resolves.toMatchObject({ method: "pkce" });
	});

	it("cancels an attempt and releases it, so a second attempt can start", async () => {
		const first = await orcaRouterConnectService.begin({ userId: "user-1" });
		await expect(orcaRouterConnectService.cancel({ connectId: first.connectId, userId: "user-1" })).resolves.toEqual({
			status: "cancelled",
		});
		expect(await orcaRouterConnectService.status({ connectId: first.connectId, userId: "user-1" })).toEqual({
			status: "cancelled",
		});

		const second = await orcaRouterConnectService.begin({ userId: "user-1" });
		const code = consent.approve(second.authorizeUrl);
		await expect(
			orcaRouterConnectService.complete({ userId: "user-1", connectId: second.connectId, code }),
		).resolves.toMatchObject({ method: "pkce" });
	});

	it("replaces the credential on an existing row and clears a reauth state", async () => {
		dbState.rows.push({
			id: "provider-existing",
			userId: "user-1",
			provider: "orcarouter",
			label: "Old",
			model: "openai/gpt-5.5",
			encryptedApiKey: "old",
			needsReauth: true,
			reauthReason: "rejected",
			credentialMethod: "api_key",
			testStatus: "failure",
		});
		await aiProvidersService.assertOwnedProvider({ id: "provider-existing", userId: "user-1" });

		const begun = await orcaRouterConnectService.begin({
			userId: "user-1",
			providerId: "provider-existing",
			label: "Renamed",
		});
		const code = consent.approve(begun.authorizeUrl);
		const result = await orcaRouterConnectService.complete({
			userId: "user-1",
			connectId: begun.connectId,
			code,
		});

		expect(result.providerId).toBe("provider-existing");
		const row = dbState.rows.find((candidate) => candidate.id === "provider-existing");
		expect(row).toMatchObject({
			credentialMethod: "pkce",
			credentialScope: "api",
			needsReauth: false,
			reauthReason: null,
			label: "Renamed",
			enabled: false,
			testStatus: "untested",
		});
		expect(decryptCredential(String(row?.encryptedApiKey))).toBe("sk-orca-from-consent");
	});

	it("refuses to reconnect a provider that belongs to somebody else", async () => {
		dbState.rows.push({ id: "provider-other", userId: "user-2", provider: "orcarouter", label: "Other" });
		await expect(
			orcaRouterConnectService.begin({ userId: "user-1", providerId: "provider-other" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});
