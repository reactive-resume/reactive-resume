import { isValidSlug, MAX_SLUG_LENGTH, normalizeSlug } from "@reactive-resume/schema/resume/slug";

export { MAX_SLUG_LENGTH, normalizeSlug };
/** Same address grammar as the public-link API. */
export const validSlug = isValidSlug;

const timeUnits = [
	{ unit: "minute", ms: 60_000, below: 60 },
	{ unit: "hour", ms: 3_600_000, below: 24 },
	{ unit: "day", ms: 86_400_000, below: 7 },
	{ unit: "week", ms: 604_800_000, below: 52 },
	{ unit: "year", ms: 31_536_000_000, below: Number.POSITIVE_INFINITY },
] as const;

export function formatTimeSince(date: Date, locale: string, now = Date.now()) {
	const elapsed = Math.max(0, now - date.getTime());
	const { unit, ms } = timeUnits.find(({ ms, below }) => elapsed / ms < below) ?? timeUnits[4];
	return new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "narrow" }).format(Math.floor(elapsed / ms));
}

type DailyStat = { date: string; views: number; downloads: number };

export function summarizeViews(daily: readonly DailyStat[]) {
	const days = daily.slice(-30);
	const peak = Math.max(0, ...days.map((day) => day.views));
	return {
		views: days.reduce((sum, day) => sum + day.views, 0),
		downloads: days.reduce((sum, day) => sum + day.downloads, 0),
		peak,
		bars: days.map((day) => ({ date: day.date, height: peak > 0 ? day.views / peak : 0 })),
	};
}

export const safeFileName = (name: string) =>
	Array.from(name)
		.filter((character) => character.charCodeAt(0) >= 32)
		.join("")
		.replace(/[<>:"/\\|?*]/g, "")
		.replace(/^\.+|[. ]+$/g, "")
		.trim()
		.slice(0, 100);
