import { lookup } from "node:dns/promises";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	allPublic,
	assertPublicPageUrl,
	fetchJobPosting,
	htmlToText,
	readJobPosting,
	searchJobPostings,
} from "./posting";

const config = { apiUrl: "", apiKey: "" };
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
vi.mock("node:https", () => ({
	request: (_url: unknown, _options: unknown, callback: (response: EventEmitter) => void) => {
		const request = new EventEmitter();
		return Object.assign(request, {
			end: () => {
				const response = Object.assign(new EventEmitter(), {
					statusCode: 200,
					headers: { "content-type": "text/html" },
				});
				callback(response);
				response.emit("data", Buffer.from("<h1>Direct posting</h1><p>Work on accessible products.</p>"));
				response.emit("end");
			},
		});
	},
}));

describe("posting links", () => {
	it("accepts only public https pages", () => {
		expect(assertPublicPageUrl("https://jobs.example.com/a#apply").toString()).toBe("https://jobs.example.com/a");
		for (const url of [
			"http://jobs.example.com/a",
			"https://user:pass@jobs.example.com/a",
			"https://localhost/a",
			"https://127.0.0.1/a",
			"https://10.0.0.8/a",
			"https://[::1]/a",
			"ftp://jobs.example.com/a",
		]) {
			expect(() => assertPublicPageUrl(url), url).toThrow();
		}
	});

	it("refuses a host when any address it resolves to is private", () => {
		expect(allPublic([{ address: "93.184.216.34" }])).toBe(true);
		expect(allPublic([{ address: "93.184.216.34" }, { address: "192.168.1.4" }])).toBe(false);
		expect(allPublic([])).toBe(false);
	});
});

describe("htmlToText", () => {
	it("keeps the words and line breaks, and drops scripts, styles and entities", () => {
		const html =
			"<head><title>x</title></head><h1>Designer</h1><p>Figma &amp; research</p><script>alert(1)</script><ul><li>5+ years</li></ul>";
		expect(htmlToText(html)).toBe("Designer\nFigma & research\n5+ years");
	});
});

describe("readJobPosting", () => {
	it("reads a JobPosting from the page's JSON-LD, including inside a graph", () => {
		const html = `<script type="application/ld+json">${JSON.stringify({
			"@graph": [
				{ "@type": "Organization", name: "Ignore" },
				{
					"@type": "JobPosting",
					title: "Senior Product Designer",
					hiringOrganization: { name: "Lumen Health" },
					jobLocation: { address: { addressLocality: "Berlin", addressCountry: "DE" } },
					description: "<p>Design calm tools.</p><ul><li>Figma</li></ul>",
				},
			],
		})}</script>`;

		expect(readJobPosting(html)).toEqual({
			role: "Senior Product Designer",
			company: "Lumen Health",
			location: "Berlin, DE",
			description: "Design calm tools.\nFigma",
		});
	});
});

describe("optional Firecrawl posting reader", () => {
	let endpoint = "";
	let status = 200;
	let response: unknown;
	const requests: { path: string; authorization: string | undefined; body: Record<string, unknown> }[] = [];
	const server = createServer(async (request, result) => {
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(chunk);
		requests.push({
			path: request.url ?? "",
			authorization: request.headers.authorization,
			body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
		});
		result.writeHead(status, { "content-type": "application/json" });
		result.end(JSON.stringify(response));
	});
	beforeAll(async () => {
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("No test server address");
		endpoint = `http://127.0.0.1:${address.port}`;
	});
	afterAll(async () => {
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	});
	beforeEach(() => {
		config.apiUrl = endpoint;
		config.apiKey = "test-firecrawl-key";
		vi.mocked(lookup).mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
		requests.length = 0;
		status = 200;
		response = { success: true, data: { markdown: "# Rendered role\n\nReact and accessibility" } };
	});

	it("reads rendered Markdown through the v2 API and caps saved text", async () => {
		response = { success: true, data: { markdown: `# Rendered role\n${"x".repeat(25_000)}` } };
		const posting = await fetchJobPosting("https://jobs.example.com/role#apply", config);
		expect(posting.page).toBeNull();
		expect(posting.text).toHaveLength(20_000);
		expect(posting.text).toMatch(/^# Rendered role/);
		expect(requests[0]).toMatchObject({
			path: "/v2/scrape",
			authorization: "Bearer test-firecrawl-key",
			body: { url: "https://jobs.example.com/role", formats: ["markdown", "rawHtml"], skipTlsVerification: false },
		});
	});

	it("keeps page fields available without an AI provider and accepts a keyless local service", async () => {
		config.apiKey = "";
		response = {
			success: true,
			data: {
				markdown: "Navigation and other content",
				rawHtml: `<script type="application/ld+json">${JSON.stringify({
					"@type": "JobPosting",
					title: "Designer",
					hiringOrganization: { name: "Example" },
					description: "<p>Design accessible products.</p>",
				})}</script>`,
			},
		};
		expect(await fetchJobPosting("https://jobs.example.com/role", config)).toMatchObject({
			page: { role: "Designer", company: "Example" },
			text: "Design accessible products.",
		});
		expect(requests[0]?.authorization).toBeUndefined();
	});

	it.each(["disabled", "http-error", "empty", "malformed", "too-large"])(
		"uses the direct reader when Firecrawl is %s",
		async (failure) => {
			if (failure === "disabled") {
				config.apiUrl = "";
				config.apiKey = "";
			}
			if (failure === "http-error") status = 503;
			if (failure === "empty") response = { success: true, data: { markdown: " " } };
			if (failure === "malformed") response = { success: false };
			if (failure === "too-large") response = { success: true, data: { markdown: "x".repeat(2_000_001) } };
			expect(await fetchJobPosting("https://jobs.example.com/role", failure === "disabled" ? null : config)).toEqual({
				page: null,
				text: "Direct posting\nWork on accessible products.",
			});
			if (failure === "disabled") expect(requests).toHaveLength(0);
		},
	);

	it("blocks private targets and DNS answers before sending anything to Firecrawl", async () => {
		await expect(fetchJobPosting("https://127.0.0.1/private", config)).rejects.toMatchObject({ reason: "unsafe-url" });
		vi.mocked(lookup).mockResolvedValue([{ address: "10.0.0.1", family: 4 }] as never);
		await expect(fetchJobPosting("https://jobs.example.com/private", config)).rejects.toMatchObject({
			reason: "unsafe-url",
		});
		expect(requests).toHaveLength(0);
	});

	it("returns public posting links from v2 search, dropping unsafe and malformed results", async () => {
		response = {
			success: true,
			data: {
				web: [
					{ url: "https://jobs.example.com/designer", title: "Designer", description: "Berlin" },
					{ url: "https://localhost/private", title: "Internal" },
					{ url: "javascript:alert(1)", title: "Unsafe" },
					{ url: "http://example.com/insecure", title: "Insecure" },
					{ url: "https://jobs.example.com/other" },
				],
			},
		};
		expect(await searchJobPostings("designer Berlin", config)).toEqual([
			{ url: "https://jobs.example.com/designer", title: "Designer", description: "Berlin" },
		]);
		expect(requests[0]).toMatchObject({
			path: "/v2/search",
			body: { query: "designer Berlin job posting", limit: 5, sources: ["web"] },
		});
	});
});
