import { describe, expect, it, vi } from "vitest";
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

const { resolveUserFromRequestHeaders } = await import("./context");

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
	it.each([{ origin: "https://attacker.example" }, { origin: "null" }, { "sec-fetch-site": "cross-site" }])(
		"rejects ambient credentials from another origin: %j",
		async (originHeaders) => {
			reset();
			authMock.api.getSession.mockResolvedValue({ user: { id: "owner" } });
			const headers = new Headers({ cookie: "session=valid", ...originHeaders });
			await expect(resolveUserFromRequestHeaders(headers)).rejects.toMatchObject({ code: "FORBIDDEN" });
			expect(authMock.api.getSession).not.toHaveBeenCalled();
		},
	);

	it("accepts same-origin cookies and explicit bearer credentials from other origins", async () => {
		reset();
		authMock.api.getSession.mockResolvedValue({ user: { id: "session-user" } });
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
});
