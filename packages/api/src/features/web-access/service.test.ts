import type { WebAccessConnection, WebAccessProvider } from "./contracts";
import type { LookupFunction } from "node:net";
import { lookup as socketLookup } from "node:dns";
import { lookup } from "node:dns/promises";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { searchJobPostings } from "../applications/posting";
import { probeWebAccess, readPage, searchWeb } from "./service";

const fixtures = vi.hoisted(() => ({
	limit: vi.fn(async () => ({ success: true })),
	direct: vi.fn(),
	directHtml: "<h1>Direct posting</h1><p>Work on accessible products.</p>",
	directLocation: "",
	directDelay: 0,
	directContentType: "text/html",
}));
vi.mock("../../redis", () => ({
	createRateLimiter: () => ({ limit: fixtures.limit }),
}));
vi.mock("@reactive-resume/env/server", () => ({
	env: { FLAG_DISABLE_API_RATE_LIMIT: false },
}));
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
vi.mock("node:dns", () => ({ lookup: vi.fn() }));
vi.mock("node:https", () => ({
	request: (
		url: URL,
		options: { signal: AbortSignal; lookup: LookupFunction },
		callback: (response: EventEmitter) => void,
	) => {
		fixtures.direct(url.toString());
		const request = new EventEmitter();
		let timer: ReturnType<typeof setTimeout> | undefined;
		const aborted = () => request.emit("error", options.signal.reason);
		const req = Object.assign(request, {
			destroy: (error: Error) => request.emit("error", error),
			end: () => {
				options.signal.addEventListener("abort", aborted, { once: true });
				options.lookup(url.hostname, { all: true }, (error) => {
					if (error) return req.destroy(error);
					const send = () => {
						const response = Object.assign(new EventEmitter(), {
							statusCode: fixtures.directLocation ? 302 : 200,
							headers: {
								"content-type": fixtures.directContentType,
								location: fixtures.directLocation || undefined,
							},
							resume: () => {},
						});
						callback(response);
						response.emit("data", Buffer.from(fixtures.directHtml));
						response.emit("end");
						options.signal.removeEventListener("abort", aborted);
					};
					if (fixtures.directDelay) timer = setTimeout(send, fixtures.directDelay);
					else send();
				});
			},
		});
		request.on("error", () => {
			if (timer) clearTimeout(timer);
			options.signal.removeEventListener("abort", aborted);
		});
		return req;
	},
}));

const PROVIDERS = ["firecrawl", "tavily", "exa"] as const;
const URL = "https://jobs.example.com/role";
const nativeFetch = globalThis.fetch;
const nativeTimeout = AbortSignal.timeout;
let endpoint: string;
let status = 200;
let responseOverride: unknown;
let delay = 0;
let searchStatus: number | undefined;
let onRequest: (() => void) | undefined;
const requests: {
	provider: string;
	operation: string;
	body: Record<string, unknown>;
	auth: string | undefined;
}[] = [];

const searchResponse = (provider: WebAccessProvider) => {
	const unsafe = [
		{ url: "https://localhost/private", title: "Private" },
		{ url: "javascript:alert(1)", title: "Script" },
		{ url: "http://jobs.example.com/insecure", title: "HTTP" },
		{ url: "https://jobs.example.com/missing-title" },
	];
	if (provider === "firecrawl")
		return {
			success: true,
			data: {
				web: [{ url: `${URL}#apply`, title: "Designer", description: "Berlin" }, ...unsafe],
			},
		};
	if (provider === "tavily")
		return {
			results: [{ url: `${URL}#apply`, title: "Designer", content: "Berlin" }, ...unsafe],
		};
	return { results: [{ url: `${URL}#apply`, title: "Designer" }, ...unsafe] };
};
const readResponse = (provider: WebAccessProvider, content = "# Designer\nAccessible product design") => {
	if (provider === "firecrawl")
		return {
			success: true,
			data: { markdown: content, metadata: { url: URL } },
		};
	if (provider === "tavily")
		return {
			results: [{ url: URL, raw_content: content }],
			failed_results: [],
		};
	return {
		results: [{ url: URL, text: content, crawlDate: "2026-09-29T12:00:00Z" }],
		statuses: [{ id: URL, status: "success" }],
	};
};

const server = createServer(async (request, result) => {
	const chunks: Buffer[] = [];
	for await (const chunk of request) chunks.push(chunk);
	const parts = (request.url ?? "").split("/");
	const provider = (parts[1] === "v2" ? "firecrawl" : parts[1]) as WebAccessProvider;
	const operation = parts[2] === "search" ? "search" : "read";
	requests.push({
		provider,
		operation,
		body: JSON.parse(Buffer.concat(chunks).toString()),
		auth: request.headers.authorization ?? (request.headers["x-api-key"] as string | undefined),
	});
	onRequest?.();
	if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
	if (result.destroyed) return;
	result.writeHead(operation === "search" && searchStatus !== undefined ? searchStatus : status, {
		"content-type": "application/json",
	});
	result.end(
		JSON.stringify(responseOverride ?? (operation === "search" ? searchResponse(provider) : readResponse(provider))),
	);
});

