import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
	getSession: vi.fn(),
	consent: vi.fn(),
	continueOAuth: vi.fn(),
	handler: vi.fn(),
	accountLinkHook: undefined as
		| ((params: { fromUserId: string; toUserId: string; excludedStoragePrefixes: string[] }) => Promise<unknown>)
		| undefined,
	migrateUserStorage: vi.fn(),
	env: {
		SERVER_PORT: 3001,
		APP_URL: "http://localhost:3000",
		FLAG_ALLOW_UNSAFE_OAUTH_REDIRECT_URI: false,
	},
}));

vi.mock("@reactive-resume/auth/config", () => ({
	auth: {
		api: {
			getSession: mocks.getSession,
			oauth2Consent: mocks.consent,
			oauth2Continue: mocks.continueOAuth,
		},
		handler: mocks.handler,
	},
	setAccountLinkHook: (hook: typeof mocks.accountLinkHook) => {
		mocks.accountLinkHook = hook;
	},
}));

vi.mock("@reactive-resume/api/features/storage", () => ({
	migrateUserStorage: mocks.migrateUserStorage,
}));

vi.mock("@reactive-resume/db/client", () => ({ db: {} }));
vi.mock("@reactive-resume/db/schema", () => ({ oauthClient: {}, verification: {} }));
vi.mock("@reactive-resume/env/server", () => ({
	env: mocks.env,
}));

beforeEach(() => {
	vi.clearAllMocks();
	mocks.env.FLAG_ALLOW_UNSAFE_OAUTH_REDIRECT_URI = false;
	mocks.handler.mockResolvedValue(new Response("ok"));
});

describe("handleAuth", () => {
	it.each(["203.0.113.9", "unknown"])("uses only the adapter's client address (%s)", async (trustedClient) => {
		const { handleAuth } = await import("./auth");
		await handleAuth(
			new Request("http://localhost:3000/api/auth/get-session", {
				headers: {
					"cf-connecting-ip": "198.51.100.1",
					"true-client-ip": "198.51.100.2",
					"x-forwarded-for": "198.51.100.3, 192.0.2.1",
					"x-real-ip": "198.51.100.4",
				},
			}),
			trustedClient,
		);
		const request = mocks.handler.mock.calls[0]?.[0] as Request;
		expect(request.headers.get("cf-connecting-ip")).toBeNull();
		expect(request.headers.get("true-client-ip")).toBeNull();
		expect(request.headers.get("x-forwarded-for")).toBeNull();
		expect(request.headers.get("x-real-ip")).toBe(trustedClient === "unknown" ? null : trustedClient);
	});
	it.for([null, [{ redirect_uris: [] }]])("rejects non-object registration payload %j", async (body) => {
		const { handleAuth } = await import("./auth");
		const response = await handleAuth(
			new Request("http://localhost:3000/api/auth/oauth2/register", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			}),
		);
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({ message: "Invalid registration payload" });
		expect(mocks.handler).not.toHaveBeenCalled();
	});

	it.each([
		["create-client", { post_logout_redirect_uris: ["https://10.0.0.1/logout"] }, "invalid_redirect_uri"],
		["create-client", { backchannel_logout_uri: "https://example.com/logout" }, "invalid_client_metadata"],
		["update-client", { client_id: "c", update: { redirect_uris: ["https://[::1]/cb"] } }, "invalid_redirect_uri"],
	])("rejects unsafe client metadata on %s: %j", async (endpoint, body, error) => {
		const { handleAuth } = await import("./auth");
		const response = await handleAuth(
			new Request(`http://localhost:3000/api/auth/oauth2/${endpoint}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			}),
		);
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({ error });
		expect(mocks.handler).not.toHaveBeenCalled();
	});

	it("keeps an explicitly registered client_secret_basic so the client receives a client secret", async () => {
		const { handleAuth } = await import("./auth");
		await handleAuth(
			new Request("http://localhost:3000/api/auth/oauth2/register", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					redirect_uris: ["https://example.com/callback"],
					token_endpoint_auth_method: "client_secret_basic",
				}),
			}),
		);
		const forwarded = mocks.handler.mock.calls[0]?.[0] as Request;
		await expect(forwarded.json()).resolves.toMatchObject({ token_endpoint_auth_method: "client_secret_basic" });
	});
});

describe("handleOAuth", () => {
	it.each([
		["xx-XX ar-SA", "ar-SA"],
		["zu-ZA", null],
	])("opens the same-origin login page in the client's ui_locales %s", async (uiLocales, expected) => {
		const { handleOAuth } = await import("./auth");
		mocks.getSession.mockResolvedValueOnce(null);
		const query = new URLSearchParams({ client_id: "test-client", ui_locales: uiLocales, sig: "456" });

		const response = await handleOAuth(new Request(`http://localhost:3001/api/auth/oauth?${query}`));

		expect(response.status).toBe(302);
		const location = response.headers.get("Location");
		expect(location).toMatch(/^\/auth\/login\?/);
		const loginUrl = new URL(location ?? "", "http://localhost:3000");
		expect(loginUrl.searchParams.get("locale")).toBe(expected);
		// The signed query is passed on untouched.
		const callbackUrl = new URL(loginUrl.searchParams.get("callbackURL") ?? "", "http://localhost:3000");
		expect(`${callbackUrl.pathname}${callbackUrl.search}`).toBe(`/api/auth/oauth?${query}`);
	});
	it("preserves provider cookies and cache headers on forced reauthentication", async () => {
		const { handleOAuth } = await import("./auth");
		mocks.getSession.mockResolvedValueOnce({ user: { id: "owner" } });
		const headers = new Headers({ "cache-control": "no-store", "content-length": "123" });
		headers.append("set-cookie", "oauth_state=state; Path=/; HttpOnly");
		headers.append("set-cookie", "session=refreshed; Path=/; HttpOnly");
		mocks.continueOAuth.mockResolvedValueOnce(
			Response.json({ redirect: true, url: "/api/auth/oauth?prompt=login&sig=signed" }, { headers }),
		);
		const response = await handleOAuth(new Request("http://localhost:3000/api/auth/oauth?sig=original"));
		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toMatch(/^\/auth\/login\?reauthenticate=true&/);
		expect(response.headers.getSetCookie()).toEqual(headers.getSetCookie());
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("content-type")).toBeNull();
		expect(response.headers.get("content-length")).toBeNull();
	});
});

