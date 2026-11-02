import type { ResumeData } from "./data";
import type { EndpointReading, ParsedPeriod, PeriodEndpoint } from "./period";
import z from "zod";
import expectedLabels from "./expected-labels.json";
import { ONGOING_TOKENS_BY_LANGUAGE, readPeriod, readSingleDate } from "./period";
import presentLabels from "./present-labels.json";

/** A year ("2022") or a year and month ("2022-03"). A month is optional, so year-only dates are exact. */
export const yearMonthSchema = z
	.string()
	.regex(/^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/)
	.describe('A year ("2022") or a year and month ("2022-03").');

export type YearMonth = z.infer<typeof yearMonthSchema>;

export const resumeDatesSchema = z
	.object({
		start: yearMonthSchema
			.nullable()
			.catch(null)
			.describe("When it started, or the date itself for single-date entries (awards, certifications, publications)."),
		end: yearMonthSchema.nullable().catch(null).describe("When it ended. Null while ongoing or for single dates."),
		present: z.boolean().catch(false).describe("Whether it's ongoing, printed as 'Present'."),
		expected: z
			.boolean()
			.optional()
			.catch(undefined)
			.describe(
				"Whether the end date is still to come, such as a degree in progress: printed as 'Expected May 2027'. Ignored while present is true.",
			),
		raw: z
			.string()
			.optional()
			.describe(
				"Custom date text, also used for imported text that could not be read exactly. Printed verbatim, overriding start/end formatting. Preserve it when editing other fields; remove it only when the user chooses preset date fields.",
			),
	})
	.describe(
		"Structured dates. Write these rather than the legacy text field (`period` or `date`), which is kept in sync from them.",
	);

export type ResumeDates = z.infer<typeof resumeDatesSchema>;

/** Nonempty custom text without a parsed start cannot support timeline checks or date sorting. */
export const hasUnreadableDateText = (dates: ResumeDates | undefined): boolean =>
	Boolean(dates?.raw?.trim()) && !dates?.start;

/** How dates print: Mar 2022, March 2022, 03/2022 or 2022-03. */
export const dateFormatSchema = z.enum(["short", "long", "numeric", "iso"]);

export type DateFormat = z.infer<typeof dateFormatSchema>;

export const DEFAULT_DATE_FORMAT: DateFormat = "short";

export const EMPTY_RESUME_DATES: ResumeDates = { start: null, end: null, present: false };

const labels: Record<string, string> = presentLabels;
const expected: Record<string, string> = expectedLabels;

/** "Expected" in a resume's locale, before an end date still to come; English until a locale translates it. */
export function getExpectedLabel(locale: string): string {
	return expected[locale] || "Expected";
}

/**
 * "Present" in a resume's locale, as dates print it. Locales without a translation yet fall back to the
 * language's usual word from the parser's list ("Heute", "Presente"), then to English.
 */
export function getPresentLabel(locale: string): string {
	const language = locale.split("-")[0]?.toLowerCase() ?? "";
	const translated = labels[locale];
	if (translated && (translated !== "Present" || language === "en")) return translated;

	const word = ONGOING_TOKENS_BY_LANGUAGE[language]?.[0];
	if (!word) return "Present";
	// Case the word by its language alone: `locale` can be a malformed tag ("de-DE-") that throws a RangeError.
	return word.charAt(0).toLocaleUpperCase(language) + word.slice(1);
}

const toEndpoint = (value: YearMonth): PeriodEndpoint => {
	const [year, month] = value.split("-").map(Number);
	return month ? { year: year ?? 0, month } : { year: year ?? 0 };
};

/** Dates as the period shape sorting and checks use; null when nothing was read (no start). */
export const resumeDatesToPeriod = (dates: ResumeDates): ParsedPeriod | null =>
	dates.start
		? {
				start: toEndpoint(dates.start),
				...(dates.end ? { end: toEndpoint(dates.end) } : {}),
				ongoing: dates.present,
			}
		: null;

export const toYearMonth = ({ year, month }: PeriodEndpoint): YearMonth =>
	month === undefined ? String(year) : `${year}-${String(month).padStart(2, "0")}`;

// Seasons and days don't fit a year-month exactly, so readings that use them keep the original text.
const isExact = (reading: EndpointReading | undefined) =>
	!reading || (reading.style !== "season" && reading.style !== "day");

/**
 * Reads a legacy date text into structured dates. Exact readings (years, months by name or number, and
 * "Present") drop the text; approximate or unreadable ones keep it in `raw`, which prints verbatim and remains editable as custom text.
 */
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The Expected label (in the locale, or English) right after a period's dash, with the space that follows it. */
const expectedEndPattern = (locale: string) =>
	new RegExp(
		`(?<=[–—-]\\s*)(?:${[...new Set([getExpectedLabel(locale), "Expected"])].map(escapeRegExp).join("|")})\\s+`,
		"iu",
	);

