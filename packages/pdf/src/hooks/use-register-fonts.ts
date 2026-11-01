import type { FontWeight } from "@reactive-resume/fonts";
import type { ResumeData, Typography } from "@reactive-resume/schema/resume/data";
import type { Locale, Script } from "@reactive-resume/utils/locale";
import {
	getFont,
	getPdfFallbackFontFamilies,
	getWebFontSource,
	isCjkFontFamily,
	isStandardPdfFontFamily,
	resolveBoldFontWeight,
	resolveLegacyFontAlias,
	sortFontWeights,
} from "@reactive-resume/fonts";

type FontWeightRange = {
	lowest: number;
	highest: number;
};

const fallbackFontFamily = "IBM Plex Serif";
const fontWeightValues = new Set<FontWeight>(["100", "200", "300", "400", "500", "600", "700", "800", "900"]);
const preferredFallbackFontWeights = ["400", "700", "600", "500"] satisfies FontWeight[];

/** A font face the document needs: its family, weight, style and where its bytes are. */
export type PdfFontRequest = { family: string; weight: number; italic: boolean; src: string };

// `fontFamily` is widened to `string | string[]` so the engine can fall back per glyph, e.g. for CJK (#2986).
export type PdfTypography = Omit<Typography, "body" | "heading"> & {
	body: Omit<Typography["body"], "fontFamily"> & { fontFamily: string | string[] };
	heading: Omit<Typography["heading"], "fontFamily"> & { fontFamily: string | string[] };
};

const getFontWeightRange = (fontWeights: string[]): FontWeightRange => {
	const numericWeights: number[] = [];

	for (const fontWeight of fontWeights) {
		const numericWeight = Number(fontWeight);
		if (Number.isFinite(numericWeight)) numericWeights.push(numericWeight);
	}

	if (numericWeights.length === 0) return { lowest: 400, highest: 700 };

	const lowest = Math.min(...numericWeights);
	const rawHighest = Math.max(...numericWeights);
	const highest = rawHighest <= lowest ? 700 : rawHighest;

	return { lowest, highest };
};

const isFontWeight = (weight: string): weight is FontWeight => fontWeightValues.has(weight as FontWeight);

const uniqueSortedFontWeights = (fontWeights: FontWeight[]): FontWeight[] => {
	return [...new Set(sortFontWeights(fontWeights))];
};

const getFallbackFontWeights = (availableWeights: FontWeight[]): FontWeight[] => {
	const sortedAvailableWeights = uniqueSortedFontWeights(availableWeights);
	const availableWeightSet = new Set(sortedAvailableWeights);
	const preferredWeights = preferredFallbackFontWeights.filter((weight) => availableWeightSet.has(weight));

	if (preferredWeights.length >= 2) {
		return uniqueSortedFontWeights(preferredWeights.slice(0, 2));
	}

	if (preferredWeights.length === 1) {
		const firstWeight = preferredWeights[0];
		if (!firstWeight) return [];

		const secondWeight =
			sortedAvailableWeights.find((weight) => Number(weight) > Number(firstWeight)) ??
			sortedAvailableWeights.find((weight) => weight !== firstWeight);

		return uniqueSortedFontWeights(secondWeight ? [firstWeight, secondWeight] : [firstWeight]);
	}

	return sortedAvailableWeights.slice(0, 2);
};

const resolvePdfFontWeights = (family: string, fontWeights: string[]): FontWeight[] => {
	const requestedWeights = uniqueSortedFontWeights(fontWeights.filter(isFontWeight));
	const availableWeights = getFont(family)?.weights;

	if (!availableWeights || availableWeights.length === 0) {
		return requestedWeights.length > 0 ? requestedWeights : ["400", "700"];
	}

	const availableWeightSet = new Set(availableWeights);
	const allRequestedWeightsAreAvailable =
		requestedWeights.length > 0 && requestedWeights.every((weight) => availableWeightSet.has(weight));

	if (allRequestedWeightsAreAvailable) return requestedWeights;

	return getFallbackFontWeights(availableWeights);
};

