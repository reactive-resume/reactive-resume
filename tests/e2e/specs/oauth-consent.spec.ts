import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "../fixtures/test";

test("requires explicit OAuth consent before denying or allowing access", async ({ authPage: page, baseURL }) => {
	const origin = new URL(baseURL ?? "http://localhost:3000").origin;
	const metadata = await page.request.get("/.well-known/oauth-protected-resource");
	expect(metadata.status()).toBe(200);
	const advertisedResource = (await metadata.json()).resource;
	expect(advertisedResource).toBe(origin);
	const resource = `${origin}/mcp`;
	const callback = "http://127.0.0.1:33921/callback";
	const registration = await page.request.post("/api/auth/oauth2/register", {
		headers: { origin },
		data: { client_name: "Consent test client", redirect_uris: [callback] },
	});
	expect(registration.status(), await registration.text()).toBe(201);
	const client = await registration.json();
	const verifier = randomBytes(32).toString("base64url");
	const query = new URLSearchParams({
		client_id: client.client_id,
		redirect_uri: callback,
		response_type: "code",
		scope: "openid profile offline_access",
		code_challenge: createHash("sha256").update(verifier).digest("base64url"),
		code_challenge_method: "S256",
		resource,
		state: "browser-consent-state",
	});
	query.append("resource", origin);
	await page.route(`${callback}**`, (route) => route.fulfill({ body: "Client callback" }));
	for (const accept of [false, true]) {
		await page.goto(`/api/auth/oauth2/authorize?${query}`);
		await expect(page.getByRole("heading", { name: "Connect an application" })).toBeVisible();
		await expect(page.getByText("Consent test client", { exact: true })).toBeVisible();
		await expect(
			page
				.getByRole("listitem")
				.filter({ hasText: /reading, changing and deleting your documents and job applications/ }),
		).toBeVisible();
		await expect(page.getByRole("button", { name: "Allow access", exact: true })).toBeEnabled();
		const before = await page.request.get("/api/auth/oauth2/get-consents");
		expect(await before.json()).toEqual([]);
		expect(new URL(page.url()).searchParams.getAll("resource")).toEqual([`${origin}/mcp`, origin]);
		await page.getByRole("button", { name: accept ? "Allow access" : "Deny access", exact: true }).click();
		await page.waitForURL(`${callback}**`);
		const target = new URL(page.url());
		expect(target.searchParams.get("state")).toBe("browser-consent-state");
		if (!accept) {
			expect(target.searchParams.get("error")).toBe("access_denied");
			expect(target.searchParams.has("code")).toBe(false);
			const after = await page.request.get(`${origin}/api/auth/oauth2/get-consents`);
			expect(await after.json()).toEqual([]);
			continue;
		}
		expect(target.searchParams.get("code")).toBeTruthy();
		const token = await page.request.post(`${origin}/api/auth/oauth2/token`, {
			headers: { origin },
			form: {
				grant_type: "authorization_code",
				client_id: client.client_id,
				code: target.searchParams.get("code") ?? "",
				redirect_uri: callback,
				code_verifier: verifier,
				resource,
			},
		});
		expect(token.status(), await token.text()).toBe(200);
		const tokenSet = await token.json();
		const accessToken = tokenSet.access_token;
		expect(accessToken).toBeTruthy();
		const initializePayload = {
			jsonrpc: "2.0",
			id: "oauth-audience-check",
			method: "initialize",
			params: {
				protocolVersion: "2025-11-25",
				capabilities: {},
				clientInfo: { name: "OAuth test", version: "1.0.0" },
			},
		};
		const initialize = await page.request.post(`${origin}/mcp`, {
			headers: { authorization: `Bearer ${accessToken}`, accept: "application/json, text/event-stream" },
			data: initializePayload,
		});
		expect(initialize.status(), await initialize.text()).toBe(200);
		expect(await initialize.json()).toHaveProperty("result.serverInfo");
		expect(tokenSet.id_token).toBeTruthy();
		const wrongAudience = await page.request.post(`${origin}/mcp`, {
			headers: { authorization: `Bearer ${tokenSet.id_token}`, accept: "application/json, text/event-stream" },
			data: initializePayload,
		});
		expect(wrongAudience.status()).toBe(401);
	}
});

test("names an app callback's scheme, not just its host, before consent", async ({ authPage: page, baseURL }) => {
	const origin = new URL(baseURL ?? "http://localhost:3000").origin;
	for (const [callback, destination] of [
		["https://www.cursor.com/agents/mcp/oauth/callback", "www.cursor.com"],
		// An app scheme spelled like a website must not read as that website.
		["www.cursor.com:/oauth/callback", "www.cursor.com:"],
		["com.example.app:/oauth/callback", "com.example.app:"],
		["cursor://anysphere.cursor-mcp/oauth/callback", "cursor://anysphere.cursor-mcp"],
		["evilapp://www.cursor.com/oauth/callback", "evilapp://www.cursor.com"],
	]) {
		const registration = await page.request.post("/api/auth/oauth2/register", {
			headers: { origin },
			data: { client_name: "Cursor", redirect_uris: [callback] },
		});
		expect(registration.status(), await registration.text()).toBe(201);
		const query = new URLSearchParams({
			client_id: (await registration.json()).client_id,
			redirect_uri: callback,
			response_type: "code",
			scope: "openid api:read",
			code_challenge: createHash("sha256").update(randomBytes(32)).digest("base64url"),
			code_challenge_method: "S256",
			resource: origin,
		});
		await page.goto(`/api/auth/oauth2/authorize?${query}`);
		await expect(page.getByText(destination, { exact: true })).toBeVisible();
	}
});

