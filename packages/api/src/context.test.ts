import { describe, expect, it, vi } from "vite-plus/test";
import { createProcedureClient } from "@orpc/server";
import { env } from "@reactive-resume/env/server";

const authMock = vi.hoisted(() => ({
	api: {
		getSession: vi.fn(),
		verifyApiKey: vi.fn(),
	},
}));
const verifyOAuthTokenMock = vi.hoisted(() => vi.fn());

const dbMock = vi.hoisted(() => ({
	select: vi.fn(),
}));

vi.mock("@reactive-resume/auth/config", () => ({
	auth: authMock,
	verifyOAuthToken: verifyOAuthTokenMock,
}));
vi.mock("@reactive-resume/db/client", () => ({ db: dbMock }));
vi.mock("@reactive-resume/db/schema", () => ({ user: { __table: "user" } }));
vi.mock("drizzle-orm", () => ({ eq: () => "EQ" }));
vi.mock("@reactive-resume/env/server", async (importOriginal) => {
	const { env } = await importOriginal<typeof import("@reactive-resume/env/server")>();
	return { env: { ...env, APP_ALIAS_URL: "https://rx.cv" } };
});

const { resolveUserFromRequestHeaders, resolveAuthenticationFromRequestHeaders, publicProcedure, protectedProcedure } =
	await import("./context");

const setupDbResolves = (userResult: unknown) => {
	dbMock.select.mockReturnValueOnce({
		from: () => ({
			where: () => ({
				limit: () => Promise.resolve(userResult ? [userResult] : []),
			}),
		}),
	});
};

const reset = () => {
	authMock.api.getSession.mockReset();
	authMock.api.verifyApiKey.mockReset();
	verifyOAuthTokenMock.mockReset();
	dbMock.select.mockReset();
};

describe("resolveUserFromRequestHeaders", () => {
	it("falls back to a valid bearer token when an API key is invalid", async () => {
		reset();
		authMock.api.verifyApiKey.mockResolvedValueOnce({ valid: false });
		verifyOAuthTokenMock.mockResolvedValueOnce({ sub: "bearer-user" });
		setupDbResolves({ id: "bearer-user" });
		const user = await resolveUserFromRequestHeaders(
			new Headers({ "x-api-key": "expired-key", authorization: "Bearer valid-token" }),
		);
		expect(user).toMatchObject({ id: "bearer-user" });
		expect(verifyOAuthTokenMock).toHaveBeenCalledWith("valid-token");
	});
	it("returns the user resolved from a valid x-api-key", async () => {
		reset();
		authMock.api.verifyApiKey.mockResolvedValueOnce({ valid: true, key: { referenceId: "user-1" } });
		setupDbResolves({ id: "user-1", name: "Alice" });

		const headers = new Headers({ "x-api-key": "abc123" });
		const user = await resolveUserFromRequestHeaders(headers);

		expect(authMock.api.verifyApiKey).toHaveBeenCalledWith({ body: { key: "abc123" } });
		expect(user).toMatchObject({ id: "user-1", name: "Alice" });
	});

	it("uses Bearer token when present and no api key", async () => {
		reset();
		verifyOAuthTokenMock.mockResolvedValueOnce({ sub: "user-bearer" });
		setupDbResolves({ id: "user-bearer", name: "Bob" });

		const headers = new Headers({ authorization: "Bearer xxx.yyy.zzz" });
		const user = await resolveUserFromRequestHeaders(headers);

		expect(verifyOAuthTokenMock).toHaveBeenCalledWith("xxx.yyy.zzz");
		expect(user).toMatchObject({ id: "user-bearer", name: "Bob" });
	});
});

