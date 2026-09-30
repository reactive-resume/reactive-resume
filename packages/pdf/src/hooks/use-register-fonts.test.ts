import type { PdfFontRequest } from "./use-register-fonts";
import type { ResumeData, Typography } from "@reactive-resume/schema/resume/data";
import { describe, expect, it } from "vitest";
import { getWebFontSource } from "@reactive-resume/fonts";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { resolvePdfFonts, resumeContentScripts } from "./use-register-fonts";

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
		expect(registerFonts(configured, "de-DE", false, new Set(["emoji"])).hyphenation).toBe(true);
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

		const pdfTypography = registerFonts(typography, "en-US", false, new Set(["emoji"]));

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
