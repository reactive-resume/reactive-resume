// Typed month-year dates, as web's dates-field.tsx reads them. Pure, so Node can check it.
import type { DateFormat, ResumeDates, YearMonth } from "@reactive-resume/schema/resume/dates";
import { formatYearMonth, toYearMonth } from "@reactive-resume/schema/resume/dates";
import { readSingleDate } from "@reactive-resume/schema/resume/period";

/** What someone typed ("Mar 2022", "03/2022", "2022-03", "2022"): a year-month, null when cleared, undefined if unreadable. */
export function readTypedDate(text: string, locale: string): YearMonth | null | undefined {
	const value = text.trim();
	if (!value) return null;
	const reading = readSingleDate(value, locale);
	return reading ? toYearMonth(reading.endpoint) : undefined;
}

export const isBefore = (end: YearMonth, start: YearMonth) => end.localeCompare(start) < 0 && !start.startsWith(end);

/** The range prints backwards (and isn't ongoing). */
export const isReversed = (dates: ResumeDates) =>
	!dates.present && !!dates.start && !!dates.end && isBefore(dates.end, dates.start);

export const showYearMonth = (value: YearMonth | null, locale: string, format?: DateFormat) =>
	value ? formatYearMonth(value, { locale, format }) : "";

/** The picker's day for a year-month (the 1st), or today. Months are local, as the picker shows them. */
export function pickerDate(value: YearMonth | null): Date {
	if (!value) return new Date();
	const [year, month] = value.split("-").map(Number);
	return new Date(year ?? new Date().getFullYear(), (month ?? 1) - 1, 1);
}

export const fromPickerDate = (date: Date): YearMonth =>
	toYearMonth({ year: date.getFullYear(), month: date.getMonth() + 1 });

/** Any edit replaces the dates without `raw`, which clears the "needs a look" note. */
export const editDates = (dates: ResumeDates, change: Partial<ResumeDates>): ResumeDates => {
	const next: ResumeDates = {
		start: dates.start,
		end: dates.end,
		present: dates.present,
		...(dates.expected ? { expected: true } : {}),
		...change,
	};
	// Ongoing has no end date to come; Expected only reads while it's off.
	if (next.present || next.expected === false) delete next.expected;
	return next;
};
