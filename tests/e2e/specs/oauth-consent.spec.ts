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
		await page.getByRole("button", { name: accept ? "Allow access" : "Deny", exact: true }).click();
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