const toFontWeight = (weight: number): FontWeight => {
	if (weight <= 100) return "100";
	if (weight <= 200) return "200";
	if (weight <= 300) return "300";
	if (weight <= 400) return "400";
	if (weight <= 500) return "500";
	if (weight <= 600) return "600";
	if (weight <= 700) return "700";
	if (weight <= 800) return "800";
	return "900";
};

// Resolves the user-stored family to the one we hand to Font.register:
// direct match → legacy alias (#2989) → IBM Plex Serif fallback.
const resolvePdfFontFamily = (family: string) => {
	if (getFont(family)) {
		const alias = resolveLegacyFontAlias(family);
		return alias ?? family;
	}
	return fallbackFontFamily;
};

const resolvePdfTypography = (typography: Typography): Typography => {
	const bodyFontFamily = resolvePdfFontFamily(typography.body.fontFamily);
	const headingFontFamily = resolvePdfFontFamily(typography.heading.fontFamily);
	const bodyFontWeights = resolvePdfFontWeights(bodyFontFamily, typography.body.fontWeights);
	const headingFontWeights = resolvePdfFontWeights(headingFontFamily, typography.heading.fontWeights);

	return {
		...typography,
		body: { ...typography.body, fontFamily: bodyFontFamily, fontWeights: bodyFontWeights },
		heading: { ...typography.heading, fontFamily: headingFontFamily, fontWeights: headingFontWeights },
	};
};

// Detect which non-Latin writing systems actually appear in the content so we
// only register (and correctly order) the fallback fonts that are needed.
// Codepoints cannot distinguish Simplified from Traditional Han, so Han maps to
// "han-simplified"; Traditional ordering instead comes from the zh-TW locale.
const hangulRegex = /[가-힯ᄀ-ᇿ㄰-㆏ꥠ-꥿]/;
const kanaRegex = /[぀-ゟ゠-ヿㇰ-ㇿ]/;
// Any CJK letter (Bopomofo, Hangul or Kana too) adds the SC face, which also covers Han outside the BMP (Ext-B+).
const hanRegex = /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Bopomofo}]/u;

// Arabic + Supplement + Extended-A + Presentation Forms-A/B (covers Persian).
const arabicRegex = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-ﻼ]/;
const hebrewRegex = /[֐-׿יִ-ﭏ]/;
const thaiRegex = /[฀-๿]/;
// Each Indic script, Ethiopic and Khmer needs its own Noto face; Latin and CJK fonts have none of them.
const scriptRegex = (script: string) => new RegExp(`\\p{Script=${script}}`, "u");

// Emoji: regional indicators (flags) are NOT Extended_Pictographic, so union
// them explicitly with the pictographic property (#3321). Keycap sequences
// (e.g. "1\uFE0F\u20E3") carry no pictographic codepoint either — their
// discriminator is the combining enclosing keycap U+20E3, unioned here for the
// same reason: without it, keycap-only content falls back to a font without
// the enclosure mark and renders garbled.
const emojiRegex = /[\u{1F1E6}-\u{1F1FF}]|\u{20E3}|\p{Extended_Pictographic}/u;
// Basic arrows U+2190–U+2199 need Noto Sans Symbols; Symbols 2 has ★ but no → (#3608).
const arrowsRegex = /(?!\p{Extended_Pictographic})[←-↙]/u;
// The rest of the Arrows block, Geometric Shapes, Miscellaneous Symbols, Dingbats and Miscellaneous Symbols
// and Arrows need Symbols 2 (#3581). Pictographs (☀, ✔, ⭐) use Noto Emoji instead.
const symbolsRegex = /(?!\p{Extended_Pictographic})[↚-⇿■-➿⬀-⯿]/u;