const connection = (provider: WebAccessProvider): WebAccessConnection => ({
	provider,
	apiKey: "test-provider-key",
	...(provider === "firecrawl" ? { apiUrl: endpoint } : {}),
});
const context = (provider: WebAccessProvider) => ({
	userId: "user",
	connection: connection(provider),
});

beforeAll(async () => {
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing fixture server");
	endpoint = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
	server.closeAllConnections();
	await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});
beforeEach(() => {
	vi.stubEnv("NODE_ENV", "test");
	vi.stubGlobal("fetch", (input: string | URL | Request, options?: RequestInit) => {
		const url = new globalThis.URL(input instanceof Request ? input.url : input.toString());
		if (url.origin === endpoint) return nativeFetch(input, options);
		const provider = url.hostname === "api.tavily.com" ? "tavily" : "exa";
		return nativeFetch(`${endpoint}/${provider}${url.pathname}`, options);
	});
	vi.mocked(lookup).mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
	vi.mocked(socketLookup).mockImplementation(((
		_hostname: string,
		_options: unknown,
		callback: (error: Error | null, addresses: unknown) => void,
	) => callback(null, [{ address: "93.184.216.34", family: 4 }])) as never);
	vi.spyOn(console, "info").mockImplementation(() => {});
	requests.length = 0;
	status = 200;
	searchStatus = undefined;
	onRequest = undefined;
	responseOverride = undefined;
	delay = 0;
	fixtures.limit.mockClear();
	fixtures.limit.mockResolvedValue({ success: true });
	fixtures.direct.mockClear();
	fixtures.directHtml = "<h1>Direct posting</h1><p>Work on accessible products.</p>";
	fixtures.directLocation = "";
	fixtures.directDelay = 0;
	fixtures.directContentType = "text/html";
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe.each(PROVIDERS)("%s adapter at shared boundary", (provider) => {
	it("retains a legitimate security posting mentioning access challenges", async () => {
		const content = "# Security engineer\nDesign access denied screens and captcha challenge flows.";
		responseOverride = readResponse(provider, content);
		expect(await readPage(URL, context(provider))).toMatchObject({
			content,
			method: provider,
			completeness: "unknown",
		});
		expect(fixtures.direct).not.toHaveBeenCalled();
	});
	it("maps bounded search results, filters unsafe links, and retains the original generic query", async () => {
		const results = await searchWeb("Lumen Health company", context(provider));
		expect(results).toEqual([
			{
				url: URL,
				title: "Designer",
				...(provider !== "exa" ? { snippet: "Berlin" } : {}),
			},
		]);
		expect(requests[0]?.body.query).toBe("Lumen Health company");
		expect(requests[0]?.auth).toContain("test-provider-key");
		expect(requests[0]?.body).not.toHaveProperty("scrapeOptions");
		expect(requests[0]?.body).not.toHaveProperty("contents");
		if (provider === "tavily")
			expect(requests[0]?.body).toMatchObject({
				include_raw_content: false,
				include_answer: false,
			});
	});

	it("reads page content with truthful source metadata and explicit truncation", async () => {
		responseOverride = readResponse(provider, "x".repeat(20_001));
		const result = await readPage(`${URL}#apply`, context(provider));
		expect(result).toMatchObject({
			requestedUrl: URL,
			resolvedUrl: URL,
			method: provider,
			truncated: true,
			completeness: "incomplete",
		});
		expect(result.content).toHaveLength(20_000);
		expect(result.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		if (provider === "exa") {
			expect(result.providerFetchedAt).toBe("2026-09-29T12:00:00Z");
			expect(requests[0]?.body).toMatchObject({
				text: { maxCharacters: 20_001 },
				maxAgeHours: 0,
			});
			expect(requests[0]?.body).not.toHaveProperty("livecrawl");
		} else expect(result.providerFetchedAt).toBeUndefined();
		if (provider === "tavily") {
			expect(requests[0]?.body).toMatchObject({ format: "markdown" });
			expect(requests[0]?.body).not.toHaveProperty("query");
			expect(requests[0]?.body).not.toHaveProperty("chunks_per_source");
		}
	});

	it.each([
		[401, "auth"],
		[402, "quota"],
		[429, "quota"],
		[503, "unreachable"],
	] as const)("returns safe search failure for HTTP %i", async (httpStatus, reason) => {
		status = httpStatus;
		responseOverride = {
			error: "test-provider-key should never appear in public errors",
		};
		const failure = await searchWeb("designer", context(provider)).catch((error: Error) => error);
		expect(failure).toMatchObject({ reason });
		expect(failure).toHaveProperty("message", expect.not.stringContaining("test-provider-key"));
		expect(fixtures.direct).not.toHaveBeenCalled();
	});

	it.each(["auth", "quota", "malformed", "empty", "challenge", "too-large", "per-url"])(
		"falls back once after %s read failure",
		async (failure) => {
			if (failure === "auth") status = 401;
			if (failure === "quota") status = 429;
			if (failure === "malformed") responseOverride = { unexpected: true };
			if (failure === "empty") responseOverride = readResponse(provider, " ");
			if (failure === "challenge") responseOverride = readResponse(provider, "Just a moment. Verify you are human");
			if (failure === "too-large") responseOverride = readResponse(provider, "x".repeat(2_000_001));
			if (failure === "per-url") {
				if (provider === "firecrawl")
					responseOverride = {
						success: true,
						data: {
							markdown: "Bad cached response",
							metadata: { statusCode: 403 },
						},
					};
				if (provider === "tavily")
					responseOverride = {
						...(readResponse(provider) as object),
						failed_results: [{ url: URL, error: "Not available" }],
					};
				if (provider === "exa")
					responseOverride = {
						...(readResponse(provider) as object),
						statuses: [{ id: URL, status: "error", error: { tag: "CRAWL_TIMEOUT" } }],
					};
			}
			expect(await readPage(URL, context(provider))).toMatchObject({
				method: "builtin",
				content: "Direct posting\nWork on accessible products.",
				fallbackReason: expect.any(String),
				completeness: "unknown",
			});
			expect(fixtures.direct).toHaveBeenCalledTimes(1);
			expect(requests.every((request) => request.provider === provider)).toBe(true);
		},
	);

	it("bounds provider responses before parsing", async () => {
		responseOverride = { unexpected: "x".repeat(2_000_001) };
		await expect(searchWeb("designer", context(provider))).rejects.toMatchObject({ reason: "too-large" });
	});

	it("rejects malformed search responses but accepts a valid empty result list", async () => {
		responseOverride = { unexpected: true };
		await expect(searchWeb("designer", context(provider))).rejects.toMatchObject({ reason: "malformed" });
		responseOverride = provider === "firecrawl" ? { success: true, data: { web: [] } } : { results: [] };
		expect(await searchWeb("designer", context(provider))).toEqual([]);
	});

	it.each(["search", "read"] as const)(
		"cancels an outstanding %s request and never starts a fallback",
		async (operation) => {
			delay = 150;
			const controller = new AbortController();
			const started = new Promise<void>((resolve) => {
				onRequest = resolve;
			});
			const call =
				operation === "search"
					? searchWeb("designer", {
							...context(provider),
							signal: controller.signal,
						})
					: readPage(URL, { ...context(provider), signal: controller.signal });
			const assertion = expect(call).rejects.toMatchObject({
				name: "AbortError",
			});
			await started;
			controller.abort();
			await assertion;
			expect(fixtures.direct).not.toHaveBeenCalled();
		},
	);

	it("reports timeout safely without extending the overall deadline", async () => {
		delay = 150;
		await expect(
			searchWeb("designer", {
				...context(provider),
				signal: nativeTimeout(25),
			}),
		).rejects.toMatchObject({
			reason: "timeout",
		});
		expect(fixtures.direct).not.toHaveBeenCalled();
	});

	it("probes provider operations independently and never validates through fallback", async () => {
		searchStatus = 429;
		const result = await probeWebAccess(connection(provider), {
			userId: "user",
		});
		expect(result).toEqual({
			search: { success: false, error: "quota" },
			read: { success: true },
		});
		expect(fixtures.direct).not.toHaveBeenCalled();
	});
});

describe("public targets and bounded fallback", () => {
	it("accepts a maximum-length Applications query including its job intent suffix", async () => {
		const query = "x".repeat(500);
		const results = await searchJobPostings(query, context("tavily"));
		expect(results).toMatchObject([{ url: URL, title: "Designer", description: "Berlin" }]);
		expect(requests[0]?.body.query).toBe(`${query} job posting`);
	});
	it.each([
		"http://jobs.example.com/role",
		"https://user:pass@jobs.example.com/role",
		"https://localhost/role",
		"https://127.0.0.1/role",
		"https://10.0.0.8/role",
		"https://[::1]/role",
		"ftp://jobs.example.com/role",
	])("refuses unsafe input %s before retrieval", async (url) => {
		await expect(readPage(url, context("firecrawl"))).rejects.toMatchObject({
			reason: "unsafe-url",
		});
		expect(requests).toHaveLength(0);
		expect(fixtures.direct).not.toHaveBeenCalled();
	});

	it("refuses mixed private DNS answers before delegating to any remote service", async () => {
		vi.mocked(lookup).mockResolvedValue([
			{ address: "93.184.216.34", family: 4 },
			{ address: "192.168.1.4", family: 4 },
		] as never);
		await expect(readPage(URL, context("exa"))).rejects.toMatchObject({
			reason: "unsafe-url",
		});
		expect(requests).toHaveLength(0);
		expect(fixtures.direct).not.toHaveBeenCalled();
	});

	it("protects the direct socket against DNS rebinding after preflight", async () => {
		vi.mocked(socketLookup).mockImplementation(((
			_hostname: string,
			_options: unknown,
			callback: (error: Error | null, addresses: unknown) => void,
		) => callback(null, [{ address: "10.0.0.1", family: 4 }])) as never);
		await expect(readPage(URL, { userId: "user", connection: null })).rejects.toMatchObject({ reason: "unsafe-url" });
	});

	it.each(["https://127.0.0.1/private", "http://jobs.example.com/role"])(
		"refuses direct redirects to %s",
		async (location) => {
			fixtures.directLocation = location;
			await expect(readPage(URL, { userId: "user", connection: null })).rejects.toMatchObject({ reason: "unsafe-url" });
			expect(fixtures.direct).toHaveBeenCalledTimes(1);
		},
	);

	it.each(["Readable content", " ", "Just a moment. Verify you are human"])(
		"refuses an unsafe provider resolved URL before accepting %j or starting fallback",
		async (content) => {
			responseOverride = {
				results: [{ url: "https://127.0.0.1/private", raw_content: content }],
			};
			await expect(readPage(URL, context("tavily"))).rejects.toMatchObject({
				reason: "unsafe-url",
			});
			expect(fixtures.direct).not.toHaveBeenCalled();
		},
	);

	it("shares the remaining deadline across a timed-out provider and direct fallback", async () => {
		vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => nativeTimeout(ms <= 15_000 ? 20 : 75));
		delay = 150;
		fixtures.directDelay = 100;
		await expect(readPage(URL, context("tavily"))).rejects.toMatchObject({
			reason: "timeout",
		});
		expect(fixtures.direct).toHaveBeenCalledTimes(1);
	});

	it.each(["media-type", "response-size", "redirect-loop", "challenge"])(
		"bounds the built-in reader's %s failure",
		async (failure) => {
			if (failure === "media-type") fixtures.directContentType = "application/pdf";
			if (failure === "response-size") fixtures.directHtml = "x".repeat(2_000_001);
			if (failure === "redirect-loop") fixtures.directLocation = URL;
			if (failure === "challenge") fixtures.directHtml = "<p>Just a moment. Verify you are human.</p>";
			await expect(readPage(URL, { userId: "user", connection: null })).rejects.toMatchObject({
				reason:
					failure === "media-type"
						? "not-a-page"
						: failure === "response-size"
							? "too-large"
							: failure === "challenge"
								? "challenge"
								: "unreachable",
			});
			expect(fixtures.direct).toHaveBeenCalledTimes(failure === "redirect-loop" ? 4 : 1);
		},
	);

	it("never sends a provider request after cancellation while DNS is still pending", async () => {
		vi.mocked(lookup).mockImplementation(() => new Promise(() => {}) as never);
		const controller = new AbortController();
		const result = readPage(URL, {
			...context("firecrawl"),
			signal: controller.signal,
		});
		const assertion = expect(result).rejects.toMatchObject({
			name: "AbortError",
		});
		controller.abort();
		await assertion;
		expect(requests).toHaveLength(0);
		expect(fixtures.direct).not.toHaveBeenCalled();
	});

	it("retains the Firecrawl keyless self-hosted reader", async () => {
		expect(
			await readPage(URL, {
				userId: "user",
				connection: { provider: "firecrawl", apiUrl: endpoint, apiKey: "" },
			}),
		).toMatchObject({ method: "firecrawl", completeness: "unknown" });
		expect(requests[0]?.auth).toBeUndefined();
	});

	it("limits the shared boundary once per operation and keeps fallback under the same allowance", async () => {
		vi.stubEnv("NODE_ENV", "production");
		status = 429;
		await readPage(URL, context("exa"));
		expect(fixtures.limit).toHaveBeenCalledTimes(1);
		expect(fixtures.limit).toHaveBeenCalledWith("user");
		fixtures.limit.mockResolvedValue({ success: false });
		await expect(searchWeb("designer", context("exa"))).rejects.toMatchObject({
			reason: "rate-limit",
		});
		expect(requests).toHaveLength(1);
	});
});