/** A period's text without the Expected label before its end, and the label match when there was one. */
function withoutExpectedLabel(value: string, locale: string) {
	const expected = expectedEndPattern(locale).exec(value);
	const unlabeled = expected
		? value.slice(0, expected.index) + value.slice(expected.index + expected[0].length)
		: value;
	return { expected, unlabeled };
}

export function readLegacyDates(text: string, options: { locale: string; single: boolean }): ResumeDates {
	const value = text.trim();
	if (!value) return { ...EMPTY_RESUME_DATES };

	if (options.single) {
		const reading = readSingleDate(value, options.locale);
		if (!reading) return { ...EMPTY_RESUME_DATES, raw: value };
		const dates: ResumeDates = { start: toYearMonth(reading.endpoint), end: null, present: false };
		return isExact(reading) ? dates : { ...dates, raw: value };
	}

	// "Sep 2023 – Expected May 2027", as an expected end date prints: read the date, and keep that it's still to come.
	const { expected, unlabeled } = withoutExpectedLabel(value, options.locale);
	const reading = readPeriod(unlabeled, options.locale, [getPresentLabel(options.locale)]);
	if (!reading?.start) return { ...EMPTY_RESUME_DATES, raw: value };

	const dates: ResumeDates = {
		start: toYearMonth(reading.start.endpoint),
		end: reading.end ? toYearMonth(reading.end.endpoint) : null,
		present: reading.ongoing,
		...(expected && reading.end && !reading.ongoing ? { expected: true } : {}),
	};
	return isExact(reading.start) && isExact(reading.end) ? dates : { ...dates, raw: value };
}

/**
 * Guesses the date format a resume was written in from its legacy texts, so upgraded resumes keep printing
 * the way they were typed: month names long or short, numeric months, or ISO. Year-only dates don't vote.
 */
export function inferDateFormat(texts: readonly string[], locale: string): DateFormat {
	const votes: Record<DateFormat, number> = { short: 0, long: 0, numeric: 0, iso: 0 };

	for (const text of texts) {
		// An expected end ("Sep 2023 – Expected May 2027") votes like any other end date.
		const { unlabeled } = withoutExpectedLabel(text, locale);
		const reading = readPeriod(unlabeled, locale) ?? { start: readSingleDate(unlabeled, locale) ?? undefined };
		for (const endpoint of [reading.start, "end" in reading ? reading.end : undefined]) {
			const style = endpoint?.style;
			if (style === "short" || style === "long" || style === "numeric" || style === "iso") votes[style] += 1;
		}
	}

	const [winner, count] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0] as [DateFormat, number];
	return count > 0 ? winner : DEFAULT_DATE_FORMAT;
}

/** An entry that carries dates, with the legacy text field that mirrors them. */
export type DatedEntry = { dates?: ResumeDates | undefined } & ({ period: string } | { date: string });

type DatedEntryVisitor = (entry: DatedEntry, field: "period" | "date") => void;

const RANGE_TYPES = new Set(["experience", "education", "projects", "volunteer"]);
const SINGLE_TYPES = new Set(["awards", "certifications", "publications"]);

function visitItems(type: string, items: readonly unknown[], visit: DatedEntryVisitor) {
	const field = RANGE_TYPES.has(type) ? "period" : SINGLE_TYPES.has(type) ? "date" : null;
	if (!field) return;

	for (const item of items as DatedEntry[]) {
		visit(item, field);
		if (type !== "experience") continue;
		for (const role of (item as { roles?: DatedEntry[] }).roles ?? []) visit(role, "period");
	}
}

/**
 * Visits every dated entry: experience (and its roles), education, projects and volunteer by period; awards,
 * certifications and publications by date; custom sections of those types too. Mutating visitors are fine,
 * including inside an immer draft.
 */
export function forEachDatedEntry(data: ResumeData, visit: DatedEntryVisitor) {
	for (const [type, section] of Object.entries(data.sections)) visitItems(type, section.items, visit);
	for (const section of data.customSections) visitItems(section.type, section.items, visit);
}

export const getLegacyDateText = (entry: DatedEntry, field: "period" | "date") =>
	field === "period" ? (entry as { period: string }).period : (entry as { date: string }).date;

/**
 * Read-time upgrade for resumes saved before structured dates: fills `dates` from each entry's legacy text,
 * and the date format from how those texts were typed. Entries that already have dates keep them.
 */