const scriptDetectors: { script: Script; regex: RegExp }[] = [
	{ script: "hangul", regex: hangulRegex },
	{ script: "kana", regex: kanaRegex },
	{ script: "han-simplified", regex: hanRegex },
	{ script: "arabic", regex: arabicRegex },
	{ script: "hebrew", regex: hebrewRegex },
	{ script: "thai", regex: thaiRegex },
	{ script: "devanagari", regex: scriptRegex("Devanagari") },
	{ script: "bengali", regex: scriptRegex("Bengali") },
	{ script: "gurmukhi", regex: scriptRegex("Gurmukhi") },
	{ script: "gujarati", regex: scriptRegex("Gujarati") },
	{ script: "oriya", regex: scriptRegex("Oriya") },
	{ script: "tamil", regex: scriptRegex("Tamil") },
	{ script: "telugu", regex: scriptRegex("Telugu") },
	{ script: "kannada", regex: scriptRegex("Kannada") },
	{ script: "malayalam", regex: scriptRegex("Malayalam") },
	{ script: "sinhala", regex: scriptRegex("Sinhala") },
	{ script: "ethiopic", regex: scriptRegex("Ethiopic") },
	{ script: "khmer", regex: scriptRegex("Khmer") },
	{ script: "emoji", regex: emojiRegex },
	{ script: "arrows", regex: arrowsRegex },
	{ script: "symbols", regex: symbolsRegex },
];

const collectScripts = (value: unknown, scripts: Set<Script>): void => {
	if (typeof value === "string") {
		for (const { script, regex } of scriptDetectors) {
			if (regex.test(value)) scripts.add(script);
		}
		return;
	}

	if (!value || typeof value !== "object") return;
	if (Array.isArray(value)) {
		for (const item of value) collectScripts(item, scripts);
		return;
	}

	for (const item of Object.values(value as Record<string, unknown>)) collectScripts(item, scripts);
};

export const resumeContentScripts = (data: ResumeData): Set<Script> => {
	const scripts = new Set<Script>();
	collectScripts(
		{
			basics: data.basics,
			summary: data.summary,
			sections: data.sections,
			customSections: data.customSections,
		},
		scripts,
	);
	return scripts;
};

// Rich text italics: <em>, <i> and <cite> (see `text.tsx`).
const italicTagRegex = /<(?:em|i|cite)[\s>]/i;

/**
 * Whether anything in the resume is set in italic: rich text, or a style rule or stylesheet the user wrote.
 * Templates never set italic, so without these the italic faces (one file per weight) aren't downloaded; text
 * that turns out italic anyway still draws, upright.
 */
export const resumeUsesItalic = (data: ResumeData): boolean =>
	italicTagRegex.test(JSON.stringify([data.basics, data.summary, data.sections, data.customSections])) ||
	/\bitalic\b/.test(JSON.stringify([data.metadata.styleRules, data.metadata.stylesheet]));

/**
 * Resolves the typography for the PDF and lists the font faces it needs: the body and heading weights (in italic
 * too when the resume uses it), each family's true Bold, and one Noto fallback per writing system the content uses
 * (#2986). Standard PDF families need no files.
 */
