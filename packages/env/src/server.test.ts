import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@reactive-resume/utils/monorepo.node", () => ({ findWorkspaceRoot: () => null }));

beforeEach(() => {
	vi.resetModules();
	for (const name of [
		"WEB_ACCESS_PROVIDER",
		"WEB_ACCESS_API_KEY",
		"WEB_ACCESS_API_URL",
		"AI_PROVIDER",
		"AI_MODEL",
		"AI_API_KEY",
		"AI_BASE_URL",
		"REDIS_URL",
	])
		vi.stubEnv(name, undefined);
});
afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

describe("server web access configuration", () => {
	it.each([
		{ WEB_ACCESS_API_KEY: "test-key" },
		{ WEB_ACCESS_API_URL: "http://firecrawl:3002" },
		{ WEB_ACCESS_PROVIDER: "firecrawl" },
		{ WEB_ACCESS_PROVIDER: "tavily" },
		{ WEB_ACCESS_PROVIDER: "exa", WEB_ACCESS_API_KEY: "test-key", WEB_ACCESS_API_URL: "https://other.example" },
		{ WEB_ACCESS_PROVIDER: "tavily", WEB_ACCESS_API_KEY: "test-key", WEB_ACCESS_API_URL: "https://other.example" },
	])("rejects incomplete or inconsistent configuration: %j", async (settings) => {
		for (const [name, value] of Object.entries(settings)) vi.stubEnv(name, value);
		await expect(import("./server")).rejects.toThrow("Web access requires WEB_ACCESS_PROVIDER");
	});
	it.each(["firecrawl", "tavily", "exa"])("accepts a shared %s connection", async (provider) => {
		vi.stubEnv("WEB_ACCESS_PROVIDER", provider);
		vi.stubEnv("WEB_ACCESS_API_KEY", "test-key");
		expect((await import("./server")).env.WEB_ACCESS_PROVIDER).toBe(provider);
	});
	it("accepts keyless custom Firecrawl", async () => {
		vi.stubEnv("WEB_ACCESS_PROVIDER", "firecrawl");
		vi.stubEnv("WEB_ACCESS_API_URL", "http://firecrawl:3002");
		expect((await import("./server")).env.WEB_ACCESS_API_KEY).toBeUndefined();
	});
});

describe("redis url userinfo", () => {
	it.each([
		"redis://localhost:6379",
		"rediss://localhost:6379/0",
		"redis://:password@localhost:6379",
		"redis://default:password@localhost:6379/0",
		"redis://acl-user:password@localhost:6379",
	])("accepts %s", async (url) => {
		vi.stubEnv("REDIS_URL", url);
		expect((await import("./server")).env.REDIS_URL).toBe(url);
	});

	it.each([
		"redis://acl-user:@localhost:6379", // named ACL user with an empty password (nopass) — AUTH <user> "" is valid
		"redis://@localhost:6379", // empty userinfo — ioredis treats it like no userinfo and sends no AUTH
	])("accepts %s", async (url) => {
		vi.stubEnv("REDIS_URL", url);
		expect((await import("./server")).env.REDIS_URL).toBe(url);
	});

	it.each([
		"redis://password@localhost:6379", // password in the username slot (userinfo with no colon)
	])("rejects %s", async (url) => {
		vi.stubEnv("REDIS_URL", url);
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(import("./server")).rejects.toThrow("Invalid environment variables");
		expect(consoleError).toHaveBeenCalledWith(
			expect.any(String),
			expect.arrayContaining([
				expect.objectContaining({ message: expect.stringContaining("userinfo has no password field") }),
			]),
		);
	});

	it("rejects a malformed URL as a normal validation failure, not a parse crash", async () => {
		vi.stubEnv("REDIS_URL", "not a url");
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(import("./server")).rejects.toThrow("Invalid environment variables");
		expect(consoleError).toHaveBeenCalledWith(
			expect.any(String),
			expect.arrayContaining([expect.objectContaining({ code: "invalid_format", format: "url" })]),
		);
	});
});
