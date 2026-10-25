import type { PdfFontRequest } from "./use-register-fonts";
import type { ResumeData, Typography } from "@reactive-resume/schema/resume/data";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { getWebFontSource } from "@reactive-resume/fonts";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { resolvePdfFonts, resumeContentScripts, resumeUsesItalic } from "./use-register-fonts";

const typography = {
	body: {
		fontSize: 10,
		fontFamily: "IBM Plex Serif",
		lineHeight: 1.5,
		fontWeights: ["400", "500"],
	},
	heading: {
		fontSize: 14,
		fontFamily: "IBM Plex Serif",
		lineHeight: 1.5,
		fontWeights: ["600"],
	},
} satisfies Typography;

/** The typography for the PDF, with every face it asked for collected in `registered`. */
const withRegistry = () => {
	const registered: PdfFontRequest[] = [];
	const registerFonts = (...args: Parameters<typeof resolvePdfFonts>) => {
		const { typography: pdfTypography, fonts } = resolvePdfFonts(...args);
		registered.push(...fonts);
		return pdfTypography;
	};
	return { registered, registerFonts };
};

describe("resolvePdfFonts", () => {
	it("retains the hyphenation preference when adding fallback font stacks", () => {
		const { registerFonts } = withRegistry();
		const configured = { ...typography, hyphenation: true };
		expect(registerFonts(configured, "de-DE", new Set(["emoji"])).hyphenation).toBe(true);
		expect(registerFonts(configured, "zh-CN").hyphenation).toBe(true);
	});

	it("registers CJK PDF fallbacks for normal and italic text styles", () => {
		const cjkFallbackSource = getWebFontSource("Noto Serif SC", "400", false);
		const { registered, registerFonts } = withRegistry();

		const pdfTypography = registerFonts(typography, "zh-CN");

		expect(pdfTypography.body.fontFamily).toEqual(["IBM Plex Serif", "Noto Serif SC", "Noto Serif"]);
		expect(pdfTypography.heading.fontFamily).toEqual(["IBM Plex Serif", "Noto Serif SC", "Noto Serif"]);

		expect(registered).toContainEqual(
			expect.objectContaining({
				family: "Noto Serif SC",
				weight: 400,
				italic: false,
			}),
		);
		expect(registered).toContainEqual(
			expect.objectContaining({
				family: "Noto Serif SC",
				weight: 400,
				italic: true,
				src: cjkFallbackSource,
			}),
		);
		// Each Noto CJK face is ~15 MB: the 500 body and 600 heading draw with the nearest face (#3593).
		const cjkWeights = new Set(registered.filter((font) => font.family === "Noto Serif SC").map((font) => font.weight));
		expect([...cjkWeights].sort()).toEqual([400, 700]);
	});

	it("downloads only Regular and Bold of a CJK body or heading font (#3627)", () => {
		const { registered, registerFonts } = withRegistry();
		const cjkTypography = {
			...typography,
			body: { ...typography.body, fontFamily: "Noto Serif SC", fontWeights: ["400", "600"] },
			heading: { ...typography.heading, fontFamily: "Noto Sans SC", fontWeights: ["600"] },
		} satisfies Typography;

		registerFonts(cjkTypography, "zh-CN", new Set(["han-simplified"]), false);

		const cjkFaces = registered
			.filter((font) => font.family.endsWith(" SC"))
			.map((font) => `${font.family} ${font.weight}`)
			.sort();
		expect(cjkFaces).toEqual(["Noto Sans SC 700", "Noto Serif SC 400", "Noto Serif SC 700"]);
	});

	it("registers the family's true Bold face when the stored weights stop below it (#3310)", () => {
		const { registered, registerFonts } = withRegistry();

		// Open Sans stored with the default Regular+SemiBold pairing: bold
		// styles resolve to 700, so that face must be registered or
		// @react-pdf/renderer would silently fall back to the nearest weight.
		const openSansTypography = {
			...typography,
			body: { ...typography.body, fontFamily: "Open Sans", fontWeights: ["400", "600"] },
			heading: { ...typography.heading, fontFamily: "Open Sans", fontWeights: ["400", "600"] },
		} satisfies Typography;

		registerFonts(openSansTypography, "en-US");

		expect(registered).toContainEqual(expect.objectContaining({ family: "Open Sans", weight: 700, italic: false }));
		expect(registered).toContainEqual(expect.objectContaining({ family: "Open Sans", weight: 700, italic: true }));
	});

	it("registers the Noto Emoji fallback when content contains emoji (#3321)", () => {
		const emojiSource = getWebFontSource("Noto Emoji", "400", false);
		const { registered, registerFonts } = withRegistry();

		const pdfTypography = registerFonts(typography, "en-US", new Set(["emoji"]));

		expect(pdfTypography.body.fontFamily).toEqual(["IBM Plex Serif", "Noto Emoji", "Noto Serif"]);
		expect(registered).toContainEqual(
			expect.objectContaining({
				family: "Noto Emoji",
				weight: 400,
				italic: false,
				src: emojiSource,
			}),
		);
		// Emoji is not CJK: no Simplified-Chinese safety net, no per-character breaking.
		expect(registered).not.toContainEqual(expect.objectContaining({ family: "Noto Serif SC" }));
	});

	it("registers the Noto Sans Symbols fallback for arrows without downloading Symbols 2", () => {
		const { registered, registerFonts } = withRegistry();
		const pdfTypography = registerFonts(typography, "en-US", new Set(["arrows"]));
		expect(pdfTypography.body.fontFamily).toEqual(["IBM Plex Serif", "Noto Sans Symbols", "Noto Serif"]);
		expect(registered).toContainEqual({
			family: "Noto Sans Symbols",
			weight: 400,
			italic: false,
			src: getWebFontSource("Noto Sans Symbols", "400", false),
		});
		expect(registered).not.toContainEqual(expect.objectContaining({ family: "Noto Sans Symbols 2" }));
	});

	it("registers the Noto Sans Symbols 2 fallback for text symbols like stars", () => {
		const symbolsSource = getWebFontSource("Noto Sans Symbols 2", "400", false);
		const { registered, registerFonts } = withRegistry();

		const pdfTypography = registerFonts(typography, "en-US", new Set(["symbols"]));

		expect(pdfTypography.body.fontFamily).toEqual(["IBM Plex Serif", "Noto Sans Symbols 2", "Noto Serif"]);
		expect(registered).toContainEqual(
			expect.objectContaining({
				family: "Noto Sans Symbols 2",
				weight: 400,
				italic: false,
				src: symbolsSource,
			}),
		);
	});

	it("registers the fallback family's true Bold face when primary bold exceeds stored weights (#3310)", () => {
		const { registered, registerFonts } = withRegistry();

		const openSansTypography = {
			...typography,
			body: { ...typography.body, fontFamily: "Open Sans", fontWeights: ["400", "600"] },
			heading: { ...typography.heading, fontFamily: "Open Sans", fontWeights: ["400", "600"] },
		} satisfies Typography;

		registerFonts(openSansTypography, "zh-CN");

		expect(registered).toContainEqual(expect.objectContaining({ family: "Noto Sans SC", weight: 700, italic: false }));
		expect(registered).toContainEqual(expect.objectContaining({ family: "Noto Sans SC", weight: 700, italic: true }));
	});

	it("registers a punctuation fallback for Latin locale and Latin content (#3190)", () => {
		const { registered, registerFonts } = withRegistry();

		const pdfTypography = registerFonts(typography, "en-US");

		expect(pdfTypography.body.fontFamily).toEqual(["IBM Plex Serif", "Noto Serif"]);
		expect(pdfTypography.heading.fontFamily).toEqual(["IBM Plex Serif", "Noto Serif"]);
		expect(registered).toContainEqual(expect.objectContaining({ family: "Noto Serif" }));
	});

	it("replaces unsupported font weights with an available fallback pair", () => {
		const { registered, registerFonts } = withRegistry();

		const migratedTypography = {
			...typography,
			body: { ...typography.body, fontFamily: "Lato", fontWeights: ["400"] },
			heading: { ...typography.heading, fontFamily: "Lato", fontWeights: ["600"] },
		} satisfies Typography;

		const pdfTypography = registerFonts(migratedTypography, "en-US");

		expect(pdfTypography.body.fontWeights).toEqual(["400"]);
		expect(pdfTypography.heading.fontWeights).toEqual(["400", "700"]);
		expect(registered).not.toContainEqual(expect.objectContaining({ family: "Lato", weight: 600 }));
		expect(registered).toContainEqual(expect.objectContaining({ family: "Lato", weight: 700 }));
	});
});

