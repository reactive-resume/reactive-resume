import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@reactive-resume/email/transport", () => ({ sendEmail: vi.fn() }));

// Run only against an explicitly supplied disposable database, after applying migrations.
const databaseURL = process.env.OAUTH_TEST_DATABASE_URL;
if (databaseURL) process.env.FLAG_ENABLE_GUEST_LOGIN = "true";

describe.skipIf(!databaseURL)("MCP OAuth flow with PostgreSQL", () => {
	it.each(["none", "client_secret_post"])(
		"registers %s clients, resumes login, and exchanges a resource-bound PKCE code",
		async (method) => {
			if (!databaseURL) return;
			process.env.DATABASE_URL = databaseURL;
			process.env.APP_URL = "http://localhost:33920";
			process.env.AUTH_SECRET = "oauth-integration-test-secret-only";
			const { handleAuth, handleOAuth } = await import("./auth");
			// Better Auth disables origin checks by default in test mode; exercise production behavior.
			const { auth } = await import("@reactive-resume/auth/config");
			(await auth.$context).skipOriginCheck = false;
			const origin = process.env.APP_URL;
			const redirectURI = "http://127.0.0.1:33921/callback";
			const request = (path: string, body: object, cookie = "") =>
				new Request(`${origin}/api/auth/${path}`, {
					method: "POST",
					headers: { "content-type": "application/json", origin, cookie },
					body: JSON.stringify(body),
				});
			const registration = await handleAuth(
				request("oauth2/register", {
					client_name: "OAuth integration",
					redirect_uris: [redirectURI],
					token_endpoint_auth_method: method,
				}),
			);
			expect(registration.status, await registration.clone().text()).toBe(201);
			const client = await registration.json();
			expect(client.token_endpoint_auth_method).toBe(method);
			for (const [uri, status] of [
				["http://localhost:8787/callback", 201],
				["https://www.cursor.com/agents/mcp/oauth/callback", 201],
				["cursor://anysphere.cursor-mcp/oauth/callback", 201],
				["com.example.arbitrary:/callback", 201],
				["cursor://anysphere.cursor-mcp", 400],
				["javascript:alert(1)", 400],
				["https://10.0.0.1/callback", 400],
			] as const) {
				const registered = await handleAuth(
					request("oauth2/register", { client_name: "Local callback policy check", redirect_uris: [uri] }),
				);
				expect(registered.status, `${uri}: ${await registered.clone().text()}`).toBe(status);
			}

			const deniedRegistration = await handleAuth(
				request("oauth2/register", {
					client_name: "Denied resource",
					redirect_uris: [redirectURI],
					resources: ["https://untrusted.example/mcp"],
				}),
			);
			expect(deniedRegistration.status).toBe(400);
			await expect(deniedRegistration.json()).resolves.toMatchObject({ error: "invalid_target" });

			const verifier = randomBytes(32).toString("base64url");
			const query = new URLSearchParams({
				client_id: client.client_id,
				redirect_uri: redirectURI,
				response_type: "code",
				scope: "openid profile offline_access",
				code_challenge: createHash("sha256").update(verifier).digest("base64url"),
				code_challenge_method: "S256",
				resource: `${origin}/mcp`,
				state: "opaque-state",
			});
			const authorize = await handleAuth(new Request(`${origin}/api/auth/oauth2/authorize?${query}`));
			expect(authorize.status, await authorize.clone().text()).toBe(302);
			const bridgeURL = authorize.headers.get("location");
			expect(bridgeURL).toBeTruthy();
			const login = await handleOAuth(new Request(new URL(bridgeURL ?? "", origin)));
			const loginURL = new URL(login.headers.get("location") ?? "", origin);
			const callbackURL = loginURL.searchParams.get("callbackURL");
			expect(callbackURL).toContain("sig=");
			expect(callbackURL).toContain("resource=");

			const unique = randomBytes(6).toString("hex");
			const signup = await handleAuth(
				request("sign-up/email", {
					name: "OAuth Test",
					email: `oauth-${unique}@example.com`,
					username: `oauth-${unique}`,
					password: "password123",
				}),
			);
			expect(signup.status, await signup.clone().text()).toBe(200);
			const cookie = signup.headers
				.getSetCookie()
				.map((value) => value.split(";", 1)[0])
				.join("; ");
			const tamperedURL = new URL(`${origin}${callbackURL}`);
			tamperedURL.searchParams.set("state", "tampered");
			const tampered = await handleOAuth(new Request(tamperedURL, { headers: { cookie } }));
			expect(tampered.status).toBe(400);
			await expect(tampered.json()).resolves.toMatchObject({ error: "invalid_signature" });
			const callback = await handleOAuth(new Request(`${origin}${callbackURL}`, { headers: { cookie } }));
			expect(callback.status, await callback.clone().text()).toBe(302);
			const consentURL = new URL(callback.headers.get("location") ?? "", origin);
			expect(consentURL.pathname).toBe("/auth/consent");
			expect(consentURL.searchParams.has("code")).toBe(false);
			const oauth_query = consentURL.search.slice(1);
			const consents = async () => {
				const response = await handleAuth(
					new Request(`${origin}/api/auth/oauth2/get-consents`, { headers: { cookie } }),
				);
				expect(response.status).toBe(200);
				return response.json();
			};
			expect(await consents()).toEqual([]);
			const silent = await handleAuth(
				new Request(`${origin}/api/auth/oauth2/authorize?${query}&prompt=none`, { headers: { cookie } }),
			);
			expect(new URL(silent.headers.get("location") ?? "").searchParams.get("error")).toBe("consent_required");
			const tamperedConsentQuery = new URLSearchParams(oauth_query);
			tamperedConsentQuery.set("scope", "openid profile email offline_access");
			const tamperedConsent = await handleAuth(
				request(
					"oauth2/consent",
					{
						accept: true,
						oauth_query: tamperedConsentQuery.toString(),
					},
					cookie,
				),
			);
			expect(tamperedConsent.status).toBe(400);
			expect(await consents()).toEqual([]);
			const csrf = await handleAuth(
				new Request(`${origin}/api/auth/oauth2/consent`, {
					method: "POST",
					headers: { cookie, origin: "https://untrusted.example", "content-type": "application/json" },
					body: JSON.stringify({ accept: true, oauth_query }),
				}),
			);
			expect(csrf.status).toBe(403);
			const denied = await handleAuth(request("oauth2/consent", { accept: false, oauth_query }, cookie));
			expect(denied.status, await denied.clone().text()).toBe(200);
			const deniedURL = new URL((await denied.json()).url);
			expect(deniedURL.searchParams.get("error")).toBe("access_denied");
			expect(deniedURL.searchParams.get("state")).toBe("opaque-state");
			expect(deniedURL.searchParams.has("code")).toBe(false);
			expect(await consents()).toEqual([]);
			const accepted = await handleAuth(request("oauth2/consent", { accept: true, oauth_query }, cookie));
			expect(accepted.status, await accepted.clone().text()).toBe(200);
			expect(await consents()).toHaveLength(1);
			const codeURL = new URL((await accepted.json()).url);
			expect(codeURL.origin).toBe(new URL(redirectURI).origin);
			expect(codeURL.searchParams.get("state")).toBe("opaque-state");
			const code = codeURL.searchParams.get("code");
			expect(code).toBeTruthy();
			const tokenRequest = () =>
				new Request(`${origin}/api/auth/oauth2/token`, {
					method: "POST",
					headers: { "content-type": "application/x-www-form-urlencoded" },
					body: new URLSearchParams({
						grant_type: "authorization_code",
						client_id: client.client_id,
						...(client.client_secret ? { client_secret: client.client_secret } : {}),
						code: code ?? "",
						redirect_uri: redirectURI,
						code_verifier: verifier,
						resource: `${origin}/mcp`,
					}),
				});
			const tokenResponse = await handleAuth(tokenRequest());
			expect(tokenResponse.status, await tokenResponse.clone().text()).toBe(200);
			const token = await tokenResponse.json();
			expect(token.access_token).toBeTruthy();
			expect(token.refresh_token).toBeTruthy();
			const claims = JSON.parse(Buffer.from(token.access_token.split(".")[1], "base64url").toString());
			expect([claims.aud].flat()).toContain(`${origin}/mcp`);
			expect((await handleAuth(tokenRequest())).status).toBe(400);
			const userinfo = () =>
				handleAuth(
					new Request(`${origin}/api/auth/oauth2/userinfo`, {
						headers: { authorization: `Bearer ${token.access_token}` },
					}),
				);
			expect((await userinfo()).status).toBe(200);
			const introspect = () =>
				handleAuth(
					new Request(`${origin}/api/auth/oauth2/introspect`, {
						method: "POST",
						headers: { "content-type": "application/x-www-form-urlencoded" },
						body: new URLSearchParams({
							token: token.access_token,
							client_id: client.client_id,
							client_secret: client.client_secret ?? "",
						}),
					}),
				);
			if (client.client_secret) {
				const active = await introspect();
				expect(active.status).toBe(200);
				await expect(active.json()).resolves.toMatchObject({ active: true });
			}
			const [consent] = await consents();
			const disconnected = await handleAuth(request("oauth2/delete-consent", { id: consent.id }, cookie));
			expect(disconnected.status).toBe(200);
			if (client.client_secret) {
				const inactive = await introspect();
				expect.soft(await inactive.json()).toEqual({ active: false });
			}
			expect.soft((await userinfo()).status).toBe(401);
			const refreshed = await handleAuth(
				new Request(`${origin}/api/auth/oauth2/token`, {
					method: "POST",
					headers: { "content-type": "application/x-www-form-urlencoded" },
					body: new URLSearchParams({
						grant_type: "refresh_token",
						refresh_token: token.refresh_token,
						client_id: client.client_id,
						...(client.client_secret ? { client_secret: client.client_secret } : {}),
						resource: `${origin}/mcp`,
					}),
				}),
			);
			expect(refreshed.status).toBe(400);
		},
		30_000,
	);
	it("refuses authorization without a resource, reporting to the registered callback only", async () => {
		if (!databaseURL) return;
		process.env.DATABASE_URL = databaseURL;
		process.env.APP_URL = "http://localhost:33920";
		process.env.AUTH_SECRET = "oauth-integration-test-secret-only";
		const { handleAuth } = await import("./auth");
		const { db } = await import("@reactive-resume/db/client");
		const schema = await import("@reactive-resume/db/schema");
		const { eq } = await import("drizzle-orm");
		const origin = process.env.APP_URL;
		const redirectURI = "http://127.0.0.1:33921/callback";
		const register = async () =>
			(
				await handleAuth(
					new Request(`${origin}/api/auth/oauth2/register`, {
						method: "POST",
						headers: { "content-type": "application/json", origin },
						body: JSON.stringify({ client_name: "Resource check", redirect_uris: [redirectURI] }),
					}),
				)
			).json();
		const client = await register();
		const disabled = await register();
		await db
			.update(schema.oauthClient)
			.set({ disabled: true })
			.where(eq(schema.oauthClient.clientId, disabled.client_id));
		const params = (overrides: Record<string, string> = {}) =>
			new URLSearchParams({
				client_id: client.client_id,
				redirect_uri: redirectURI,
				response_type: "code",
				scope: "openid offline_access api:read",
				code_challenge: createHash("sha256").update(randomBytes(32)).digest("base64url"),
				code_challenge_method: "S256",
				state: "resource-state",
				...overrides,
			});
		const authorize = (query: URLSearchParams) =>
			handleAuth(new Request(`${origin}/api/auth/oauth2/authorize?${query}`));
		const authorizeByForm = (query: URLSearchParams) =>
			handleAuth(
				new Request(`${origin}/api/auth/oauth2/authorize`, {
					method: "POST",
					headers: { "content-type": "application/x-www-form-urlencoded" },
					body: query,
				}),
			);

		// The provider's own error redirect supplies the issuer the refusal must repeat.
		const providerError = await authorize(params({ resource: origin, prompt: "none" }));
		const issuer = new URL(providerError.headers.get("location") ?? "").searchParams.get("iss");
		expect(issuer).toBeTruthy();

		for (const missing of [await authorize(params()), await authorizeByForm(params())]) {
			expect(missing.status, await missing.clone().text()).toBe(302);
			const location = new URL(missing.headers.get("location") ?? "");
			expect(`${location.origin}${location.pathname}`).toBe(redirectURI);
			expect(location.searchParams.get("error")).toBe("invalid_target");
			expect(location.searchParams.get("error_description")).toContain(`resource=${origin}`);
			expect(location.searchParams.get("state")).toBe("resource-state");
			expect(location.searchParams.get("iss")).toBe(issuer);
			expect(location.searchParams.has("code")).toBe(false);
		}
		expect((await authorize(params({ resource: "" }))).headers.get("location")).toContain("error=invalid_target");

		// A callback the client never registered, even one extending a registered callback, an unknown client
		// and a disabled client must not receive a redirect.
		for (const untrusted of [
			params({ redirect_uri: "https://attacker.example/callback" }),
			params({ redirect_uri: `${redirectURI}.attacker.example` }),
			params({ redirect_uri: `${redirectURI}/../attacker` }),
			params({ client_id: "unknown-client" }),
			params({ client_id: disabled.client_id }),
		]) {
			const refused = await authorize(untrusted);
			expect(refused.status).toBe(400);
			expect(refused.headers.get("location")).toBeNull();
			await expect(refused.json()).resolves.toMatchObject({ error: "invalid_target" });
		}

		// A form-encoded request carrying resource proceeds to sign-in like the query form.
		const accepted = await authorizeByForm(params({ resource: origin }));
		expect(accepted.status, await accepted.clone().text()).toBe(302);
		expect(new URL(accepted.headers.get("location") ?? "", origin).pathname).toBe("/api/auth/oauth");
	});

	it("registers desktop clients' payloads and binds codes to their exact callbacks", async () => {
		if (!databaseURL) return;
		process.env.DATABASE_URL = databaseURL;
		process.env.APP_URL = "http://localhost:33920";
		process.env.AUTH_SECRET = "oauth-integration-test-secret-only";
		const { handleAuth, handleOAuth } = await import("./auth");
		const { verifyOAuthToken } = await import("@reactive-resume/auth/config");
		const origin = process.env.APP_URL;
		const post = (path: string, body: object, cookie = "") =>
			handleAuth(
				new Request(`${origin}/api/auth/${path}`, {
					method: "POST",
					headers: { "content-type": "application/json", origin, cookie },
					body: JSON.stringify(body),
				}),
			);
		const token = (body: Record<string, string>) =>
			handleAuth(
				new Request(`${origin}/api/auth/oauth2/token`, {
					method: "POST",
					headers: { "content-type": "application/x-www-form-urlencoded" },
					body: new URLSearchParams(body),
				}),
			);
		const cursorCallback = "cursor://anysphere.cursor-mcp/oauth/callback";
		// Cursor 3.14 sends three callbacks and no application_type (Cursor forum, "Cursor MCP DCR still omits
		// application_type", August 2026).
		const cursor = await post("oauth2/register", {
			client_name: "Cursor",
			redirect_uris: [
				cursorCallback,
				"https://www.cursor.com/agents/mcp/oauth/callback",
				"http://localhost:8787/callback",
			],
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			token_endpoint_auth_method: "none",
		});
		expect(cursor.status, await cursor.clone().text()).toBe(201);
		const cursorClient = await cursor.json();
		// VS Code's fetchDynamicRegistration (microsoft/vscode src/vs/base/common/oauth.ts).
		const metadata = await (
			await handleAuth(new Request(`${origin}/api/auth/.well-known/oauth-authorization-server`))
		).json();
		const vscodeRedirects = [
			"https://insiders.vscode.dev/redirect",
			"https://vscode.dev/redirect",
			"http://127.0.0.1/",
			"http://127.0.0.1:33418/",
		];
		const vscode = await post("oauth2/register", {
			client_name: "Visual Studio Code",
			client_uri: "https://code.visualstudio.com",
			grant_types: ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:device_code"].filter(
				(grant) => metadata.grant_types_supported.includes(grant),
			),
			response_types: ["code"],
			redirect_uris: vscodeRedirects,
			token_endpoint_auth_method: "none",
			application_type: "native",
		});
		expect(vscode.status, await vscode.clone().text()).toBe(201);
		const vscodeClient = await vscode.json();
		// Some clients send the same mixed set without application_type.
		const untyped = await post("oauth2/register", {
			client_name: "Untyped desktop client",
			redirect_uris: ["http://127.0.0.1:33418", "https://vscode.dev/redirect"],
		});
		expect(untyped.status, await untyped.clone().text()).toBe(201);

		for (const [label, body] of [
			["explicit web type", { redirect_uris: [cursorCallback], application_type: "web" }],
			["bare custom authority", { redirect_uris: ["cursor://anysphere.cursor-mcp"] }],
			["script scheme beside a valid one", { redirect_uris: [cursorCallback, "javascript:alert(1)"] }],
			["file scheme", { redirect_uris: ["file:///tmp/callback"] }],
			["non-loopback http beside a native one", { redirect_uris: [cursorCallback, "http://evil.example/callback"] }],
			["https loopback for a native client", { redirect_uris: [cursorCallback, "https://localhost/callback"] }],
			["private https host", { redirect_uris: ["https://192.168.1.10/callback"] }],
			["credentials", { redirect_uris: ["cursor://user:pass@anysphere.cursor-mcp/oauth/callback"] }],
		] as const) {
			const refused = await post("oauth2/register", { client_name: "Refused", ...body });
			expect(refused.status, `${label}: ${await refused.clone().text()}`).toBe(400);
		}

		const unique = randomBytes(6).toString("hex");
		const signup = await post("sign-up/email", {
			name: "Desktop Test",
			email: `desktop-${unique}@example.com`,
			username: `desktop-${unique}`,
			password: "password123",
		});
		expect(signup.status).toBe(200);
		const cookie = signup.headers
			.getSetCookie()
			.map((value) => value.split(";", 1)[0])
			.join("; ");

		/** Runs authorize as the signed-in user; consent is granted the first time a client asks. */
		const issueCode = async (clientId: string, redirectURI: string, verifier: string, state: string) => {
			const query = new URLSearchParams({
				client_id: clientId,
				redirect_uri: redirectURI,
				response_type: "code",
				scope: "openid offline_access api:read",
				code_challenge: createHash("sha256").update(verifier).digest("base64url"),
				code_challenge_method: "S256",
				resource: origin,
				state,
			});
			let response = await handleAuth(
				new Request(`${origin}/api/auth/oauth2/authorize?${query}`, { headers: { cookie } }),
			);
			let target = new URL(response.headers.get("location") ?? "", origin);
			if (target.pathname === "/api/auth/oauth") {
				response = await handleOAuth(new Request(target, { headers: { cookie } }));
				target = new URL(response.headers.get("location") ?? "", origin);
			}
			if (target.pathname === "/auth/consent") {
				const accepted = await post("oauth2/consent", { accept: true, oauth_query: target.search.slice(1) }, cookie);
				expect(accepted.status, await accepted.clone().text()).toBe(200);
				target = new URL((await accepted.json()).url);
			}
			expect(target.href.startsWith(`${redirectURI}?`), target.href).toBe(true);
			expect(target.searchParams.get("state")).toBe(state);
			expect(target.searchParams.get("iss")).toBeTruthy();
			return target.searchParams.get("code") ?? "";
		};
		const verifier = () => randomBytes(32).toString("base64url");
		const exchange = (clientId: string, code: string, redirectURI: string, codeVerifier: string) =>
			token({
				grant_type: "authorization_code",
				client_id: clientId,
				code,
				redirect_uri: redirectURI,
				code_verifier: codeVerifier,
				resource: origin,
			});

		const cursorVerifier = verifier();
		const cursorCode = await issueCode(cursorClient.client_id, cursorCallback, cursorVerifier, "cursor-state");
		const issued = await exchange(cursorClient.client_id, cursorCode, cursorCallback, cursorVerifier);
		expect(issued.status, await issued.clone().text()).toBe(200);
		const cursorTokens = await issued.json();
		const claims = await verifyOAuthToken(cursorTokens.access_token);
		expect(claims.azp).toBe(cursorClient.client_id);
		expect([claims.aud].flat()).toContain(origin);
		const refreshed = await token({
			grant_type: "refresh_token",
			client_id: cursorClient.client_id,
			refresh_token: cursorTokens.refresh_token,
			resource: origin,
		});
		expect(refreshed.status, await refreshed.clone().text()).toBe(200);

		// Each refused exchange spends its own code, so none is refused only because an earlier attempt consumed it.
		for (const [label, attempt] of [
			[
				"another registered callback",
				(code: string, codeVerifier: string) =>
					exchange(cursorClient.client_id, code, "https://www.cursor.com/agents/mcp/oauth/callback", codeVerifier),
			],
			["a wrong verifier", (code: string) => exchange(cursorClient.client_id, code, cursorCallback, verifier())],
			[
				"another client",
				(code: string, codeVerifier: string) => exchange(vscodeClient.client_id, code, cursorCallback, codeVerifier),
			],
		] as const) {
			const codeVerifier = verifier();
			const code = await issueCode(cursorClient.client_id, cursorCallback, codeVerifier, "cursor-state");
			const refused = await attempt(code, codeVerifier);
			expect(refused.status, label).toBe(400);
			await expect(refused.json()).resolves.toMatchObject({ error: "invalid_grant" });
		}

		// An unregistered path on the same scheme never receives a code or an error redirect.
		const wrongCallback = await handleAuth(
			new Request(
				`${origin}/api/auth/oauth2/authorize?${new URLSearchParams({
					client_id: cursorClient.client_id,
					redirect_uri: "cursor://anysphere.cursor-mcp/oauth/other",
					response_type: "code",
					code_challenge: createHash("sha256").update(verifier()).digest("base64url"),
					code_challenge_method: "S256",
					resource: origin,
				})}`,
				{ headers: { cookie } },
			),
		);
		expect(wrongCallback.headers.get("location")?.startsWith("cursor:")).toBe(false);

		// VS Code listens on a free loopback port; only the port may differ from the registration.
		const loopback = "http://127.0.0.1:50123/";
		const vscodeVerifier = verifier();
		const vscodeCode = await issueCode(vscodeClient.client_id, loopback, vscodeVerifier, "vscode-state");
		const vscodeTokens = await exchange(vscodeClient.client_id, vscodeCode, loopback, vscodeVerifier);
		expect(vscodeTokens.status, await vscodeTokens.clone().text()).toBe(200);
		expect((await verifyOAuthToken((await vscodeTokens.json()).access_token)).azp).toBe(vscodeClient.client_id);
	}, 30_000);

	it("keeps guest accounts from granting, reusing or redeeming access", async () => {
		if (!databaseURL) return;
		process.env.DATABASE_URL = databaseURL;
		process.env.APP_URL = "http://localhost:33920";
		process.env.AUTH_SECRET = "oauth-integration-test-secret-only";
		const { handleAuth, handleOAuth } = await import("./auth");
		const { db } = await import("@reactive-resume/db/client");
		const schema = await import("@reactive-resume/db/schema");
		const { eq } = await import("drizzle-orm");
		const origin = process.env.APP_URL;
		const redirectURI = "http://127.0.0.1:33921/callback";
		const post = (path: string, body: object, cookie = "") =>
			handleAuth(
				new Request(`${origin}/api/auth/${path}`, {
					method: "POST",
					headers: { "content-type": "application/json", origin, cookie },
					body: JSON.stringify(body),
				}),
			);
		const cookieOf = (response: Response) =>
			response.headers
				.getSetCookie()
				.map((value) => value.split(";", 1)[0])
				.join("; ");
		const registration = await post("oauth2/register", { client_name: "Guest boundary", redirect_uris: [redirectURI] });
		const client = await registration.json();
		const verifier = randomBytes(32).toString("base64url");
		const query = new URLSearchParams({
			client_id: client.client_id,
			redirect_uri: redirectURI,
			response_type: "code",
			scope: "openid offline_access api:read",
			code_challenge: createHash("sha256").update(verifier).digest("base64url"),
			code_challenge_method: "S256",
			resource: origin,
			state: "guest-state",
		});
		const authorize = async (cookie: string) => {
			const response = await handleAuth(
				new Request(`${origin}/api/auth/oauth2/authorize?${query}`, { headers: { cookie } }),
			);
			expect(response.status).toBe(302);
			let target = new URL(response.headers.get("location") ?? "", origin);
			if (target.pathname === "/api/auth/oauth") {
				const bridge = await handleOAuth(new Request(target, { headers: { cookie } }));
				target = new URL(bridge.headers.get("location") ?? "", origin);
			}
			return target;
		};
		const grants = async (userId: string) => {
			const rows = [];
			for (const table of [schema.oauthConsent, schema.oauthAccessToken, schema.oauthRefreshToken]) {
				rows.push(...(await db.select().from(table).where(eq(table.userId, userId))));
			}
			return rows;
		};

		const guest = await post("sign-in/anonymous", {});
		expect(guest.status).toBe(200);
		const guestUser = (await guest.json()).user;
		const guestCookie = cookieOf(guest);
		const consentPage = await authorize(guestCookie);
		expect(consentPage.pathname).toBe("/auth/consent");
		const oauth_query = consentPage.search.slice(1);
		expect((await post("oauth2/consent", { accept: true, oauth_query }, guestCookie)).status).toBe(403);
		const declined = await post("oauth2/consent", { accept: false, oauth_query }, guestCookie);
		expect(declined.status, await declined.clone().text()).toBe(200);
		const declinedURL = new URL((await declined.json()).url);
		expect(declinedURL.searchParams.get("error")).toBe("access_denied");
		expect(declinedURL.searchParams.get("state")).toBe("guest-state");
		expect(declinedURL.searchParams.has("code")).toBe(false);
		expect(await grants(guestUser.id)).toEqual([]);

		// A grant left over from before guests were refused must not let the provider skip consent.
		await db.insert(schema.oauthConsent).values({
			clientId: client.client_id,
			userId: guestUser.id,
			scopes: ["openid", "offline_access", "api:read"],
			resources: [origin],
		});
		const reused = await authorize(guestCookie);
		expect(reused.pathname).toBe("/auth/consent");
		expect(reused.searchParams.has("code")).toBe(false);
		await db.delete(schema.oauthConsent).where(eq(schema.oauthConsent.userId, guestUser.id));

		// A code issued before the account became a guest one must not be redeemed.
		const unique = randomBytes(6).toString("hex");
		const signup = await post("sign-up/email", {
			name: "Converted Test",
			email: `converted-${unique}@example.com`,
			username: `converted-${unique}`,
			password: "password123",
		});
		const user = (await signup.json()).user;
		const userCookie = cookieOf(signup);
		const userConsent = await authorize(userCookie);
		expect(userConsent.pathname).toBe("/auth/consent");
		const accepted = await post(
			"oauth2/consent",
			{ accept: true, oauth_query: userConsent.search.slice(1) },
			userCookie,
		);
		const code = new URL((await accepted.json()).url).searchParams.get("code") ?? "";
		expect(code).toBeTruthy();
		await db.update(schema.user).set({ isAnonymous: true }).where(eq(schema.user.id, user.id));
		const redeemed = await handleAuth(
			new Request(`${origin}/api/auth/oauth2/token`, {
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					grant_type: "authorization_code",
					client_id: client.client_id,
					code,
					redirect_uri: redirectURI,
					code_verifier: verifier,
					resource: origin,
				}),
			}),
		);
		expect(redeemed.status, await redeemed.clone().text()).toBe(403);
		const tokens = [
			...(await db.select().from(schema.oauthAccessToken).where(eq(schema.oauthAccessToken.userId, user.id))),
			...(await db.select().from(schema.oauthRefreshToken).where(eq(schema.oauthRefreshToken.userId, user.id))),
		];
		expect(tokens).toEqual([]);
	}, 30_000);

	it("refuses UserInfo for a token without offline_access once its session ends", async () => {
		if (!databaseURL) return;
		process.env.DATABASE_URL = databaseURL;
		process.env.APP_URL = "http://localhost:33920";
		process.env.AUTH_SECRET = "oauth-integration-test-secret-only";
		const { handleAuth, handleOAuth } = await import("./auth");
		const { db } = await import("@reactive-resume/db/client");
		const schema = await import("@reactive-resume/db/schema");
		const { eq } = await import("drizzle-orm");
		const origin = process.env.APP_URL;
		const redirectURI = "http://127.0.0.1:33921/callback";
		const post = (path: string, body: object, cookie = "") =>
			handleAuth(
				new Request(`${origin}/api/auth/${path}`, {
					method: "POST",
					headers: { "content-type": "application/json", origin, cookie },
					body: JSON.stringify(body),
				}),
			);
		const client = await (
			await post("oauth2/register", { client_name: "Session-bound", redirect_uris: [redirectURI] })
		).json();
		const unique = randomBytes(6).toString("hex");
		const signup = await post("sign-up/email", {
			name: "Session Test",
			email: `session-${unique}@example.com`,
			username: `session-${unique}`,
			password: "password123",
		});
		const user = (await signup.json()).user;
		const cookie = signup.headers
			.getSetCookie()
			.map((value) => value.split(";", 1)[0])
			.join("; ");
		const verifier = randomBytes(32).toString("base64url");
		const query = new URLSearchParams({
			client_id: client.client_id,
			redirect_uri: redirectURI,
			response_type: "code",
			scope: "openid api:read",
			code_challenge: createHash("sha256").update(verifier).digest("base64url"),
			code_challenge_method: "S256",
			resource: origin,
		});
		let target = new URL(
			(
				await handleAuth(new Request(`${origin}/api/auth/oauth2/authorize?${query}`, { headers: { cookie } }))
			).headers.get("location") ?? "",
			origin,
		);
		if (target.pathname === "/api/auth/oauth") {
			target = new URL(
				(await handleOAuth(new Request(target, { headers: { cookie } }))).headers.get("location") ?? "",
				origin,
			);
		}
		const accepted = await post("oauth2/consent", { accept: true, oauth_query: target.search.slice(1) }, cookie);
		const code = new URL((await accepted.json()).url).searchParams.get("code") ?? "";
		const tokens = await (
			await handleAuth(
				new Request(`${origin}/api/auth/oauth2/token`, {
					method: "POST",
					headers: { "content-type": "application/x-www-form-urlencoded" },
					body: new URLSearchParams({
						grant_type: "authorization_code",
						client_id: client.client_id,
						code,
						redirect_uri: redirectURI,
						code_verifier: verifier,
						resource: origin,
					}),
				}),
			)
		).json();
		const userinfo = () =>
			handleAuth(
				new Request(`${origin}/api/auth/oauth2/userinfo`, {
					headers: { authorization: `Bearer ${tokens.access_token}` },
				}),
			);
		expect((await userinfo()).status).toBe(200);
		expect((await post("sign-out", {}, cookie)).status).toBe(200);
		// The grant stays, so the ended session is the only reason to refuse.
		expect(await db.select().from(schema.oauthConsent).where(eq(schema.oauthConsent.userId, user.id))).toHaveLength(1);
		const refused = await userinfo();
		expect(refused.status).toBe(401);
		await expect(refused.json()).resolves.toMatchObject({ error: "invalid_token" });
	}, 30_000);

	it.each(["login", "max-age", "create"])(
		"requires fresh authentication for %s without looping",
		async (mode) => {
			if (!databaseURL) return;
			process.env.DATABASE_URL = databaseURL;
			process.env.APP_URL = "http://localhost:33920";
			process.env.AUTH_SECRET = "oauth-integration-test-secret-only";
			const { handleAuth, handleOAuth } = await import("./auth");
			const origin = process.env.APP_URL;
			const cookieOf = (response: Response) =>
				response.headers
					.getSetCookie()
					.map((value) => value.split(";", 1)[0])
					.join("; ");
			const post = (path: string, body: object, cookie = "") =>
				handleAuth(
					new Request(`${origin}/api/auth/${path}`, {
						method: "POST",
						headers: { "content-type": "application/json", origin, cookie },
						body: JSON.stringify(body),
					}),
				);
			const unique = randomBytes(6).toString("hex");
			const credentials = {
				name: "Reauth Test",
				email: `reauth-${unique}@example.com`,
				username: `reauth-${unique}`,
				password: "password123",
			};
			const existingSignup = await post("sign-up/email", credentials);
			expect(existingSignup.status).toBe(200);
			const oldCookie = cookieOf(existingSignup);
			const registration = await post("oauth2/register", {
				client_name: "Reauth integration",
				redirect_uris: ["http://127.0.0.1:33921/callback"],
			});
			expect(registration.status).toBe(201);
			const client = await registration.json();
			const query = new URLSearchParams({
				client_id: client.client_id,
				redirect_uri: "http://127.0.0.1:33921/callback",
				response_type: "code",
				scope: "openid profile",
				resource: `${origin}/mcp`,
				code_challenge: createHash("sha256").update(randomBytes(32)).digest("base64url"),
				code_challenge_method: "S256",
				...(mode === "max-age" ? { max_age: "0" } : { prompt: mode }),
			});
			const authorization = await handleAuth(
				new Request(`${origin}/api/auth/oauth2/authorize?${query}`, { headers: { cookie: oldCookie } }),
			);
			expect(authorization.status).toBe(302);
			const bridge = await handleOAuth(
				new Request(new URL(authorization.headers.get("location") ?? "", origin), { headers: { cookie: oldCookie } }),
			);
			expect(bridge.status).toBe(302);
			const loginURL = new URL(bridge.headers.get("location") ?? "", origin);
			expect(loginURL.pathname).toBe(mode === "create" ? "/auth/register" : "/auth/login");
			expect(loginURL.searchParams.get("reauthenticate")).toBe("true");
			const callbackURL = new URL(loginURL.searchParams.get("callbackURL") ?? "", origin);
			const oauth_query = callbackURL.search.slice(1);
			const authenticated =
				mode === "create"
					? await post(
							"sign-up/email",
							{ ...credentials, email: `new-${unique}@example.com`, username: `new-${unique}` },
							oldCookie,
						)
					: await post(
							"sign-in/email",
							{ email: credentials.email, password: credentials.password, oauth_query },
							oldCookie,
						);
			expect(authenticated.status, await authenticated.clone().text()).toBe(200);
			const newCookie = cookieOf(authenticated);
			expect(newCookie).not.toBe(oldCookie);
			const continuation =
				mode === "create" ? await post("oauth2/continue", { created: true, oauth_query }, newCookie) : authenticated;
			expect(continuation.status, await continuation.clone().text()).toBe(200);
			const result = await continuation.json();
			let target = new URL(result.url, origin);
			if (target.pathname === "/api/auth/oauth") {
				const response = await handleOAuth(new Request(target, { headers: { cookie: newCookie } }));
				expect(response.status, await response.clone().text()).toBe(302);
				target = new URL(response.headers.get("location") ?? "", origin);
			}
			expect(target.pathname).toBe("/auth/consent");
			const accepted = await post("oauth2/consent", { accept: true, oauth_query: target.search.slice(1) }, newCookie);
			expect(accepted.status, await accepted.clone().text()).toBe(200);
			target = new URL((await accepted.json()).url, origin);
			expect(target.origin).toBe("http://127.0.0.1:33921");
			expect(target.searchParams.get("code")).toBeTruthy();
		},
		30_000,
	);
});
