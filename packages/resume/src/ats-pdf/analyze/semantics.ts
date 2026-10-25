import type { ExtractedDocument, RawExtraction, ResumeSemantics, TextLine } from "../types";
import { analyzeContact } from "./contact";
import { analyzeDates } from "./dates";
import { detectHeadings, sectionTypesOf } from "./sections";
import { analyzeTextQuality } from "./text-quality";

const BULLET_PREFIX = /^\s*(?:[•▪◦‣·∙●○■□▶▸*+]|[-–—]\s|[\u{E000}-\u{F8FF}])\s*/u;
const LONG_BULLET_CHARS = 220;
const FIRST_PERSON = /\b(?:I|I'm|I've|my|me|myself)\b/g;

/** Share of a page's height that counts as the running-head zone at either end. */
const RUNNING_HEAD_BAND = 0.08;
const MIN_REPEATED_OPENING = 3;

const ACTION_VERBS = new Set(
	(
		"achieved acquired adapted administered advised analyzed architected authored automated built centralized " +
		"championed coached collaborated completed conceived conducted configured consolidated constructed converted " +
		"coordinated created cut decreased defined delivered deployed designed developed devised diagnosed directed " +
		"documented doubled drove earned edited eliminated enabled engineered enhanced established evaluated executed " +
		"expanded expedited facilitated forecast formalized founded generated grew guided halved headed identified " +
		"implemented improved increased influenced initiated instituted integrated introduced launched led maintained " +
		"managed mentored migrated modernized negotiated onboarded operated optimized orchestrated organized overhauled " +
		"oversaw partnered performed pioneered piloted planned prepared presented prioritized produced programmed " +
		"proposed prototyped published rearchitected rebuilt reduced refactored released remediated reorganized " +
		"replaced researched resolved restructured revamped reviewed scaled scoped secured shipped simplified solved " +
		"spearheaded standardized streamlined strengthened supervised supported surveyed sustained taught tested " +
		"trained transformed translated tripled troubleshot unified upgraded validated wrote"
	).split(" "),
);

const isBullet = (line: TextLine) => BULLET_PREFIX.test(line.text);

const bulletBody = (line: TextLine) => line.text.replace(BULLET_PREFIX, "").trim();

function isQuantified(text: string): boolean {
	// A bare year is not an achievement metric; a percentage, a currency figure or a real
	// magnitude is. The lookbehinds start each number at its first digit, so a digit run is scanned once.
	if (/(?<!\d)\d+\s*%|[$€£¥]\s*\d|(?<!\d)\d+\s*x\b/i.test(text)) return true;
	return (text.match(/\b\d[\d,.]*\b/g) ?? []).some((value) => {
		const numeric = Number(value.replaceAll(",", ""));
		return Number.isFinite(numeric) && (numeric >= 1000 || (numeric >= 3 && !/^(?:19|20)\d{2}$/.test(value)));
	});
}

function startsWithActionVerb(text: string): boolean {
	const first = text.trim().split(/\s+/)[0];
	if (!first) return false;
	return ACTION_VERBS.has(first.toLowerCase().replace(/[^a-z]/g, ""));
}

function uppercaseHeavy(text: string): boolean {
	const letters = text.match(/\p{L}/gu) ?? [];
	if (letters.length < 12) return false;

	const upper = letters.filter((letter) => letter === letter.toUpperCase() && letter !== letter.toLowerCase()).length;
	return upper / letters.length >= 0.9;
}

/**
 * A role line is the "Senior Engineer — Acme, Berlin" pattern parsers key employment on:
 * two or more proper nouns held together by a separator, on a line of its own.
 */
function isRoleLike(line: TextLine): boolean {
	const text = line.text.trim();
	if (text.length === 0 || text.length > 110 || isBullet(line)) return false;
	if (!/\s(?:[|·–—]|at)\s|,\s/.test(text)) return false;

	const capitalized = (text.match(/\b\p{Lu}[\p{L}&.'-]*/gu) ?? []).length;
	return capitalized >= 2;
}

function singleCharItemRatio(raw: RawExtraction): number {
	let total = 0;
	let single = 0;

	for (const page of raw.pages) {
		for (const item of page.items) {
			const text = item.str.trim();
			if (text.length === 0) continue;
			total += 1;
			if (text.length === 1) single += 1;
		}
	}

	return total === 0 ? 0 : single / total;
}

function findRepeatedRunningHeads(document: ExtractedDocument): string[] {
	if (document.pages.length < 2) return [];

	const perPage = document.pages.map((page) => {
		const topBand = page.height * RUNNING_HEAD_BAND;
		const bottomBand = page.height * (1 - RUNNING_HEAD_BAND);

		return new Set(
			page.lines
				.filter((line) => line.y <= topBand || line.y + line.height >= bottomBand)
				.map((line) => line.text.trim())
				.filter(Boolean)
				// A page number differs on every page; the surrounding boilerplate does not.
				.map((text) => text.replace(/\d+/g, "#")),
		);
	});

	const [first, ...rest] = perPage;
	if (!first) return [];

	return [...first].filter((candidate) => rest.every((page) => page.has(candidate)));
}

function findRepeatedOpenings(bullets: readonly string[]): string[] {
	const counts = new Map<string, number>();

	for (const bullet of bullets) {
		const opening = bullet.toLowerCase().split(/\s+/).slice(0, 3).join(" ");
		if (opening.split(" ").length < 3) continue;
		counts.set(opening, (counts.get(opening) ?? 0) + 1);
	}

	return [...counts.entries()]
		.filter(([, count]) => count >= MIN_REPEATED_OPENING)
		.map(([opening]) => opening)
		.sort();
}

export type SemanticsOptions = {
	now: Date;
};

/** Reads resume meaning off the extracted geometry. Pure, and deterministic given `now`. */
export function buildResumeSemantics(
	raw: RawExtraction,
	document: ExtractedDocument,
	options: SemanticsOptions,
): ResumeSemantics {
	// Dates parse in the document's own declared language.
	const locale = raw.metadata.language || "en-US";

	const headings = detectHeadings(document);
	const contact = analyzeContact(raw, document);
	const dates = analyzeDates(document, locale, options.now);

	const quality = analyzeTextQuality({
		fullText: document.fullText,
		languageTag: raw.metadata.language,
		singleCharItemRatio: singleCharItemRatio(raw),
	});

	const bulletLines = document.lines.filter(isBullet);
	const bullets = bulletLines.map(bulletBody);

	return {
		headings,
		sectionTypes: sectionTypesOf(headings),
		contact,
		dates: dates.tokens,
		quality,
		bulletLineCount: bulletLines.length,
		roleLikeLineCount: document.lines.filter(isRoleLike).length,
		allCapsLineCount: document.lines.filter((line) => uppercaseHeavy(line.text)).length,
		quantifiedBulletCount: bullets.filter(isQuantified).length,
		actionVerbBulletCount: bullets.filter(startsWithActionVerb).length,
		firstPersonCount: (document.fullText.match(FIRST_PERSON) ?? []).length,
		longBulletCount: bullets.filter((bullet) => bullet.length > LONG_BULLET_CHARS).length,
		unparseableRanges: dates.unparseableRanges,
		ambiguousNumericDates: dates.ambiguousNumericDates,
		employmentGapYears: dates.gaps,
		repeatedBulletOpenings: findRepeatedOpenings(bullets),
		repeatedRunningHeads: findRepeatedRunningHeads(document),
	};
}
