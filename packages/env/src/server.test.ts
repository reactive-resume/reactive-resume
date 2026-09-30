import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@reactive-resume/utils/monorepo.node", () => ({ findWorkspaceRoot: () => null }));

beforeEach(() => {
	vi.resetModules();
	for (const name of [
		"WEB_ACCESS_PROVIDER",
		"WEB_ACCESS_API_KEY",
		"WEB_ACCESS_API_URL",
		"FIRECRAWL_API_KEY",
		"FIRECRAWL_API_URL",
		"AI_PROVIDER",
		"AI_MODEL",
		"AI_API_KEY",
		"AI_BASE_URL",
	])
		vi.stubEnv(name, undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("server web access configuration", () => {
	it.each([
		{ WEB_ACCESS_API_KEY: "test-key" },
		{ WEB_ACCESS_API_URL: "http://firecrawl:3002" },
		{ WEB_ACCESS_PROVIDER: "firecrawl" },
		{ WEB_ACCESS_PROVIDER: "tavily" },
		{ WEB_ACCESS_PROVIDER: "exa", WEB_ACCESS_API_KEY: "test-key", WEB_ACCESS_API_URL: "https://other.example" },
		{ WEB_ACCESS_PROVIDER: "tavily", WEB_ACCESS_API_KEY: "test-key", WEB_ACCESS_API_URL: "https://other.example" },
	])("rejects incomplete or inconsistent generic configuration even with legacy aliases: %j", async (settings) => {
		vi.stubEnv("FIRECRAWL_API_KEY", "legacy-key");
		for (const [name, value] of Object.entries(settings)) vi.stubEnv(name, value);
		await expect(import("./server")).rejects.toThrow("Web access requires WEB_ACCESS_PROVIDER");
	});
	it.each(["firecrawl", "tavily", "exa"])("accepts a shared %s connection", async (provider) => {
		vi.stubEnv("WEB_ACCESS_PROVIDER", provider);
		vi.stubEnv("WEB_ACCESS_API_KEY", "test-key");
		expect((await import("./server")).env.WEB_ACCESS_PROVIDER).toBe(provider);
	});
	it("accepts keyless custom Firecrawl and preserves legacy server aliases", async () => {
		vi.stubEnv("WEB_ACCESS_PROVIDER", "firecrawl");
		vi.stubEnv("WEB_ACCESS_API_URL", "http://firecrawl:3002");
		expect((await import("./server")).env.WEB_ACCESS_API_KEY).toBeUndefined();
		vi.resetModules();
		vi.stubEnv("WEB_ACCESS_PROVIDER", undefined);
		vi.stubEnv("WEB_ACCESS_API_URL", undefined);
		vi.stubEnv("FIRECRAWL_API_URL", "http://firecrawl:3002");
		expect((await import("./server")).env.FIRECRAWL_API_URL).toBe("http://firecrawl:3002");
	});
});
