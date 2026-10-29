import type { DateToken, ExtractedDocument } from "../types";
import {
	isFutureEndpoint,
	isReversedPeriod,
	parsePeriod,
	parseSingleDate,
} from "@reactive-resume/schema/resume/period";

const MONTH_WORD = String.raw`[A-Za-z]{3,9}\.?`;
const ENDPOINT = String.raw`(?:${MONTH_WORD}\s*'?\d{2,4}|\d{1,2}[/.\-]\d{2,4}|\d{4})`;
const ONGOING = String.raw`(?:present|current|currently|now|ongoing|to\s?date|today)`;
const SEPARATOR = String.raw`\s*(?:[-–—~]|to|through|until)\s*`;

const RANGE_PATTERN = new RegExp(
	String.raw`\b${ENDPOINT}${SEPARATOR}(?:${ENDPOINT}|${ONGOING})(?![\p{L}\p{N}_])`,
	"giu",
);
const ONGOING_END_PATTERN = new RegExp(`${SEPARATOR}${ONGOING}$`, "i");
const SINGLE_PATTERN = new RegExp(String.raw`\b(?:${MONTH_WORD}\s+\d{4}|\d{1,2}/\d{4})\b`, "gi");

/** A numeric date whose first two components could each be a month or a day. */
const AMBIGUOUS_NUMERIC_PATTERN = /\b(0?[1-9]|1[0-2])[/.-](0?[1-9]|[12]\d|3[01])[/.-](\d{2}|\d{4})\b/g;

/**
 * `[A-Za-z]{3,9}` in the range pattern also matches non-month words such as "Framework".
 * Every alphabetic run in a candidate must be a month name or an ongoing marker in this locale.
 *
 * The trade-off is deliberate: a misspelled month is dropped rather than reported unparseable.
 * Claiming a date is malformed when it is not a date is the worse error.
 */
function looksLikeDateWords(raw: string, locale: string): boolean {
	const words = raw.match(/[A-Za-z]+/g) ?? [];

	return words.every((word) => {
		const lower = word.toLowerCase();
		if (ONGOING_WORDS.has(lower)) return true;
		return parseSingleDate(`${word} 2000`, locale) !== null;
	});
}

const ONGOING_WORDS = new Set([
	"present",
	"current",
	"currently",
	"now",
	"ongoing",
	"today",
	"date",
	"to",
	"through",
	"until",
]);

function shapeOf(raw: string): DateToken["shape"] {
	if (/[A-Za-z]/.test(raw.replace(ONGOING_END_PATTERN, "").replace(/\b(?:to|through|until)\b/gi, "")))
		return "mon-year";
	if (/\d{1,2}[/.-]\d/.test(raw)) return "numeric";
	return "year";
}

function toToken(
	raw: string,
	kind: DateToken["kind"],
	page: number,
	lineIndex: number,
	locale: string,
	now: Date,
): DateToken {
	const base = { raw, page, lineIndex, kind, shape: shapeOf(raw) } as const;

	if (kind === "single") {
		const parsed = parseSingleDate(raw, locale);
		return {
			...base,
			parsed: parsed !== null,
			ongoing: false,
			startYear: parsed?.year ?? null,
			endYear: parsed?.year ?? null,
			reversed: false,
			future: parsed ? isFutureEndpoint(parsed, now) : false,
		};
	}

	const parsed = parsePeriod(raw, locale);
	if (!parsed) {
		return { ...base, parsed: false, ongoing: false, startYear: null, endYear: null, reversed: false, future: false };
	}

	const reversed = !!parsed.start && !!parsed.end && isReversedPeriod(parsed.start, parsed.end);
	const future =
		(!!parsed.start && isFutureEndpoint(parsed.start, now)) || (!!parsed.end && isFutureEndpoint(parsed.end, now));

	return {
		...base,
		parsed: true,
		ongoing: parsed.ongoing,
		startYear: parsed.start?.year ?? null,
		endYear: parsed.end?.year ?? null,
		reversed,
		future,
	};
}

export type DateAnalysis = {
	tokens: DateToken[];
	unparseableRanges: string[];
	ambiguousNumericDates: string[];
	/** Gaps of more than a year between one role ending and the next beginning. */
	gaps: { from: number; to: number }[];
};

/**
 * Reads every date on the page, using the same period grammar the builder's live lint uses so a
 * resume never passes one check and fails the other on the same string.
 */
export function analyzeDates(document: ExtractedDocument, locale: string, now: Date): DateAnalysis {
	const tokens: DateToken[] = [];
	const unparseableRanges: string[] = [];
	const ambiguousNumericDates: string[] = [];

	document.lines.forEach((line, lineIndex) => {
		const ranges: string[] = [];
		for (let match = RANGE_PATTERN.exec(line.text); match; match = RANGE_PATTERN.exec(line.text)) {
			if (looksLikeDateWords(match[0], locale)) ranges.push(match[0]);
			// Retry inside a rejected candidate: a role word must not swallow the year range beside it.
			else RANGE_PATTERN.lastIndex = match.index + 1;
		}
		for (const raw of ranges) {
			const token = toToken(raw.trim(), "range", line.page, lineIndex, locale, now);
			tokens.push(token);
			if (!token.parsed) unparseableRanges.push(token.raw);
		}

		// A lone date inside a range we already captured would double-count it.
		const withoutRanges = ranges.reduce((text, range) => text.replace(range, " "), line.text);
		for (const raw of withoutRanges.match(SINGLE_PATTERN) ?? []) {
			if (!looksLikeDateWords(raw, locale)) continue;
			tokens.push(toToken(raw.trim(), "single", line.page, lineIndex, locale, now));
		}

		for (const raw of line.text.match(AMBIGUOUS_NUMERIC_PATTERN) ?? []) ambiguousNumericDates.push(raw);
	});

	return {
		tokens,
		unparseableRanges: [...new Set(unparseableRanges)],
		ambiguousNumericDates: [...new Set(ambiguousNumericDates)],
		gaps: findGaps(tokens),
	};
}

/**
 * A gap is reported, never scored. Time out of work is not a defect, and pretending a tool can
 * tell a sabbatical from a layoff from two numbers would be dishonest.
 */
function findGaps(tokens: readonly DateToken[]): { from: number; to: number }[] {
	const ranges = tokens
		.filter((token) => token.kind === "range" && token.parsed && token.startYear !== null)
		.map((token) => ({
			start: token.startYear as number,
			end: token.ongoing ? Number.POSITIVE_INFINITY : (token.endYear ?? (token.startYear as number)),
		}))
		.sort((a, b) => a.start - b.start);

	const gaps: { from: number; to: number }[] = [];
	let covered = Number.NEGATIVE_INFINITY;

	for (const range of ranges) {
		if (covered !== Number.NEGATIVE_INFINITY && range.start - covered > 1) {
			gaps.push({ from: covered, to: range.start });
		}
		covered = Math.max(covered, range.end);
	}

	return gaps.filter((gap) => Number.isFinite(gap.from) && Number.isFinite(gap.to));
}