export const resolvePdfFonts = (
	typography: Typography,
	locale: Locale,
	scripts?: Set<Script>,
	usesItalic = true,
): { typography: PdfTypography; fonts: PdfFontRequest[] } => {
	const fonts = new Map<string, PdfFontRequest>();
	const pdfTypography = resolvePdfTypography(typography);
	const bodyFontFamily = pdfTypography.body.fontFamily;
	const headingFontFamily = pdfTypography.heading.fontFamily;
	const bodyRange = getFontWeightRange(pdfTypography.body.fontWeights);
	const headingRange = getFontWeightRange(pdfTypography.heading.fontWeights);
	// Bold styles resolve to the family's true Bold face when one exists
	// (#3310), which can be heavier than the stored weight range (e.g.
	// ["400", "600"] for Open Sans) — make sure that face is registered or
	// @react-pdf/renderer would silently fall back to the nearest one.
	const bodyBoldWeight = resolveBoldFontWeight(bodyFontFamily, pdfTypography.body.fontWeights);

	const registerFont = (family: string, weight: number, italic = false) => {
		if (isStandardPdfFontFamily(family)) return;

		// A CJK face is 10–15 MB, so CJK families get Regular and Bold only; Forme draws other weights with the
		// nearest one. Every stored weight made a CJK resume's first preview download up to ~70 MB (#3593, #3627).
		const normalizedWeight = isCjkFontFamily(family) ? (weight <= 500 ? "400" : "700") : toFontWeight(weight);
		const key = `${family}:${normalizedWeight}:${italic}`;
		if (fonts.has(key)) return;

		const source = getWebFontSource(family, normalizedWeight, italic);
		if (!source) return;

		fonts.set(key, { family, weight: Number(normalizedWeight), italic, src: source });
	};

	const styles = usesItalic ? [false, true] : [false];
	for (const italic of styles) {
		registerFont(bodyFontFamily, bodyRange.lowest, italic);
		registerFont(bodyFontFamily, bodyRange.highest, italic);
		if (bodyBoldWeight) registerFont(bodyFontFamily, Number(bodyBoldWeight), italic);
		registerFont(headingFontFamily, headingRange.lowest, italic);
		registerFont(headingFontFamily, headingRange.highest, italic);
	}

	// Register script fallbacks so textkit can substitute per-codepoint for
	// characters the primary font lacks (#2986). One Noto font per writing
	// system is registered (ordered by locale + detected scripts) so Hangul,
	// Kana, Han, Arabic, Hebrew and Thai each resolve against a font that
	// actually contains them. Register the regular and bold ranges so glyph
	// fallback preserves <strong>/font-weight.
	const fallbackScripts = new Set<Script>(scripts ?? []);

	const bodyFallbacks = getPdfFallbackFontFamilies(bodyFontFamily, { locale, scripts: fallbackScripts });
	const headingFallbacks = getPdfFallbackFontFamilies(headingFontFamily, { locale, scripts: fallbackScripts });

	// Fallbacks get Regular and Bold only; Forme draws other weights with the nearest face.
	const registerFallbacks = (families: string[], storedWeights: readonly string[]) => {
		for (const family of families) {
			const weights = new Set([400]);
			const fallbackBoldWeight = resolveBoldFontWeight(family, storedWeights);
			if (fallbackBoldWeight) weights.add(Number(fallbackBoldWeight));

			for (const weight of weights) for (const italic of styles) registerFont(family, weight, italic);
		}
	};

	const sameStack =
		bodyFallbacks.length === headingFallbacks.length &&
		bodyFallbacks.every((family, index) => family === headingFallbacks[index]);

	registerFallbacks(bodyFallbacks, pdfTypography.body.fontWeights);
	if (!sameStack) registerFallbacks(headingFallbacks, pdfTypography.heading.fontWeights);

	// Latin-only path: no fallback registered, return as-is.
	if (bodyFallbacks.length === 0 && headingFallbacks.length === 0) {
		return { typography: pdfTypography as PdfTypography, fonts: [...fonts.values()] };
	}

	const bodyStack: string | string[] = bodyFallbacks.length > 0 ? [bodyFontFamily, ...bodyFallbacks] : bodyFontFamily;
	const headingStack: string | string[] =
		headingFallbacks.length > 0 ? [headingFontFamily, ...headingFallbacks] : headingFontFamily;

	return {
		typography: {
			...pdfTypography,
			body: { ...pdfTypography.body, fontFamily: bodyStack },
			heading: { ...pdfTypography.heading, fontFamily: headingStack },
		},
		fonts: [...fonts.values()],
	};
};
