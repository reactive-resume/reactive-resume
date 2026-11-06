import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@reactive-resume/utils/monorepo.node", () => ({ findWorkspaceRoot: () => null }));

beforeEach(() => {
	vi.resetModules();
	for (const name of [
		"APP_REVISION",
		"WEB_ACCESS_PROVIDER",
		"WEB_ACCESS_API_KEY",
		"WEB_ACCESS_API_URL",
		"WEB_SEARCH_SEARXNG_URL",
		"AI_PROVIDER",
		"AI_MODEL",
		"AI_API_KEY",
		"AI_BASE_URL",
		"REDIS_URL",
		"WEB_FONT_BASE_URL",
		"STORAGE_HEALTHCHECK_TIMEOUT_MS",
		"AI_AGENT_STEP_TIMEOUT_MS",
		"AI_AGENT_RUN_TIMEOUT_MS",
		"VERCEL",
	])
		vi.stubEnv(name, undefined);
});

describe("application revision", () => {
	it.each([undefined, "", "a".repeat(40)])("accepts an unset or full Git commit SHA (%s)", async (revision) => {
		vi.stubEnv("APP_REVISION", revision);
		expect((await import("./server")).env.APP_REVISION).toBe(revision || undefined);
	});

	it.each(["abc1234", "g".repeat(40)])("rejects invalid revision %s", async (revision) => {
		vi.stubEnv("APP_REVISION", revision);
		vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(import("./server")).rejects.toThrow("Invalid environment variables");
	});
});
afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

describe("web font mirror configuration", () => {
	it.each([undefined, "", "https://fonts.example.com", "https://fonts.example.com/cm/", "http://localhost:8080"])(
		"accepts %s",
		async (value) => {
			vi.stubEnv("WEB_FONT_BASE_URL", value);
			expect((await import("./server")).env.WEB_FONT_BASE_URL).toBe(value || undefined);
		},
	);

	it.each([
		"not a url",
		"/fonts",
		"ftp://fonts.example.com",
		"https://fonts.example.com?key=value",
		"https://fonts.example.com#fonts",
	])("rejects %s", async (value) => {
		vi.stubEnv("WEB_FONT_BASE_URL", value);
		vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(import("./server")).rejects.toThrow("Invalid environment variables");
	});
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

describe("SearXNG search configuration", () => {
	it.each(["http://searxng:8080", "https://search.example.com/searxng"])(
		"accepts %s on its own, including a private operator address",
		async (url) => {
			vi.stubEnv("WEB_SEARCH_SEARXNG_URL", url);
			const { env } = await import("./server");
			expect(env.WEB_SEARCH_SEARXNG_URL).toBe(url);
			expect(env.WEB_ACCESS_PROVIDER).toBeUndefined();
		},
	);
	it("accepts it beside a shared web connection", async () => {
		vi.stubEnv("WEB_SEARCH_SEARXNG_URL", "http://searxng:8080");
		vi.stubEnv("WEB_ACCESS_PROVIDER", "exa");
		vi.stubEnv("WEB_ACCESS_API_KEY", "test-key");
		const { env } = await import("./server");
		expect(env.WEB_SEARCH_SEARXNG_URL).toBe("http://searxng:8080");
		expect(env.WEB_ACCESS_PROVIDER).toBe("exa");
	});
	it.each(["ftp://searxng:8080", "not a url"])("rejects %s", async (url) => {
		vi.stubEnv("WEB_SEARCH_SEARXNG_URL", url);
		vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(import("./server")).rejects.toThrow("Invalid environment variables");
	});
	it("keeps the shared web connection's own validation", async () => {
		vi.stubEnv("WEB_SEARCH_SEARXNG_URL", "http://searxng:8080");
		vi.stubEnv("WEB_ACCESS_PROVIDER", "tavily");
		await expect(import("./server")).rejects.toThrow("Web access requires WEB_ACCESS_PROVIDER");
	});
});

describe("storage health check timeout", () => {
	it.each([undefined, ""])("defaults to 5000 ms when unset or blank (%s)", async (value) => {
		vi.stubEnv("STORAGE_HEALTHCHECK_TIMEOUT_MS", value);
		expect((await import("./server")).env.STORAGE_HEALTHCHECK_TIMEOUT_MS).toBe(5_000);
	});

	it("accepts a custom timeout in milliseconds", async () => {
		vi.stubEnv("STORAGE_HEALTHCHECK_TIMEOUT_MS", "7000");
		expect((await import("./server")).env.STORAGE_HEALTHCHECK_TIMEOUT_MS).toBe(7_000);
	});

	it.each(["0", "-1", "1.5", "not-a-number", "2147483648"])("rejects invalid timer duration %s", async (value) => {
		vi.stubEnv("STORAGE_HEALTHCHECK_TIMEOUT_MS", value);
		vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(import("./server")).rejects.toThrow("Invalid environment variables");
	});
});

describe("Assistant timeout budgets", () => {
	it.each([undefined, ""])(
		"defaults to two minutes per step and four minutes per run when unset or blank (%s)",
		async (value) => {
			vi.stubEnv("AI_AGENT_STEP_TIMEOUT_MS", value);
			vi.stubEnv("AI_AGENT_RUN_TIMEOUT_MS", value);
			const { env } = await import("./server");
			expect(env.AI_AGENT_STEP_TIMEOUT_MS).toBe(120_000);
			expect(env.AI_AGENT_RUN_TIMEOUT_MS).toBe(240_000);
		},
	);

	it("accepts custom step and run timeouts in milliseconds", async () => {
		vi.stubEnv("AI_AGENT_STEP_TIMEOUT_MS", "600000");
		vi.stubEnv("AI_AGENT_RUN_TIMEOUT_MS", "600000");
		const { env } = await import("./server");
		expect(env.AI_AGENT_STEP_TIMEOUT_MS).toBe(600_000);
		expect(env.AI_AGENT_RUN_TIMEOUT_MS).toBe(600_000);
	});

	it("rejects a run timeout above the self-hosted maximum", async () => {
		vi.stubEnv("AI_AGENT_RUN_TIMEOUT_MS", "600001");
		vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(import("./server")).rejects.toThrow("Invalid environment variables");
	});

	it("rejects a run timeout that leaves no cleanup minute inside the Vercel function limit", async () => {
		// Padded like deploymentEnvironment accepts, so the cap can't miss a Vercel deployment.
		vi.stubEnv("VERCEL", " 1 ");
		vi.stubEnv("AI_AGENT_RUN_TIMEOUT_MS", "240001");
		vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(import("./server")).rejects.toThrow("Invalid environment variables");
	});

	it("rejects a step timeout above the run timeout", async () => {
		vi.stubEnv("AI_AGENT_STEP_TIMEOUT_MS", "300000");
		await expect(import("./server")).rejects.toThrow(
			"AI_AGENT_STEP_TIMEOUT_MS must not exceed AI_AGENT_RUN_TIMEOUT_MS",
		);
	});

	it.each(
		["AI_AGENT_STEP_TIMEOUT_MS", "AI_AGENT_RUN_TIMEOUT_MS"].flatMap((name) =>
			["0", "-1", "1.5", "not-a-number"].map((value) => [name, value]),
		),
	)("rejects invalid %s %s", async (name, value) => {
		vi.stubEnv(name, value);
		vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(import("./server")).rejects.toThrow("Invalid environment variables");
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