export function upgradeResumeDates(data: ResumeData) {
	const { page } = data.metadata;

	if (!page.dateFormat) {
		const texts: string[] = [];
		forEachDatedEntry(data, (entry, field) => {
			const text = getLegacyDateText(entry, field);
			if (!entry.dates && text) texts.push(text);
		});
		page.dateFormat = inferDateFormat(texts, page.locale);
	}

	forEachDatedEntry(data, (entry, field) => {
		entry.dates ??= readLegacyDates(getLegacyDateText(entry, field), { locale: page.locale, single: field === "date" });
	});
}

export type DateFormatOptions = {
	locale: string;
	format?: DateFormat | undefined;
	/** Defaults to "Present" in the locale. */
	presentLabel?: string | undefined;
	/** Defaults to "Expected" in the locale. */
	expectedLabel?: string | undefined;
};

const monthFormatters = new Map<string, Intl.DateTimeFormat>();

function formatMonth(year: number, month: number, locale: string, style: "short" | "long") {
	const key = `${locale}:${style}`;
	let formatter = monthFormatters.get(key);
	if (!formatter) {
		try {
			formatter = new Intl.DateTimeFormat(locale, { year: "numeric", month: style, timeZone: "UTC" });
		} catch {
			formatter = new Intl.DateTimeFormat("en-US", { year: "numeric", month: style, timeZone: "UTC" });
		}
		monthFormatters.set(key, formatter);
	}
	return formatter.format(Date.UTC(year, month - 1, 1));
}

const yearFormatters = new Map<string, Intl.NumberFormat>();

// A year in the digits the locale's month dates use, so "2019" sits beside "أبريل ٢٠١٩" as "٢٠١٩". Only the digits
// change, one by one: the year stays the one the user entered, leading zeros and all, in any calendar.
function formatYear(yearText: string, locale: string) {
	let formatter = yearFormatters.get(locale);
	if (!formatter) {
		let numberingSystem = "latn";
		try {
			numberingSystem = new Intl.DateTimeFormat(locale, { year: "numeric" }).resolvedOptions().numberingSystem;
		} catch {
			// An unknown locale prints Latin digits, as its month dates do.
		}
		formatter = new Intl.NumberFormat("en-US", { numberingSystem, useGrouping: false });
		yearFormatters.set(locale, formatter);
	}
	const digits = formatter;
	return yearText.replace(/\d/g, (digit) => digits.format(Number(digit)));
}

/**
 * One date in the chosen format: Mar 2022, March 2022, 03/2022 or 2022-03. Year-only dates print the year, in the
 * same digits as the month formats' years.
 */
export function formatYearMonth(value: YearMonth, { locale, format = DEFAULT_DATE_FORMAT }: DateFormatOptions) {
	const [yearText, monthText] = value.split("-");
	if (!monthText) {
		const year = Number(yearText);
		if (!yearText || !Number.isInteger(year) || format === "iso" || format === "numeric") return yearText ?? value;
		return formatYear(yearText, locale);
	}

	const year = Number(yearText);
	const month = Number(monthText);
	if (format === "iso") return value;
	if (format === "numeric") return `${monthText}/${yearText}`;
	return formatMonth(year, month, locale, format);
}

/**
 * Dates as they print: "Mar 2022 – Present", "2014 – 2018" or one date. Dates carrying `raw` (custom or imported text) print that text verbatim, regardless of the selected format.
 */
export function formatResumeDates(dates: ResumeDates, options: DateFormatOptions): string {
	if (dates.raw !== undefined) return dates.raw;

	const start = dates.start ? formatYearMonth(dates.start, options) : "";
	const endDate = dates.end ? formatYearMonth(dates.end, options) : "";
	const end = dates.present
		? (options.presentLabel ?? getPresentLabel(options.locale))
		: endDate && dates.expected
			? `${options.expectedLabel ?? getExpectedLabel(options.locale)} ${endDate}`
			: endDate;

	return start && end ? `${start} – ${end}` : start || end;
}

/**
 * Rewrites each entry's text (`period` or `date`) from its structured dates, in the resume's locale and date
 * format. Dates are the only source: an edit to the text alone is overwritten. Entries without dates (new
 * items from imports or older data) get them from their text first.
 *
 * Mutates `data` in place and writes only what changed, so it's safe inside an immer draft.
 */
export function syncResumeDates(data: ResumeData) {
	const { locale, dateFormat } = data.metadata.page;
	const options: DateFormatOptions = {
		locale,
		format: dateFormat,
		presentLabel: getPresentLabel(locale),
		expectedLabel: getExpectedLabel(locale),
	};

	forEachDatedEntry(data, (entry, field) => {
		const text = getLegacyDateText(entry, field);
		entry.dates ??= readLegacyDates(text, { locale, single: field === "date" });

		const formatted = formatResumeDates(entry.dates, options);
		if (formatted === text) return;
		if (field === "period") (entry as { period: string }).period = formatted;
		else (entry as { date: string }).date = formatted;
	});
}
