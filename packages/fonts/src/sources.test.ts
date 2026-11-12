import { describe, expect, it } from "vite-plus/test";
import { fontList } from "./index";
import { fontMirrorPath, normalizeFontMirrorUrl, resolveFontSource } from "./sources";

describe("catalog mirror sources", () => {
	it("maps every catalog face and preview into the mirror without changing the original catalog", () => {
		const base = "https://fonts.example.com/resume";
		const paths = new Map<string, string>();
		for (const font of fontList) {
			if (font.type !== "web") continue;
			for (const source of [font.preview, ...Object.values(font.files)]) {
				const path = fontMirrorPath(source);
				expect(paths.get(path) ?? source).toBe(source);
				paths.set(path, source);
				expect(resolveFontSource(source, ` ${base}/// `)).toBe(`${base}/${path}`);
				expect(resolveFontSource(source)).toBe(source);
			}
		}
	});

	it("uses one canonical path for Google's alternate delivery host", () => {
		expect(fontMirrorPath("https://fonts.gstatic.cn/s/font/v1/a.ttf")).toBe("fonts.gstatic.com/s/font/v1/a.ttf");
	});

	it.each([
		"https://user:pass@fonts.example.com",
		"https://fonts.example.com?secret=a",
		"https://fonts.example.com#x",
		"file:///fonts",
		"/fonts",
	])("rejects unsafe or ambiguous public configuration %s", (value) => {
		expect(() => normalizeFontMirrorUrl(value)).toThrow();
	});

	it("refuses uncatalogued origins instead of providing an arbitrary URL proxy", () => {
		expect(() => fontMirrorPath("https://other.example/file.ttf")).toThrow();
	});
});
