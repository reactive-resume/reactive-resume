import type { FontWeight } from "@reactive-resume/fonts";
import type { ResumeData, Typography } from "@reactive-resume/schema/resume/data";
import type { Locale, Script } from "@reactive-resume/utils/locale";
import { letters as cjkLetters } from "cjk-regex";
import {
	getFont,
	getPdfFallbackFontFamilies,
	getWebFontSource,
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
const cjkLetterRegex = cjkLetters().toRegExp();
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

const containsCjkLetters = (value: unknown): boolean => {
	if (typeof value === "string") return cjkLetterRegex.test(value);
	if (!value || typeof value !== "object") return false;
	if (Array.isArray(value)) return value.some(containsCjkLetters);

	return Object.values(value as Record<string, unknown>).some(containsCjkLetters);
};

export const resumeContentContainsCJK = (data: ResumeData): boolean => {
	return containsCjkLetters({
		basics: data.basics,
		summary: data.summary,
		sections: data.sections,
		customSections: data.customSections,
	});
};

// Detect which non-Latin writing systems actually appear in the content so we
// only register (and correctly order) the fallback fonts that are needed.
// Codepoints cannot distinguish Simplified from Traditional Han, so Han maps to
// "han-simplified"; Traditional ordering instead comes from the zh-TW locale.
const hangulRegex = /[가-힯ᄀ-ᇿ㄰-㆏ꥠ-꥿]/;
const kanaRegex = /[぀-ゟ゠-ヿㇰ-ㇿ]/;
const hanRegex = /[㐀-䶿一-鿿豈-﫿]/;

// Arabic + Supplement + Extended-A + Presentation Forms-A/B (covers Persian).
const arabicRegex = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-ﻼ]/;
const hebrewRegex = /[֐-׿יִ-ﭏ]/;
const thaiRegex = /[฀-๿]/;

// Emoji: regional indicators (flags) are NOT Extended_Pictographic, so union
// them explicitly with the pictographic property (#3321). Keycap sequences
// (e.g. "1\uFE0F\u20E3") carry no pictographic codepoint either — their
// discriminator is the combining enclosing keycap U+20E3, unioned here for the
// same reason: without it, keycap-only content falls back to a font without
// the enclosure mark and renders garbled.
const emojiRegex = /[\u{1F1E6}-\u{1F1FF}]|\u{20E3}|\p{Extended_Pictographic}/u;
// Geometric Shapes, Miscellaneous Symbols, Dingbats and Miscellaneous Symbols
// and Arrows: text symbols like ★ (U+2605) that Latin fonts and Noto Emoji lack (#3581).
// Pictographs in these blocks (☀, ✔, ⭐) are emoji and already resolve to Noto Emoji.
const symbolsRegex = /(?!\p{Extended_Pictographic})[■-➿⬀-⯿]/u;

const scriptDetectors: { script: Script; regex: RegExp }[] = [
	{ script: "hangul", regex: hangulRegex },
	{ script: "kana", regex: kanaRegex },
	{ script: "han-simplified", regex: hanRegex },
	{ script: "arabic", regex: arabicRegex },
	{ script: "hebrew", regex: hebrewRegex },
	{ script: "thai", regex: thaiRegex },
	{ script: "emoji", regex: emojiRegex },
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

/**
 * Resolves the typography for the PDF and lists the font faces it needs: the body and heading weights in normal and
 * italic, each family's true Bold, and one Noto fallback per writing system the content uses (#2986). Standard PDF
 * families need no files.
 */
export const resolvePdfFonts = (
	typography: Typography,
	locale: Locale,
	hasCjkContent = false,
	scripts?: Set<Script>,
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

		const normalizedWeight = toFontWeight(weight);
		const key = `${family}:${normalizedWeight}:${italic}`;
		if (fonts.has(key)) return;

		const source = getWebFontSource(family, normalizedWeight, italic);
		if (!source) return;

		fonts.set(key, { family, weight: Number(normalizedWeight), italic, src: source });
	};

	for (const italic of [false, true]) {
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
	// `hasCjkContent` is a script-agnostic flag (cjk-regex); when it is set
	// without an explicit script set, assume Han so a SC fallback is registered.
	if (hasCjkContent) fallbackScripts.add("han-simplified");

	const bodyFallbacks = getPdfFallbackFontFamilies(bodyFontFamily, { locale, scripts: fallbackScripts });
	const headingFallbacks = getPdfFallbackFontFamilies(headingFontFamily, { locale, scripts: fallbackScripts });

	const registerFallbacks = (families: string[], ranges: FontWeightRange[], storedWeights: readonly string[]) => {
		for (const family of families) {
			const weights = new Set(ranges.flatMap(({ lowest, highest }) => [lowest, highest]));
			const fallbackBoldWeight = resolveBoldFontWeight(family, storedWeights);
			if (fallbackBoldWeight) weights.add(Number(fallbackBoldWeight));

			for (const weight of weights) {
				registerFont(family, weight, false);
				registerFont(family, weight, true);
			}
		}
	};

	const sameStack =
		bodyFallbacks.length === headingFallbacks.length &&
		bodyFallbacks.every((family, index) => family === headingFallbacks[index]);

	if (sameStack) {
		registerFallbacks(bodyFallbacks, [bodyRange, headingRange], pdfTypography.body.fontWeights);
	} else {
		registerFallbacks(bodyFallbacks, [bodyRange], pdfTypography.body.fontWeights);
		registerFallbacks(headingFallbacks, [headingRange], pdfTypography.heading.fontWeights);
	}

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
