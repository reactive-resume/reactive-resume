import { describe, expect, it, vi } from "vite-plus/test";
import { readPage, searchWeb } from "../web-access/service";
import { fetchJobPosting, htmlToText, readJobPosting, readOpenPosting, searchJobPostings } from "./posting";

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
	it("does not select an arbitrary role from a multi-job page", () => {
		const html = `<script type="application/ld+json">${JSON.stringify([
			{ "@type": "JobPosting", title: "Designer" },
			{ "@type": "JobPosting", title: "Engineer" },
		])}</script>`;
		expect(readJobPosting(html)).toBeNull();
	});
	it("keeps distinct same-title jobs ambiguous but collapses equivalent duplicated SEO records", () => {
		const one = {
			"@type": "JobPosting",
			title: "Engineer",
			hiringOrganization: { name: "Fictional Co" },
			url: "https://jobs.example.test/one",
			description: "Berlin job",
		};
		const html = (items: object[]) => `<script type="application/ld+json">${JSON.stringify(items)}</script>`;
		expect(
			readJobPosting(html([one, { ...one, url: "https://jobs.example.test/two", description: "Paris job" }])),
		).toBeNull();
		expect(
			readJobPosting(
				html([
					one,
					{
						description: one.description,
						url: one.url,
						hiringOrganization: one.hiringOrganization,
						title: one.title,
						"@type": one["@type"],
					},
				]),
			),
		).toMatchObject({ description: "Berlin job" });
	});

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
			closesAt: "",
		});
	});
});

describe("readOpenPosting", () => {
	const posting = (fields: object = {}) => ({ "@type": "JobPosting", title: "Designer", ...fields });
	// null: not a role. A string: a role, with the company its address names when the page has no JobPosting data.
	it.each([
		["one posting", "https://lumen.example/careers/designer", [posting()], ""],
		["a list of postings", "https://lumen.example/careers", [posting(), posting({ title: "Engineer" })], null],
		["a closed posting", "https://lumen.example/careers/designer", [posting({ validThrough: "2020-01-01" })], null],
		["a careers page", "https://lumen.example/careers", [], null],
		["a Lever posting", "https://jobs.lever.co/lumen/0c5b9e8a-3f7e-4a43-9d36-0d4c1b1e2f3a", [], "lumen"],
		[
			"a LinkedIn posting",
			"https://www.linkedin.com/jobs/view/senior-designer-at-simple-club-4264843261",
			[],
			"simple club",
		],
	])("%s: %j", async (_name, url, postings, expected) => {
		vi.mocked(readPage).mockResolvedValue({
			requestedUrl: url,
			content: "Page text",
			html: postings.map((item) => `<script type="application/ld+json">${JSON.stringify(item)}</script>`).join(""),
			format: "text",
			retrievedAt: "2026-09-30T12:00:00.000Z",
			method: "builtin",
			truncated: false,
			completeness: "unknown",
		});
		expect((await readOpenPosting(url, { connection: null, userId: "user" }))?.company ?? null).toBe(expected);
	});
});

describe("posting retrieval", () => {
	it("rejects a board search page instead of sending its many roles for extraction", async () => {
		vi.mocked(readPage).mockResolvedValue({
			requestedUrl: "https://www.linkedin.com/jobs/search/",
			content: "Many jobs",
			format: "text",
			retrievedAt: "2026-10-08T12:00:00Z",
			method: "builtin",
			truncated: false,
			completeness: "unknown",
		});
		await expect(
			fetchJobPosting("https://www.linkedin.com/jobs/search/", { userId: "user", connection: null }),
		).rejects.toMatchObject({ reason: "not-a-page" });
	});
	it("omits aggregate search results while preserving individual postings", async () => {
		vi.mocked(searchWeb).mockResolvedValue([
			{ url: "https://www.linkedin.com/jobs/search/?keywords=designer", title: "Designer jobs" },
			{ url: "https://jobs.lever.co/acme", title: "Acme roles" },
			{ url: "https://board.example/designer", title: "100 Designer Jobs in Berlin" },
			{ url: "https://www.linkedin.com/jobs/view/123456", title: "Designer at Acme" },
		]);
		expect(await searchJobPostings("designer", { userId: "user", connection: null })).toEqual([
			{ url: "https://www.linkedin.com/jobs/view/123456", title: "Designer at Acme", description: "" },
		]);
	});
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
		expect(searchWeb).toHaveBeenCalledWith("designer Berlin job posting", context, expect.any(Function));
	});
});