test("confirms a named disconnect and revokes every token without widening read-only access", async ({
	authPage: page,
	baseURL,
}, testInfo) => {
	const origin = new URL(baseURL ?? "http://localhost:3000").origin;
	await page.emulateMedia({ reducedMotion: "reduce" });
	const redirect = "http://127.0.0.1:33921/callback";
	const registration = await page.request.post("/api/auth/oauth2/register", {
		headers: { origin },
		data: { client_name: "Example desktop assistant", redirect_uris: [redirect] },
	});
	expect(registration.status()).toBe(201);
	const client = await registration.json();
	const verifier = randomBytes(32).toString("base64url");
	const query = new URLSearchParams({
		client_id: client.client_id,
		redirect_uri: redirect,
		response_type: "code",
		scope: "openid profile email offline_access api:read",
		code_challenge: createHash("sha256").update(verifier).digest("base64url"),
		code_challenge_method: "S256",
		state: "rx108-read-only",
		resource: origin,
	});
	await page.route(`${redirect}**`, (route) => route.fulfill({ body: "Local mock client callback" }));
	await page.goto(`/api/auth/oauth2/authorize?${query}`);
	await page.getByRole("button", { name: "Allow access", exact: true }).click();
	await page.waitForURL(`${redirect}**`);
	const target = new URL(page.url());
	expect(target.searchParams.get("state")).toBe("rx108-read-only");
	expect(target.searchParams.get("iss")).toBe(`${origin}/api/auth`);
	const tokenResponse = await page.request.post(`${origin}/api/auth/oauth2/token`, {
		headers: { origin },
		form: {
			grant_type: "authorization_code",
			client_id: client.client_id,
			code: target.searchParams.get("code") ?? "",
			redirect_uri: redirect,
			code_verifier: verifier,
			resource: origin,
		},
	});
	expect(tokenResponse.status(), await tokenResponse.text()).toBe(200);
	const tokens = await tokenResponse.json();
	const authorization = `Bearer ${tokens.access_token}`;
	// A desktop client carries no browser session cookie.
	const headers = { authorization, cookie: "" };
	const mcp = () =>
		page.request.post(`${origin}/mcp`, {
			headers: { ...headers, accept: "application/json, text/event-stream" },
			data: {
				jsonrpc: "2.0",
				id: "rx108",
				method: "initialize",
				params: {
					protocolVersion: "2025-11-25",
					capabilities: {},
					clientInfo: { name: "RX108 local mock", version: "1" },
				},
			},
		});
	expect((await page.request.get(`${origin}/api/openapi/resumes`, { headers })).status()).toBe(200);
	expect((await mcp()).status()).toBe(200);
	const mcpWrite = await page.request.post(`${origin}/mcp`, {
		headers: { ...headers, accept: "application/json, text/event-stream" },
		data: {
			jsonrpc: "2.0",
			id: "rx108-refused-write",
			method: "tools/call",
			params: { name: "create_resume", arguments: { name: "Must not exist", slug: "must-not-exist", tags: [] } },
		},
	});
	expect((await mcpWrite.json()).result.isError).toBe(true);
	expect(await (await page.request.get(`${origin}/api/openapi/resumes`, { headers })).json()).toEqual([]);

	const write = await page.request.post(`${origin}/api/openapi/resumes`, {
		headers,
		data: { name: "Must not exist", slug: "must-not-exist" },
	});
	expect(write.status()).toBe(403);
	expect(write.headers()["www-authenticate"]).toContain("insufficient_scope");
	expect((await page.request.delete(`${origin}/api/openapi/resumes/nonexistent`, { headers })).status()).toBe(403);
	await page.goto(`${origin}/dashboard/settings/ai`);
	const disconnect = page.getByRole("button", { name: "Disconnect Example desktop assistant", exact: true });
	await expect(disconnect).toBeVisible();
	await expect(page.getByText(/^Connected [A-Z][a-z]{2} /)).toBeVisible();
	await expect(page.getByText("Read your whole account, including exports and coaching conversations.")).toBeVisible();
	await expect(page.getByText("Create and change documents, applications and your profile.")).toHaveCount(0);
	await disconnect.click();
	const dialog = page.getByRole("alertdialog");
	await expect(dialog.getByText("Disconnect “Example desktop assistant”?")).toBeVisible();
	await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
	expect((await mcp()).status()).toBe(200);
	await disconnect.click();
	await page.setViewportSize({ width: 1440, height: 1000 });
	await dialog.screenshot({ path: testInfo.outputPath("disconnect-desktop.png"), animations: "disabled" });
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(dialog).toBeVisible();
	await dialog.screenshot({ path: testInfo.outputPath("disconnect-narrow.png"), animations: "disabled" });
	await dialog.getByRole("button", { name: "Disconnect", exact: true }).click();
	await expect(page.getByText("Disconnected “Example desktop assistant”.", { exact: true })).toBeVisible();
	await expect(disconnect).toHaveCount(0);
	await expect(page.getByText("No connected applications. Apps you allow appear here.")).toBeVisible();
	expect((await page.request.get(`${origin}/api/openapi/resumes`, { headers })).status()).toBe(401);
	expect((await mcp()).status()).toBe(401);
	expect((await page.request.get(`${origin}/api/auth/oauth2/userinfo`, { headers })).status()).toBe(401);
	const refresh = await page.request.post(`${origin}/api/auth/oauth2/token`, {
		headers: { origin },
		form: {
			grant_type: "refresh_token",
			client_id: client.client_id,
			refresh_token: tokens.refresh_token,
			resource: origin,
		},
	});
	expect(refresh.status()).toBe(400);
});

