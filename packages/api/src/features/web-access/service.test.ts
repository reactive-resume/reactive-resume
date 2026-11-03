import type { WebAccessConnection, WebAccessProvider } from "./contracts";
import type { LookupFunction } from "node:net";
import { lookup as socketLookup } from "node:dns";
import { lookup } from "node:dns/promises";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { searchJobPostings } from "../applications/posting";
import { probeWebAccess, readPage, searchWeb } from "./service";

const fixtures = vi.hoisted(() => ({
	limit: vi.fn(async () => ({ success: true })),
	direct: vi.fn(),
	directHtml: "<h1>Direct posting</h1><p>Work on accessible products.</p>",
	directLocation: "",
	directDelay: 0,
	directContentType: "text/html",
	env: { FLAG_DISABLE_API_RATE_LIMIT: false } as {
		FLAG_DISABLE_API_RATE_LIMIT: boolean;
		WEB_SEARCH_SEARXNG_URL?: string;
	},
}));
vi.mock("../../redis", () => ({
	createRateLimiter: () => ({ limit: fixtures.limit }),
}));
vi.mock("@reactive-resume/env/server", () => ({ env: fixtures.env }));
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
vi.mock("node:dns", () => ({ lookup: vi.fn() }));
vi.mock("node:https", async (original) => ({
	...(await original<typeof import("node:https")>()),
	request: (
		url: URL,
		options: { signal: AbortSignal; agent: { options: { lookup: LookupFunction } } },
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
				options.agent.options.lookup(url.hostname, { all: true }, (error) => {
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
let respond:
	| ((request: { provider: string; body: Record<string, unknown> }) => { status?: number; body?: unknown } | undefined)
	| undefined;
const requests: {
	provider: string;
	operation: string;
	method: string | undefined;
	url: string;
	body: Record<string, unknown>;
	raw: string;
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
			data: { markdown: content, metadata: { url: URL, cachedAt: "2026-09-29T12:00:00Z" } },
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
	const parts = (request.url ?? "").split("?", 1)[0]?.split("/") ?? [];
	const provider = (parts[1] === "v2" ? "firecrawl" : parts[1]) as WebAccessProvider;
	const operation = parts[2] === "search" ? "search" : "read";
	const raw = Buffer.concat(chunks).toString();
	const body = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>;
	requests.push({
		provider,
		operation,
		method: request.method,
		url: request.url ?? "",
		body,
		raw,
		auth: request.headers.authorization ?? (request.headers["x-api-key"] as string | undefined),
	});
	onRequest?.();
	if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
	if (result.destroyed) return;
	const custom = respond?.({ provider, body });
	result.writeHead(custom?.status ?? (operation === "search" && searchStatus !== undefined ? searchStatus : status), {
		"content-type": "application/json",
	});
	result.end(
		JSON.stringify(
			custom?.body ?? responseOverride ?? (operation === "search" ? searchResponse(provider) : readResponse(provider)),
		),
	);
});

/** Today's search body for "designer", which a search with no regions must send byte for byte. */
const plainSearchBody = (provider: WebAccessProvider) =>
	provider === "firecrawl"
		? { query: "designer", sources: ["web"], limit: 5, timeout: 14_000, integration: "_reactive-resume" }
		: provider === "tavily"
			? {
					query: "designer",
					max_results: 5,
					search_depth: "basic",
					include_answer: false,
					include_raw_content: false,
				}
			: { query: "designer", numResults: 5, type: "auto" };
const TAVILY_COUNTRIES: Record<string, string> = { AU: "australia", DE: "germany", FR: "france" };
/** The provider's location field and the value it carries for a country code. */
const regionField = (provider: WebAccessProvider, code: string): [string, string] =>
	provider === "exa"
		? ["userLocation", code]
		: ["country", provider === "tavily" ? (TAVILY_COUNTRIES[code] ?? "") : code];
const regionOf = (provider: WebAccessProvider, body: Record<string, unknown>) =>
	Object.keys(TAVILY_COUNTRIES).find((code) => {
		const [field, value] = regionField(provider, code);
		return body[field] === value;
	});
const resultsFor = (provider: WebAccessProvider, items: { url: string; title: string }[]) =>
	provider === "firecrawl" ? { success: true, data: { web: items } } : { results: items };
const job = (path: string) => ({ url: `https://jobs.example.com/${path}`, title: path });

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
	respond = undefined;
	responseOverride = undefined;
	delay = 0;
	fixtures.limit.mockClear();
	fixtures.limit.mockResolvedValue({ success: true });
	fixtures.direct.mockClear();
	fixtures.directHtml = "<h1>Direct posting</h1><p>Work on accessible products.</p>";
	fixtures.directLocation = "";
	fixtures.directDelay = 0;
	fixtures.directContentType = "text/html";
	delete fixtures.env.WEB_SEARCH_SEARXNG_URL;
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
		if (provider === "firecrawl") {
			expect(result.providerFetchedAt).toBe("2026-09-29T12:00:00Z");
			expect(requests[0]?.body).toMatchObject({ integration: "_reactive-resume" });
		} else if (provider === "exa") {
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
		[429, "rate-limit"],
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

	it.each(["auth", "quota", "rate-limit", "malformed", "empty", "challenge", "too-large", "per-url"])(
		"falls back once after %s read failure",
		async (failure) => {
			if (failure === "auth") status = 401;
			if (failure === "quota") status = 402;
			if (failure === "rate-limit") status = 429;
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

	it("sends the region in the provider's location field", async () => {
		await searchWeb("designer", { ...context(provider), regions: ["AU"] });
		expect(requests).toHaveLength(1);
		const [field, value] = regionField(provider, "AU");
		expect(requests[0]?.body).toEqual({ ...plainSearchBody(provider), [field]: value });
	});

	it.each<[string[] | undefined]>([[[]], [undefined]])("sends today's exact body with regions %j", async (regions) => {
		await searchWeb(
			"designer",
			{
				...context(provider),
				...(regions ? { regions } : {}),
			},
			(region) => `designer in ${region}`,
		);
		expect(requests).toHaveLength(1);
		expect(requests[0]?.raw).toBe(JSON.stringify(plainSearchBody(provider)));
	});

	it("searches each region and interleaves deduplicated results in region order, capped at five", async () => {
		respond = ({ body }) => {
			const region = regionOf(provider, body);
			if (region === "DE") return { body: resultsFor(provider, [job("DE1"), job("DE2"), job("shared"), job("DE3")]) };
			if (region === "FR") return { body: resultsFor(provider, [job("FR1"), job("shared"), job("FR2"), job("FR3")]) };
			return { status: 400 };
		};
		const results = await searchWeb("designer", { ...context(provider), regions: ["DE", "FR"] });
		expect(requests).toHaveLength(2);
		expect(results.map((result) => result.title)).toEqual(["DE1", "FR1", "DE2", "shared", "FR2"]);
		expect(console.info).toHaveBeenCalledWith("[web-access]", {
			provider,
			operation: "search",
			durationMs: expect.any(Number),
			outcome: "success",
		});
	});

	it.each<[string[], string]>([
		[["DE", "FR"], "1/2-regions-failed"],
		[["DE", "FR", "AU"], "2/3-regions-failed"],
	])("keeps available results and logs regional failures for %j", async (regions, fallback) => {
		respond = ({ body }) =>
			regionOf(provider, body) === "FR" ? { body: resultsFor(provider, [job("FR1"), job("FR2")]) } : { status: 500 };
		const results = await searchWeb("designer", { ...context(provider), regions });
		expect(requests).toHaveLength(regions.length);
		expect(results.map((result) => result.title)).toEqual(["FR1", "FR2"]);
		expect(console.info).toHaveBeenCalledWith("[web-access]", {
			provider,
			operation: "search",
			durationMs: expect.any(Number),
			outcome: "success",
			fallback,
		});
	});

	it("throws the existing failure when every region's request fails", async () => {
		status = 429;
		await expect(searchWeb("designer", { ...context(provider), regions: ["DE", "FR"] })).rejects.toMatchObject({
			reason: "rate-limit",
		});
		expect(requests).toHaveLength(2);
	});

	it("rate-limits a multi-region search once", async () => {
		vi.stubEnv("NODE_ENV", "production");
		await searchWeb("designer", { ...context(provider), regions: ["DE", "FR", "AU"] });
		expect(requests).toHaveLength(3);
		expect(fixtures.limit).toHaveBeenCalledTimes(1);
	});

	it("sends each region the query built for it", async () => {
		await searchWeb("designer", { ...context(provider), regions: ["DE", "FR"] }, (region) => `designer in ${region}`);
		expect(
			Object.fromEntries(requests.map((request) => [regionOf(provider, request.body), request.body.query])),
		).toEqual({ DE: "designer in DE", FR: "designer in FR" });
	});

	it("probes provider operations independently and never validates through fallback", async () => {
		searchStatus = 429;
		const result = await probeWebAccess(connection(provider), {
			userId: "user",
		});
		expect(result).toEqual({
			search: { success: false, error: "rate-limit" },
			read: { success: true },
		});
		expect(fixtures.direct).not.toHaveBeenCalled();
	});
});

describe("Tavily country names", () => {
	it.each([
		["CZ", "czech republic"],
		["SG", "singapore"],
		["HK", undefined],
	])("sends %s as Tavily's listed name %j, or no country when Tavily lists none", async (code, country) => {
		await searchWeb("designer", { ...context("tavily"), regions: [code] });
		expect(requests[0]?.body.country).toBe(country);
		if (!country) expect(requests[0]?.body).not.toHaveProperty("country");
	});
});

describe("posting search names the user's country", () => {
	const postingQuery = async (
		query: string,
		scope: { regions: string[]; locale?: string; locations?: string[] },
	): Promise<unknown> => {
		await searchJobPostings(query, { ...context("tavily"), ...scope });
		expect(requests).toHaveLength(Math.max(scope.regions.length, 1));
		return requests[0]?.body.query;
	};

	it("adds the region's country in the user's locale", async () => {
		expect(await postingQuery("designer", { regions: ["AU"], locale: "en-US", locations: [] })).toBe(
			"designer in Australia job posting",
		);
	});
	it("writes the country in the user's UI language", async () => {
		expect(await postingQuery("designer", { regions: ["FR"], locale: "de-DE" })).toBe(
			"designer in Frankreich job posting",
		);
	});
	it("names the country in English when there is no locale", async () => {
		expect(await postingQuery("designer", { regions: ["DE"] })).toBe("designer in Germany job posting");
	});
	it("names each region's own country", async () => {
		await searchJobPostings("designer", { ...context("tavily"), regions: ["DE", "FR"], locale: "en" });
		expect(
			Object.fromEntries(requests.map((request) => [regionOf("tavily", request.body), request.body.query])),
		).toEqual({ DE: "designer in Germany job posting", FR: "designer in France job posting" });
	});
	it.each<[string, { regions: string[]; locale?: string; locations?: string[] }]>([
		["designer berlin", { regions: ["DE"], locations: ["Berlin"] }],
		["designer Frankreich", { regions: ["FR"], locale: "de-DE" }],
		["designer in france", { regions: ["FR"], locale: "de-DE" }],
		["remote designer", { regions: ["AU"] }],
		["designer REMOTE", { regions: ["AU"] }],
		["designer", { regions: ["AU"], locations: ["Remote"] }],
	])("adds nothing to %j when it names a place or remote work", async (query, scope) => {
		expect(await postingQuery(query, scope)).toBe(`${query} job posting`);
	});
	it("sends the query unchanged when the country would pass the length limit", async () => {
		const query = "x".repeat(500);
		expect(await postingQuery(query, { regions: ["AU"], locale: "en" })).toBe(`${query} job posting`);
	});
	it("keeps today's query with no regions", async () => {
		expect(await postingQuery("designer", { regions: [], locale: "en", locations: ["Berlin"] })).toBe(
			"designer job posting",
		);
		expect(requests[0]?.body).not.toHaveProperty("country");
	});
});

describe("connection test region", () => {
	it("probes search in the given region", async () => {
		await probeWebAccess(connection("tavily"), { userId: "user", region: "AU" });
		const search = requests.find((request) => request.operation === "search");
		expect(search?.body.country).toBe("australia");
	});
	it("probes search with no region when none is given", async () => {
		await probeWebAccess(connection("tavily"), { userId: "user" });
		const search = requests.find((request) => request.operation === "search");
		expect(search?.body).not.toHaveProperty("country");
	});
});

describe("search through a self-hosted SearXNG", () => {
	const searxngResults = { results: [{ url: `${URL}#apply`, title: "Designer", content: "Berlin" }], answers: [] };
	const searxng = () => requests.filter((request) => request.provider === ("searxng" as WebAccessProvider));
	const language = (request: { url: string }) => new globalThis.URL(request.url, endpoint).searchParams.get("language");
	beforeEach(() => {
		fixtures.env.WEB_SEARCH_SEARXNG_URL = `${endpoint}/searxng`;
		respond = ({ provider }) => (provider === ("searxng" as WebAccessProvider) ? { body: searxngResults } : undefined);
	});

	it("searches SearXNG without a web connection", async () => {
		expect(await searchWeb("designer", { userId: "user", connection: null })).toEqual([
			{ url: URL, title: "Designer", snippet: "Berlin" },
		]);
		expect(requests).toHaveLength(1);
		expect(requests[0]).toMatchObject({ provider: "searxng", operation: "search", method: "GET" });
		expect(requests[0]?.url).toBe("/searxng/search?q=designer&format=json");
	});

	it.each(PROVIDERS)("searches SearXNG instead of a saved %s connection", async (provider) => {
		await searchWeb("designer", context(provider));
		expect(requests.map((request) => request.provider)).toEqual(["searxng"]);
		expect(requests[0]?.auth).toBeUndefined();
	});

	it("keeps country targeting independent of the UI language through the same fan-out", async () => {
		respond = ({ provider }) =>
			provider === ("searxng" as WebAccessProvider) ? { body: searxngResults } : { status: 500 };
		const results = await searchWeb(
			"designer",
			{ userId: "user", connection: null, regions: ["AU", "SG"], locale: "de-DE" },
			(region) => `designer in ${region}`,
		);
		expect(results).toEqual([{ url: URL, title: "Designer", snippet: "Berlin" }]);
		expect(Object.fromEntries(searxng().map((request) => [language(request), request.url]))).toEqual({
			"en-AU": "/searxng/search?q=designer+in+AU&format=json&language=en-AU",
			"en-SG": "/searxng/search?q=designer+in+SG&format=json&language=en-SG",
		});
	});

	it("reports a failed search probe when SearXNG's engines all fail", async () => {
		respond = () => ({ body: { results: [], unresponsive_engines: [["google", "timeout"]] } });
		expect(await probeWebAccess(null, { userId: "user", region: "AU" })).toEqual({
			search: { success: false, error: "unreachable" },
			read: { success: false, error: "unavailable" },
		});
	});

	it("reports an unreachable SearXNG safely", async () => {
		respond = () => ({ status: 502 });
		await expect(searchWeb("designer", { userId: "user", connection: null })).rejects.toMatchObject({
			reason: "unreachable",
		});
	});

	it("rate-limits a SearXNG search once", async () => {
		vi.stubEnv("NODE_ENV", "production");
		await searchWeb("designer", { userId: "user", connection: null, regions: ["DE", "FR", "AU"] });
		expect(searxng()).toHaveLength(3);
		expect(fixtures.limit).toHaveBeenCalledTimes(1);
	});

	it("still reads through the saved connection, then the built-in reader", async () => {
		expect(await readPage(URL, context("exa"))).toMatchObject({ method: "exa" });
		expect(requests.map((request) => [request.provider, request.operation])).toEqual([["exa", "read"]]);
		expect(fixtures.direct).not.toHaveBeenCalled();

		requests.length = 0;
		respond = () => ({ status: 500 });
		expect(await readPage(URL, context("exa"))).toMatchObject({ method: "builtin", fallbackReason: "unreachable" });
		expect(requests.map((request) => request.provider)).toEqual(["exa"]);
		expect(fixtures.direct).toHaveBeenCalledTimes(1);
	});

	it("reads with the built-in reader when there is no connection", async () => {
		expect(await readPage(URL, { userId: "user", connection: null })).toMatchObject({ method: "builtin" });
		expect(requests).toHaveLength(0);
	});

	it("tests search against SearXNG and reading against the connection", async () => {
		respond = ({ provider }) => (provider === ("searxng" as WebAccessProvider) ? { status: 503 } : undefined);
		const result = await probeWebAccess(connection("exa"), { userId: "user", region: "AU" });
		expect(result).toEqual({ search: { success: false, error: "unreachable" }, read: { success: true } });
		expect(requests.map((request) => [request.provider, request.operation]).sort()).toEqual([
			["exa", "read"],
			["searxng", "search"],
		]);
		expect(language(searxng()[0] ?? { url: "" })).toBe("en-AU");
		expect(console.info).toHaveBeenCalledWith(
			"[web-access]",
			expect.objectContaining({ provider: "searxng", operation: "search", outcome: "unreachable" }),
		);
		expect(console.info).toHaveBeenCalledWith(
			"[web-access]",
			expect.objectContaining({ provider: "exa", operation: "read", outcome: "success" }),
		);
	});

	it("tests SearXNG search and reports reading as built-in only without a connection", async () => {
		const result = await probeWebAccess(null, { userId: "user", region: "AU" });
		expect(result).toEqual({ search: { success: true }, read: { success: false, error: "unavailable" } });
		expect(requests.map((request) => [request.provider, request.operation])).toEqual([["searxng", "search"]]);
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

describe("explicit alternate search", () => {
	it.each(PROVIDERS.flatMap((provider) => [401, 402].map((status) => ({ provider, status }))))(
		"uses the approved alternate after $provider returns $status",
		async ({ provider, status: failure }) => {
			searchStatus = failure;
			const alternate = [{ url: URL, title: "Retrieved alternate source" }];
			const fallbackSearch = vi.fn(async (_query: string, _region: string | undefined, signal: AbortSignal) => {
				signal.throwIfAborted();
				return alternate;
			});
			expect(await searchWeb("designer", { ...context(provider), fallbackSearch })).toEqual(alternate);
			expect(requests).toHaveLength(1);
			expect(fallbackSearch).toHaveBeenCalledExactlyOnceWith("designer", undefined, expect.any(AbortSignal));
		},
	);

	it.each([200, 429, 500])("does not reroute success, throttling or outage (%s)", async (failure) => {
		searchStatus = failure;
		const fallbackSearch = vi.fn(async () => [{ url: URL, title: "Must not be used" }]);
		const request = searchWeb("designer", { ...context("firecrawl"), fallbackSearch });
		if (failure === 200) await expect(request).resolves.toHaveLength(1);
		else await expect(request).rejects.toMatchObject({ reason: failure === 429 ? "rate-limit" : "unreachable" });
		expect(fallbackSearch).not.toHaveBeenCalled();
	});

	it("retains regional queries, ordering and the shared deadline for the failed region", async () => {
		respond = ({ body }) =>
			body.country === "germany" ? { status: 401 } : { body: resultsFor("tavily", [job("France")]) };
		const fallbackSearch = vi.fn(async (query: string, region: string | undefined, signal: AbortSignal) => {
			signal.throwIfAborted();
			expect(query).toBe("designer DE");
			expect(region).toBe("DE");
			return [job("Germany")];
		});
		expect(
			await searchWeb(
				"designer",
				{ ...context("tavily"), regions: ["DE", "FR"], fallbackSearch },
				(region) => `designer ${region}`,
			),
		).toEqual([job("Germany"), job("France")]);
		expect(fallbackSearch).toHaveBeenCalledTimes(1);
	});

	it("an abort after the failed response prevents the alternate", async () => {
		const controller = new AbortController();
		searchStatus = 401;
		onRequest = () => controller.abort(new DOMException("Stopped", "AbortError"));
		const fallbackSearch = vi.fn(async () => [job("Must not be used")]);
		await expect(
			searchWeb("designer", { ...context("firecrawl"), signal: controller.signal, fallbackSearch }),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(fallbackSearch).not.toHaveBeenCalled();
	});

	it("does not bypass the request rate budget", async () => {
		vi.stubEnv("NODE_ENV", "production");
		fixtures.limit.mockResolvedValue({ success: false });
		const fallbackSearch = vi.fn(async () => [job("Must not be used")]);
		await expect(searchWeb("designer", { ...context("firecrawl"), fallbackSearch })).rejects.toMatchObject({
			reason: "rate-limit",
		});
		expect(requests).toHaveLength(0);
		expect(fallbackSearch).not.toHaveBeenCalled();
	});
});
