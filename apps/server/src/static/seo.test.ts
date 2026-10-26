import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@reactive-resume/env/server", () => ({ env: { APP_URL: "https://rxresu.me/" } }));

const { handlePagesSitemap, handleLlms } = await import("./seo");

it("publishes Context7 Ask after the llms title and summary", async () => {
	const text = await handleLlms().text();
	expect(text).toMatch(
		/^# Reactive Resume\n\n> [^\n]+\n\n## Search\n\nThis site has a search endpoint: https:\/\/context7.com\/api\/v2\/ask\?siteKey=ask_b3fd9335a63f1b21b1a814ac&query=<URL-encoded question>\./,
	);
	expect(text).toContain(
		"It returns documentation that answers the question, with a source link for each part. No API key is needed. If nothing matches, it says so.\n\n## Product",
	);
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
		expect(entries).toHaveLength(162); // Three public pages, 54 real locales; x-default shares English's URL.
		expect(new Set(locations).size).toBe(entries.length);
		for (const path of ["/", "/ats-checker", "/resume-templates"]) {
			const base = `https://rxresu.me${path}`;
			expect(locations).toContain(base);
			expect(locations).toContain(`${base}?locale=de-DE`);
			expect(locations).toContain(`${base}?locale=ar-SA`);
			expect(locations).toContain(`${base}?locale=en-GB`);
			const group = entries.filter((entry) => entry.loc?.split("?")[0] === base);
			expect(group).toHaveLength(54);
			for (const entry of group) {
				expect(entry.alternates).toHaveLength(55);
				expect(entry.alternates).toEqual(group[0]?.alternates);
				expect(entry.alternates).toContainEqual({ language: "x-default", href: base });
				expect(entry.alternates).toContainEqual({ language: "sr", href: `${base}?locale=sr-SP` });
				for (const alternate of entry.alternates) expect(locations).toContain(alternate.href);
			}
		}
		expect(xml).not.toContain("zu-ZA");
		expect(xml).not.toContain("/dashboard");
	});
});