describe("OAuth provider response validation", () => {
	it.for([{}, { url: "undefined" }, { url: "javascript:alert(1)" }])(
		"fails closed for malformed provider response %j",
		async (body) => {
			const { handleOAuth } = await import("./auth");
			mocks.getSession.mockResolvedValueOnce({ user: { id: "owner" } });
			mocks.continueOAuth.mockResolvedValueOnce(Response.json(body));
			const response = await handleOAuth(new Request("http://localhost:3000/api/auth/oauth?sig=signed"));
			expect(response.status).toBe(502);
			expect(response.headers.get("location")).toBeNull();
			expect(mocks.consent).not.toHaveBeenCalled();
		},
	);
});

describe("account-bound settings writes", () => {
	const request = (path: string, headers: Record<string, string> = {}, method = "POST") =>
		new Request(`http://localhost:3000${path}`, {
			method,
			headers: { "content-type": "application/json", ...headers },
			...(method === "GET"
				? {}
				: {
						body: JSON.stringify(
							path.endsWith("/oauth2/update-client")
								? { client_id: "fixture", update: { client_name: "Fixture" } }
								: {},
						),
					}),
		});

	it("refuses a stale account write before Better Auth runs", async () => {
		const { handleAuth } = await import("./auth");
		mocks.getSession.mockResolvedValueOnce({ user: { id: "bob" } });
		const response = await handleAuth(request("/api/auth/oauth2/update-client", { "x-account-id": "alice" }));
		expect(response.status).toBe(409);
		await expect(response.json()).resolves.toMatchObject({
			message: "This page belongs to a different account now. Reload and try again.",
		});
		expect(mocks.handler).not.toHaveBeenCalled();
	});

	it("allows the same account's settings write", async () => {
		const { handleAuth } = await import("./auth");
		mocks.getSession.mockResolvedValueOnce({ user: { id: "bob" } });
		const response = await handleAuth(request("/api/auth/update-user", { "x-account-id": "bob" }));
		expect(await response.text()).toBe("ok");
		expect(mocks.handler).toHaveBeenCalledOnce();
	});

	it("leaves clients without the optional header unchanged", async () => {
		const { handleAuth } = await import("./auth");
		await handleAuth(request("/api/auth/update-user"));
		expect(mocks.getSession).not.toHaveBeenCalled();
		expect(mocks.handler).toHaveBeenCalledOnce();
	});

	it("does not block explicit sign-out or sign-in intents", async () => {
		const { handleAuth } = await import("./auth");
		mocks.getSession.mockResolvedValue({ user: { id: "bob" } });
		await handleAuth(request("/api/auth/sign-out", { "x-account-id": "alice" }));
		await handleAuth(request("/api/auth/sign-in/email", { "x-account-id": "alice" }));
		expect(mocks.handler).toHaveBeenCalledTimes(2);
	});

	it("does not treat reads as writes", async () => {
		const { handleAuth } = await import("./auth");
		await handleAuth(request("/api/auth/get-session", { "x-account-id": "alice" }, "GET"));
		expect(mocks.getSession).not.toHaveBeenCalled();
		expect(mocks.handler).toHaveBeenCalledOnce();
	});
});

describe("account link storage migration", () => {
	it("sets an account link hook that delegates to migrateUserStorage", async () => {
		await import("./auth");
		const cleanup = vi.fn();
		mocks.migrateUserStorage.mockResolvedValueOnce(cleanup);
		expect(
			await mocks.accountLinkHook?.({
				fromUserId: "guest-old",
				toUserId: "user-new",
				excludedStoragePrefixes: ["uploads/guest-old/pdfs/erased"],
			}),
		).toBe(cleanup);
		expect(cleanup).not.toHaveBeenCalled();
		expect(mocks.migrateUserStorage).toHaveBeenCalledWith("guest-old", "user-new", ["uploads/guest-old/pdfs/erased"]);
	});
});
