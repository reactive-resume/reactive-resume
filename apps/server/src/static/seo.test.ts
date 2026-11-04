import { describe, expect, it, vi } from "vite-plus/test";
import { supportedLocales } from "@reactive-resume/utils/locale";

vi.mock("@reactive-resume/env/server", () => ({ env: { APP_URL: "https://rxresu.me/" } }));
vi.mock("@reactive-resume/api/features/resume/web-page", () => ({
	listIndexableResumes: async () => [
		{ username: "tess", slug: "game-dev", isPrimary: true, updatedAt: new Date("2026-10-01T00:00:00Z") },
		{ username: "tess", slug: "level-design", isPrimary: false, updatedAt: new Date("2026-10-02T00:00:00Z") },
	],
}));

const { handlePagesSitemap, handleResumesSitemap } = await import("./seo");

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
