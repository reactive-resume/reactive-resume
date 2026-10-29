import { describe, expect, it } from "vite-plus/test";
import { getLocaleAlternates, isLocale, localeSchema, localizedUrl, supportedLocales } from "./locale";

it("keeps the testing catalog valid without counting it as a supported translation", () => {
	expect(isLocale("zu-ZA")).toBe(true);
	expect(localeSchema.options).toContain("zu-ZA");
	expect(supportedLocales).not.toContain("zu-ZA");
	expect(supportedLocales).toContain("de-DE");
	expect(getLocaleAlternates("https://rxresu.me/")).toHaveLength(supportedLocales.length + 1);
});

describe("locale URLs", () => {
	it("keeps the default locale on the plain address and puts others in the locale parameter", () => {
		expect(localizedUrl("https://rxresu.me/?locale=de-DE", "en-US")).toBe("https://rxresu.me/");
		expect(localizedUrl("https://rxresu.me/", "de-DE")).toBe("https://rxresu.me/?locale=de-DE");
	});

	it("lists valid hreflang alternates without the pseudo-locale", () => {
		const alternates = getLocaleAlternates("https://rxresu.me/");

		expect(alternates).toContainEqual({ hreflang: "x-default", href: "https://rxresu.me/" });
		expect(alternates).toContainEqual({ hreflang: "sr", href: "https://rxresu.me/?locale=sr-SP" });
		expect(alternates.map((alternate) => alternate.hreflang)).not.toContain("zu-ZA");
	});
});