describe("cookie request origins", () => {
	it.each([
		{ origin: "https://attacker.example" },
		{ origin: "null" },
		{ "sec-fetch-site": "cross-site" },
		{ origin: "https://rx.cv", "sec-fetch-site": "cross-site" },
		{ origin: "https://rx.cv.attacker.example", "sec-fetch-site": "same-origin" },
		{ origin: "http://rx.cv", "sec-fetch-site": "same-origin" },
		{ origin: "https://rx.cv:8443", "sec-fetch-site": "same-origin" },
	])("rejects ambient credentials from another origin: %j", async (originHeaders) => {
		reset();
		authMock.api.getSession.mockResolvedValue({ user: { id: "owner" } });
		const headers = new Headers({ cookie: "session=valid", ...originHeaders });
		await expect(resolveUserFromRequestHeaders(headers)).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(authMock.api.getSession).not.toHaveBeenCalled();
	});

	it("serves anonymous public procedures on the alias when incidental cookies are present", async () => {
		reset();
		authMock.api.getSession.mockResolvedValue(null);
		const context = {
			locale: "en-US" as const,
			reqHeaders: new Headers({ cookie: "theme=dark", origin: "https://rx.cv", "sec-fetch-site": "same-origin" }),
		};
		const publicOperation = createProcedureClient(
			publicProcedure.handler(({ context }) => context.user),
			{ context },
		);
		await expect(publicOperation(undefined)).resolves.toBeNull();
		const protectedOperation = createProcedureClient(
			protectedProcedure.handler(() => "private"),
			{ context },
		);
		await expect(protectedOperation(undefined)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});

	it("accepts same-origin cookies and explicit bearer credentials from other origins", async () => {
		reset();
		authMock.api.getSession.mockResolvedValue({ user: { id: "session-user" } });
		setupDbResolves({ id: "session-user" });
		await expect(
			resolveUserFromRequestHeaders(new Headers({ cookie: "session=valid", origin: new URL(env.APP_URL).origin })),
		).resolves.toMatchObject({ id: "session-user" });
		verifyOAuthTokenMock.mockResolvedValueOnce({ sub: "token-user" });
		setupDbResolves({ id: "token-user" });
		await expect(
			resolveUserFromRequestHeaders(
				new Headers({ authorization: "Bearer token", cookie: "session=valid", origin: "https://client.example" }),
			),
		).resolves.toMatchObject({ id: "token-user" });
	});

	it("accepts loopback alias origins for session cookies", async () => {
		reset();
		authMock.api.getSession.mockResolvedValue({ user: { id: "loopback-user" } });
		setupDbResolves({ id: "loopback-user" });
		const loopbackOrigin =
			new URL(env.APP_URL).hostname === "localhost" ? "http://127.0.0.1:3000" : "http://localhost:3000";
		await expect(
			resolveUserFromRequestHeaders(new Headers({ cookie: "session=valid", origin: loopbackOrigin })),
		).resolves.toMatchObject({ id: "loopback-user" });
	});
});

describe("credential authorization", () => {
	it.each([
		{ banned: true, banExpires: null, allowed: false },
		{ banned: true, banExpires: new Date("2999-01-01"), allowed: false },
		{ banned: true, banExpires: new Date("2000-01-01"), allowed: true },
	])("enforces active bans for explicit credentials: %j", async ({ banned, banExpires, allowed }) => {
		reset();
		authMock.api.verifyApiKey.mockResolvedValue({ valid: true, key: { referenceId: "owner" } });
		setupDbResolves({ id: "owner", banned, banExpires });
		const result = await resolveUserFromRequestHeaders(new Headers({ "x-api-key": "key" }));
		expect(result?.id ?? null).toBe(allowed ? "owner" : null);
	});

	it.each([
		{ permissions: { api: ["read"] }, method: "GET" as const, allowed: true },
		{ permissions: { api: ["read"] }, method: "POST" as const, allowed: false },
		{ permissions: { api: ["write"] }, method: "DELETE" as const, allowed: false },
		{ permissions: null, method: "POST" as const, allowed: true },
		{ permissions: {}, method: "GET" as const, allowed: false },
		// Moving to Trash deletes the document from view, then for good after 30 days.
		{ permissions: { api: ["write"] }, method: "POST" as const, operationId: "trashDocument", allowed: false },
		{ permissions: { api: ["write"] }, method: "PUT" as const, operationId: "putDocumentTrash", allowed: false },
		{ permissions: { api: ["delete"] }, method: "POST" as const, operationId: "trashDocument", allowed: true },
		{ permissions: { api: ["write"] }, method: "POST" as const, operationId: "restoreDocuments", allowed: true },
		{ permissions: { api: ["write"] }, method: "POST" as const, operationId: "purgeDocuments", allowed: false },
		{ permissions: { api: ["delete"] }, method: "POST" as const, operationId: "purgeDocuments", allowed: true },
		{ permissions: { api: ["write"] }, method: "DELETE" as const, operationId: "emptyDocumentTrash", allowed: false },
		{ permissions: { api: ["delete"] }, method: "DELETE" as const, operationId: "emptyDocumentTrash", allowed: true },
	])("enforces API-key permissions at procedure execution: %j", async ({ permissions, method, allowed, ...route }) => {
		reset();
		authMock.api.verifyApiKey.mockResolvedValue({ valid: true, key: { referenceId: "owner", permissions } });
		setupDbResolves({ id: "owner" });
		const operation = createProcedureClient(
			protectedProcedure.route({ method, ...route }).handler(() => "executed"),
			{
				context: { locale: "en-US", reqHeaders: new Headers({ "x-api-key": "key" }) },
			},
		);
		if (allowed) await expect(operation(undefined)).resolves.toBe("executed");
		else await expect(operation(undefined)).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("preserves OAuth read-only scope when another identity cookie is present", async () => {
		reset();
		verifyOAuthTokenMock.mockResolvedValue({ sub: "owner", scope: "api:read" });
		setupDbResolves({ id: "owner" });
		const authentication = await resolveAuthenticationFromRequestHeaders(
			new Headers({ authorization: "Bearer token", cookie: "session=other" }),
		);
		const operation = createProcedureClient(
			protectedProcedure.route({ method: "POST" }).handler(() => "executed"),
			{
				context: { locale: "en-US", reqHeaders: new Headers(), authentication },
			},
		);
		await expect(operation(undefined)).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(authMock.api.getSession).not.toHaveBeenCalled();
	});
});
