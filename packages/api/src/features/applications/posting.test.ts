import { describe, expect, it, vi } from "vitest";
import { readPage, searchWeb } from "../web-access/service";
import { fetchJobPosting, htmlToText, readJobPosting, searchJobPostings } from "./posting";

vi.mock("../web-access/service", () => ({
	readPage: vi.fn(),
	searchWeb: vi.fn(),
}));

describe("htmlToText", () => {
	it.each(["&#x110000;", "&#999999999;", "&#xD800;", "&#0;"])("retains invalid numeric entity %s as text", (entity) => {
		expect(htmlToText(`<p>Role ${entity} description</p>`)).toBe(`Role ${entity} description`);
	});
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
					jobLocation: {
						address: { addressLocality: "Berlin", addressCountry: "DE" },
					},
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

describe("posting retrieval", () => {
	it.each(["broken JSON", { "@graph": { unrelated: true } }, { "@graph": "not an array" }, null])(
		"preserves retrieved text when page metadata is malformed: %j",
		async (metadata) => {
			vi.mocked(readPage).mockResolvedValue({
				requestedUrl: "https://jobs.example.com/role",
				content: "Designer\nWork on accessible products.",
				html: `<h1>Designer</h1><p>Work on accessible products.</p><script type="application/ld+json">${typeof metadata === "string" ? metadata : JSON.stringify(metadata)}</script>`,
				format: "text",
				retrievedAt: "2026-09-30T12:00:00.000Z",
				method: "builtin",
				truncated: false,
				completeness: "unknown",
			});
			expect(
				await fetchJobPosting("https://jobs.example.com/role", {
					userId: "user",
					connection: null,
				}),
			).toMatchObject({
				page: null,
				text: "Designer\nWork on accessible products.",
				source: {
					method: "builtin",
					truncated: false,
					completeness: "unknown",
				},
			});
		},
	);

	it("retains page fields and marks a bounded structured description as incomplete", async () => {
		vi.mocked(readPage).mockResolvedValue({
			requestedUrl: "https://jobs.example.com/role",
			content: "Other page content",
			html: `<script type="application/ld+json">${JSON.stringify({
				"@type": "JobPosting",
				title: "Designer",
				hiringOrganization: { name: "Example" },
				description: `<p>${"x".repeat(20_001)}</p>`,
			})}</script>`,
			format: "markdown",
			retrievedAt: "2026-09-30T12:00:00.000Z",
			method: "firecrawl",
			truncated: false,
			completeness: "unknown",
		});
		const result = await fetchJobPosting("https://jobs.example.com/role", {
			userId: "user",
			connection: null,
		});
		expect(result.page).toMatchObject({ role: "Designer", company: "Example" });
		expect(result.text).toHaveLength(20_000);
		expect(result.source).toMatchObject({
			method: "firecrawl",
			format: "text",
			truncated: true,
			completeness: "incomplete",
		});
		expect(result.source).not.toHaveProperty("html");
		expect(result.source).not.toHaveProperty("content");
	});

	it("applies job query intent only in Applications and maps the existing result contract", async () => {
		vi.mocked(searchWeb).mockResolvedValue([
			{
				url: "https://jobs.example.com/role",
				title: "Designer",
				snippet: "Berlin",
			},
		]);
		const context = { userId: "user", connection: null };
		expect(await searchJobPostings("designer Berlin", context)).toEqual([
			{
				url: "https://jobs.example.com/role",
				title: "Designer",
				description: "Berlin",
			},
		]);
		expect(searchWeb).toHaveBeenCalledWith("designer Berlin job posting", context);
	});
});
