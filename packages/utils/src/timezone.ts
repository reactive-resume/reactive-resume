import z from "zod";

/** An IANA timezone this runtime knows, such as "Europe/Berlin". */
export const timezoneSchema = z
	.string()
	.max(100)
	.refine((value) => {
		try {
			new Intl.DateTimeFormat("en", { timeZone: value });
			return true;
		} catch {
			return false;
		}
	}, "Choose a valid timezone.");

/** Resolve a wall-clock minute without silently normalizing invalid dates or skipped DST times. */
export function fromZonedDateTime(date: string, time: string, timeZone: string): Date | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
	const wall = Date.parse(`${date}T${time}:00Z`);
	if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 16) !== `${date}T${time}`) return null;
	try {
		const formatter = new Intl.DateTimeFormat("en-CA", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
		});
		const localMinute = (at: number) => {
			const parts = Object.fromEntries(formatter.formatToParts(at).map(({ type, value }) => [type, value]));
			return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
		};
		const offset = (at: number) => Date.parse(`${localMinute(at)}:00Z`) - at;
		const guess = wall - offset(wall);
		const instant = wall - offset(guess);
		return localMinute(instant) === `${date}T${time}` ? new Date(instant) : null;
	} catch {
		return null;
	}
}

/**
 * A calendar date (`YYYY-MM-DD`) in the interface locale, without applying the account timezone. A start date is a
 * date, not an instant: formatting it as midnight UTC can show the next day in UTC+13/+14. The year is always shown.
 */
export function formatDateOnly(value: string, locale: string): string {
	const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
	if (!match) return value;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(Date.UTC(year, month - 1, day));
	if (date.toISOString().slice(0, 10) !== `${match[1]}-${match[2]}-${match[3]}`) return value;
	return new Intl.DateTimeFormat(locale, {
		timeZone: "UTC",
		year: "numeric",
		month: "short",
		day: "numeric",
	}).format(date);
}