describe("resumeContentScripts", () => {
	const withSummary = (content: string): ResumeData => ({
		...defaultResumeData,
		summary: { ...defaultResumeData.summary, content: `<p>${content}</p>` },
	});

	it("detects emoji flags and pictographs (#3321)", () => {
		const data = {
			...defaultResumeData,
			basics: { ...defaultResumeData.basics, location: "Berlin \u{1F1E9}\u{1F1EA} \u{1F310} \u{2B50}" },
		} satisfies ResumeData;

		const scripts = resumeContentScripts(data);
		expect(scripts.has("emoji")).toBe(true);
		// Regional indicators are not Extended_Pictographic and pictographs are
		// not any other script — the emoji detector must catch both alone.
		expect(scripts.size).toBe(1);
	});

	it("detects keycap emoji without pictographs (#3321)", () => {
		// "1\uFE0F\u20E3" (1\u20e3) and "#\uFE0F\u20E3" (#\u20e3) hold no regional
		// indicator and no Extended_Pictographic codepoint, so the detector must
		// catch the combining enclosing keycap on its own.
		const data = {
			...defaultResumeData,
			basics: {
				...defaultResumeData.basics,
				location: "Steps \u0031\uFE0F\u20E3 and \u0023\uFE0F\u20E3",
			},
		} satisfies ResumeData;

		const scripts = resumeContentScripts(data);
		expect(scripts.has("emoji")).toBe(true);
		expect(scripts.size).toBe(1);
	});

	it("detects text-symbol arrows for the dedicated arrows fallback (#3608)", () => {
		// U+2192 (→) needs Noto Sans Symbols; Symbols 2 does not contain it.
		const scripts = resumeContentScripts(withSummary("Hours → Minutes"));
		expect(scripts.has("arrows")).toBe(true);
		// The arrow is a text symbol, not emoji or any other script.
		expect(scripts.size).toBe(1);
		// U+21E6 (⇦) is outside Noto Sans Symbols, so it stays on Symbols 2.
		expect(resumeContentScripts(withSummary("⇦"))).toEqual(new Set(["symbols"]));
	});

	it("keeps pictographic arrows on the emoji fallback without extra text-symbol fonts", () => {
		expect(resumeContentScripts(withSummary("↔️ ↩️"))).toEqual(new Set(["emoji"]));
	});

	it("detects multiple scripts in mixed content", () => {
		const scripts = resumeContentScripts(withSummary("안녕 翠翠 سلام こんにちは پژوهشگر שלום สวัสดี"));
		expect(scripts.has("hangul")).toBe(true);
		expect(scripts.has("kana")).toBe(true);
		expect(scripts.has("han-simplified")).toBe(true);
		expect(scripts.has("arabic")).toBe(true);
		expect(scripts.has("hebrew")).toBe(true);
		expect(scripts.has("thai")).toBe(true);
	});

	it("returns an empty set for Latin-only content", () => {
		expect(resumeContentScripts(withSummary("Reactive Resume")).size).toBe(0);
	});
});

