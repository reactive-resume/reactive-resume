import { describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
	auth: {},
	env: {
		APP_URL: "https://rxresu.me",
	},
}));

vi.mock("@better-auth/oauth-provider", () => ({
	oauthProviderAuthServerMetadata: vi.fn(() => vi.fn(() => Response.json({}))),
	oauthProviderOpenIdConfigMetadata: vi.fn(() => vi.fn(() => Response.json({}))),
}));

vi.mock("@reactive-resume/auth/config", () => ({
	auth: mocks.auth,
}));

vi.mock("@reactive-resume/env/server", () => ({
	env: mocks.env,
}));

vi.mock("@reactive-resume/mcp/server-card", () => ({
	buildMcpServerCard: vi.fn(() => ({})),
}));

vi.mock("../app-version", () => ({
	appVersion: "test",
}));

describe("handleOAuthProtectedResource", () => {
	it("advertises the mounted auth issuer as the authorization server", async () => {
		const { handleOAuthProtectedResource } = await import("./metadata");

		const response = await handleOAuthProtectedResource();

		await expect(response.json()).resolves.toMatchObject({
			resource: "https://rxresu.me",
			authorization_servers: ["https://rxresu.me/api/auth"],
		});
	});
});

describe("handleMcpServerCard", () => {
	it("advertises the connect URL and OAuth authorization server", async () => {
		const { handleMcpServerCard } = await import("./metadata");

		const response = handleMcpServerCard();

		await expect(response.json()).resolves.toMatchObject({
			url: "https://rxresu.me/mcp",
			authentication: { type: "oauth2", authorization_server: "https://rxresu.me/api/auth" },
		});
	});
});

describe("handleIntegrations", () => {
	it("serves a cacheable v3 document whose surfaces reference declared credentials", async () => {
		const { handleIntegrations } = await import("./metadata");

		const response = handleIntegrations();
		const document = await response.json();

		expect(response.headers.get("Content-Type")).toBe("application/json");
		expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
		expect(document).toMatchObject({ version: 3 });
		expect(document.credentials.oauth.setup).toContain("resource=https://rxresu.me");
		expect(document.credentials.oauth.setup).toContain("invalid_target");
		expect(document.surfaces.map((surface: { type: string; url: string }) => [surface.type, surface.url])).toEqual([
			["http", "https://rxresu.me/api/openapi"],
			["mcp", "https://rxresu.me/mcp"],
		]);

		const source = "https://rxresu.me/.well-known/integrations.json";
		for (const surface of document.surfaces) {
			expect(surface.basis).toEqual({ via: "declared", source });
			for (const entry of surface.auth.entries) {
				expect(entry.basis).toEqual({ via: "declared", source });
				for (const use of entry.use) expect(Object.keys(document.credentials)).toContain(use.id);
			}
		}
	});
});

describe("handleApiCatalog", () => {
	it("serves an RFC 9727 linkset for the REST API and MCP server", async () => {
		const { handleApiCatalog } = await import("./metadata");

		const response = handleApiCatalog();
		const catalog = await response.json();

		expect(response.headers.get("Content-Type")).toContain("application/linkset+json");
		expect(catalog.linkset.map((link: { anchor: string }) => link.anchor)).toEqual([
			"https://rxresu.me/api/openapi",
			"https://rxresu.me/mcp",
		]);
		expect(catalog.linkset[0]["service-desc"][0].href).toBe("https://rxresu.me/openapi.json");
	});
});

describe("handleAgentCatalog", () => {
	it("serves an Agentic Resource Discovery catalog that points agents at the MCP server card", async () => {
		const { handleAgentCatalog } = await import("./metadata");

		const response = handleAgentCatalog();
		const catalog = await response.json();

		// The earlier ai-catalog format Lighthouse validates: a closed root, a domain-anchored URN, and exactly one of
		// `url` or `data`. Two to five representative queries keep the entry free of conformance warnings.
		expect(Object.keys(catalog).toSorted()).toEqual(["entries", "host", "specVersion"]);
		expect(catalog.specVersion).toBe("1.0");
		expect(catalog.entries).toHaveLength(1);
		const [entry] = catalog.entries;
		expect(entry).toMatchObject({
			identifier: "urn:air:rxresu.me:mcp:reactive-resume",
			type: "application/mcp-server-card+json",
			url: "https://rxresu.me/.well-known/mcp/server-card.json",
		});
		expect(entry).not.toHaveProperty("data");
		expect(entry.representativeQueries.length).toBeGreaterThanOrEqual(2);
		expect(entry.representativeQueries.length).toBeLessThanOrEqual(5);
	});
});
