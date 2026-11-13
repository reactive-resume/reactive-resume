import { describe, expect, it, vi } from "vite-plus/test";
import { supportedLocales } from "@reactive-resume/utils/locale";

const mocks = vi.hoisted(() => ({ env: { APP_URL: "https://rxresu.me/" } }));

vi.mock("@reactive-resume/env/server", () => ({ env: mocks.env }));
vi.mock("@reactive-resume/api/features/resume/web-page", () => ({
	listIndexableResumes: async () => [
		{ username: "tess", slug: "game-dev", isPrimary: true, updatedAt: new Date("2026-10-01T00:00:00Z") },
		{ username: "tess", slug: "level-design", isPrimary: false, updatedAt: new Date("2026-10-02T00:00:00Z") },
	],
}));

const { handleLlms, handlePagesSitemap, handleResumesSitemap } = await import("./seo");

it("keeps search documentation in llms.txt with instance-local product and API links", async () => {
	mocks.env.APP_URL = "https://resume.example.test/";
	try {
		const response = handleLlms();
		const text = await response.text();
		expect(response.headers.get("Content-Type")).toBe("text/plain; charset=UTF-8");
		expect(text).toContain("## Search\n\nThis site has a search endpoint: https://context7.com/api/v2/ask?");
		expect(text).toContain("[Homepage](https://resume.example.test/)");
		expect(text).toContain("[Get started](https://resume.example.test/dashboard)");
		expect(text).toContain("[OpenAPI specification](https://resume.example.test/openapi.json)");
		expect(text).not.toContain("https://rxresu.me");
	} finally {
		mocks.env.APP_URL = "https://rxresu.me/";
	}
});

it("lists each indexed resume at its canonical address: the primary at /<username>", async () => {
	const xml = await (await handleResumesSitemap(1)).text();
	expect([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])).toEqual([
		"https://rxresu.me/tess",
		"https://rxresu.me/tess/level-design",
	]);
});

describe("localized sitemap", () => {
	it("gives every localized public page its own entry with reciprocal alternates", async () => {
		const response = handlePagesSitemap();
		const xml = await response.text();
		const entries = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((match) => ({
			loc: match[1]?.match(/<loc>(.*?)<\/loc>/)?.[1],
			alternates: [...(match[1] ?? "").matchAll(/hreflang="([^"]+)" href="([^"]+)"/g)].map((link) => ({
				language: link[1],
				href: link[2],
			})),
		}));
		const locations = entries.map((entry) => entry.loc);

		expect(response.headers.get("Content-Type")).toBe("application/xml; charset=UTF-8");
		// Three public pages, one entry per supported locale; x-default shares English's URL.
		expect(entries).toHaveLength(3 * supportedLocales.length);
		expect(new Set(locations).size).toBe(entries.length);
		for (const path of ["/", "/ats-checker", "/resume-templates"]) {
			const base = `https://rxresu.me${path}`;
			expect(locations).toContain(base);
			const group = entries.filter((entry) => entry.loc?.split("?")[0] === base);
			expect(group).toHaveLength(supportedLocales.length);
			for (const entry of group) {
				expect(entry.alternates).toHaveLength(supportedLocales.length + 1);
				expect(entry.alternates).toEqual(group[0]?.alternates);
				for (const alternate of entry.alternates) expect(locations).toContain(alternate.href);
			}
		}
		expect(xml).not.toContain("/dashboard");
	});
});
