import type { CustomSectionType } from "@reactive-resume/schema/resume/data";
import type { DetectedHeading, ExtractedDocument, TextLine } from "../types";
import { PDF_SECTION_HEADING_LOOKUP } from "../../ats/section-aliases";
import { columnSegments } from "../extract";

/** Headings are short. Past this many words a line is a sentence, not a section title. */
const MAX_HEADING_WORDS = 6;
const MAX_HEADING_CHARS = 60;

/** A heading has to outsize body text by this much before size alone marks it out. */
const HEADING_SIZE_RATIO = 1.08;
/** Share of a line's letters that must be capitals before capitalisation marks it out. */
const HEADING_UPPERCASE_RATIO = 0.8;

/**
 * Folds a heading and an alias onto the same key: case, punctuation, and ampersands all vary
 * between resumes and none of them change which section a heading names.
 */
function normalizeHeading(value: string): string {
	const collapsed = value
		.toLowerCase()
		.replaceAll("&", " and ")
		.replace(/[^\p{L}\p{N}\s]+/gu, " ")
		.replace(/\s+/g, " ")
		.trim();

	// "E D U C A T I O N" is one word set in letter-spaced capitals, not nine words.
	const parts = collapsed.split(" ");
	if (parts.length >= 4 && parts.every((part) => part.length === 1)) return parts.join("");

	return collapsed;
}

const NORMALIZED_HEADINGS: ReadonlyMap<string, CustomSectionType> = new Map(
	[...PDF_SECTION_HEADING_LOOKUP.entries()].map(([alias, type]) => [normalizeHeading(alias), type]),
);

function uppercaseRatio(text: string): number {
	const letters = text.match(/\p{L}/gu) ?? [];
	if (letters.length === 0) return 0;

	const upper = letters.filter((letter) => letter === letter.toUpperCase() && letter !== letter.toLowerCase()).length;
	return upper / letters.length;
}

function looksLikeHeading(line: TextLine, normalized: string, document: ExtractedDocument): boolean {
	if (normalized.length === 0 || line.text.length > MAX_HEADING_CHARS) return false;
	if (normalized.split(" ").length > MAX_HEADING_WORDS) return false;
	// A heading does not end a sentence, and it is not a bullet.
	if (/[.!?;,]$/.test(line.text.trim())) return false;
	if (/^[•▪◦‣·*–—-]\s/.test(line.text.trim())) return false;

	if (NORMALIZED_HEADINGS.has(normalized)) return true;

	return isDistinguished(line, document);
}

/**
 * A heading stands out by size, by case, or by weight. Weight shows up in a PDF as a different
 * font object, which is why the body's dominant font ref is threaded down here: a template that
 * sets headings bold at body size is perfectly legible and must not be reported as flat.
 */
function isDistinguished(line: TextLine, document: ExtractedDocument): boolean {
	const { modalFontSize, modalFontRef } = document;

	if (modalFontSize && line.fontSize >= modalFontSize * HEADING_SIZE_RATIO) return true;
	if (modalFontRef && line.fontRef && line.fontRef !== modalFontRef) return true;

	return uppercaseRatio(line.text) >= HEADING_UPPERCASE_RATIO && line.text.trim().length > 2;
}

/**
 * Finds the lines that introduce a section.
 *
 * A heading is reported whether or not it maps to a known section type: an unrecognised heading
 * still tells us the document is segmented, and the difference between "segmented into sections
 * we know" and "segmented into sections we do not" is exactly what the section checks weigh.
 */
export function detectHeadings(document: ExtractedDocument): DetectedHeading[] {
	const headings: DetectedHeading[] = [];

	document.lines.forEach((line, lineIndex) => {
		// A heading set in its own narrow column shares a baseline with the first line of the
		// section's content, so the line it lands on has to be read in column-separated pieces.
		for (const segment of columnSegments(line)) {
			const normalized = normalizeHeading(segment.text);
			if (!looksLikeHeading(segment, normalized, document)) continue;

			headings.push({
				text: segment.text.trim(),
				normalized,
				sectionType: NORMALIZED_HEADINGS.get(normalized) ?? null,
				page: segment.page,
				lineIndex,
				fontSize: segment.fontSize,
				distinguished: isDistinguished(segment, document),
			});
		}
	});

	return headings;
}

export function sectionTypesOf(headings: readonly DetectedHeading[]): CustomSectionType[] {
	const seen = new Set<CustomSectionType>();
	for (const heading of headings) {
		if (heading.sectionType) seen.add(heading.sectionType);
	}
	return [...seen];
}