test("keeps OAuth callbacks through registration while refusing guests and missing resources", async ({
	page,
	baseURL,
	account,
}, testInfo) => {
	const origin = new URL(baseURL ?? "http://localhost:3000").origin;
	const registration = await page.request.post("/api/auth/oauth2/register", {
		headers: { origin },
		data: { client_name: "Example desktop assistant", redirect_uris: ["http://127.0.0.1:33921/callback"] },
	});
	const client = await registration.json();
	const query = new URLSearchParams({
		client_id: client.client_id,
		redirect_uri: "http://127.0.0.1:33921/callback",
		response_type: "code",
		scope: "openid api:read",
		code_challenge: createHash("sha256").update(randomBytes(32)).digest("base64url"),
		code_challenge_method: "S256",
	});
	const missing = await page.request.get(`/api/auth/oauth2/authorize?${query}`, { maxRedirects: 0 });
	expect(missing.status()).toBe(302);
	const refusal = new URL(missing.headers().location ?? "");
	expect(`${refusal.origin}${refusal.pathname}`).toBe("http://127.0.0.1:33921/callback");
	expect(refusal.searchParams.get("error")).toBe("invalid_target");
	query.set("resource", origin);
	await page.goto(`/api/auth/oauth2/authorize?${query}`);
	await expect(page.getByRole("button", { name: "Continue as guest" })).toHaveCount(0);
	const login = new URL(page.url());
	await page.getByRole("button", { name: "Create one now", exact: true }).click();
	expect(new URL(page.url()).searchParams.get("callbackURL")).toBe(login.searchParams.get("callbackURL"));
	const guest = await page.request.post("/api/auth/sign-in/anonymous", { headers: { origin }, data: {} });
	expect(guest.status()).toBe(200);
	await page.goto(`/api/auth/oauth2/authorize?${query}`);
	await expect(page.getByText("Create an account to connect apps. Guest accounts are temporary.")).toBeVisible();
	await expect(page.getByRole("button", { name: "Allow access" })).toHaveCount(0);
	await expect(page.getByText(/temp-.*@reactive-resume.local/)).toHaveCount(0);
	await page.screenshot({ path: testInfo.outputPath("guest-account-required.png") });
	const signed = new URL(page.url()).search.slice(1);
	const forbidden = await page.request.post("/api/auth/oauth2/consent", {
		headers: { origin },
		data: { accept: true, oauth_query: signed },
	});
	expect(forbidden.status()).toBe(403);
	expect(await (await page.request.get("/api/auth/oauth2/get-consents")).json()).toEqual([]);
	// Declining is the one choice a guest has that reaches the client.
	await page.route("http://127.0.0.1:33921/**", (route) => route.fulfill({ body: "client callback" }));
	await page.getByRole("button", { name: "Cancel connection", exact: true }).click();
	await page.waitForURL(/^http:\/\/127\.0\.0\.1:33921\/callback\?/);
	expect(new URL(page.url()).searchParams.get("error")).toBe("access_denied");
	expect(new URL(page.url()).searchParams.has("code")).toBe(false);
	await page.goto(`/api/auth/oauth2/authorize?${query}`);
	await expect(page.getByText("Create an account to connect apps. Guest accounts are temporary.")).toBeVisible();
	const resumed = new URL(page.url()).search.slice(1);
	await page.getByRole("button", { name: "Create account", exact: true }).click();
	expect(new URL(page.url()).searchParams.get("callbackURL")).toBe(`/api/auth/oauth?${resumed}`);
	await page.getByRole("textbox", { name: "Name", exact: true }).fill(account.name);
	await page.getByLabel("Username").fill(account.username);
	await page.getByLabel("Email address", { exact: true }).fill(account.email);
	await page.getByLabel("Password", { exact: true }).fill(account.password);
	await page.getByRole("button", { name: "Sign up", exact: true }).click();
	await expect(page.getByRole("button", { name: "Allow access", exact: true })).toBeVisible();
	await expect(page.getByText(`Signed in as ${account.email}`)).toBeVisible();
});