describe("italic faces", () => {
	const withSummary = (html: string, stylesheet?: string) => {
		const data = structuredClone(defaultResumeData);
		data.summary.content = html;
		if (stylesheet) data.metadata.stylesheet = { mode: "semantic", source: { languageVersion: 1, text: stylesheet } };
		return data;
	};

	// Without them, italic text has no face: CJK italics print as "?" (#3593 follow-up).
	it.each([
		["plain text", withSummary("<p>Plain</p>"), false],
		["rich-text emphasis", withSummary("<p>An <em>emphasised</em> word</p>"), true],
		["a stylesheet", withSummary("<p>Plain</p>", "summary { font-style: italic; }"), true],
	])("are registered only when the resume uses italics: %s", (_, data, italic) => {
		expect(resumeUsesItalic(data)).toBe(italic);
		const fonts = resolvePdfFonts(typography, "en-US", undefined, resumeUsesItalic(data)).fonts;
		expect(fonts.some((font) => font.italic)).toBe(italic);
	});

	it("are never asked for by a template's own styles", () => {
		const templates = new URL("../templates", import.meta.url).pathname;
		const sources = readdirSync(templates, { recursive: true, encoding: "utf8" }).filter(
			(file) => /\.tsx?$/.test(file) && !/\.test\./.test(file),
		);
		const italic = sources.filter((file) =>
			/fontStyle:\s*["']italic["']/.test(readFileSync(join(templates, file), "utf8")),
		);
		expect(italic).toEqual([]);
	});
});
