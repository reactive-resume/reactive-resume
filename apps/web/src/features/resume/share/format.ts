import type { RouterOutput } from "@/libs/orpc/client";
import { t } from "@lingui/core/macro";

type DailyStat = { date: string; views: number; downloads: number };
export type VersionSummary = RouterOutput["resume"]["listVersions"][number];

const DAY_MS = 24 * 60 * 60 * 1000;

/** The Link tab's numbers: views and downloads over the last 30 days, and each day's views against the peak. */
export function summarizeViews(daily: readonly DailyStat[]) {
	const days = daily.slice(-30);
	const peak = Math.max(0, ...days.map((day) => day.views));

	return {
		views: days.reduce((sum, day) => sum + day.views, 0),
		downloads: days.reduce((sum, day) => sum + day.downloads, 0),
		peak,
		bars: days.map((day) => ({ date: day.date, views: day.views, height: peak > 0 ? day.views / peak : 0 })),
	};
}

const UNITS = [
	{ unit: "minute", ms: 60 * 1000, below: 60 },
	{ unit: "hour", ms: 60 * 60 * 1000, below: 24 },
	{ unit: "day", ms: DAY_MS, below: 7 },
	{ unit: "week", ms: 7 * DAY_MS, below: 52 },
	{ unit: "year", ms: 365 * DAY_MS, below: Number.POSITIVE_INFINITY },
] as const;

/** Time since a moment in the largest whole unit, written short: "5m", "2h", "3d", "6w", "1y". */
export function formatTimeSince(date: Date, locale: string, now = Date.now()) {
	const elapsed = Math.max(0, now - date.getTime());
	const { unit, ms } = UNITS.find(({ ms, below }) => elapsed / ms < below) ?? UNITS[4];
	return new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "narrow" }).format(Math.floor(elapsed / ms));
}

/** "Today 14:02", "Yesterday 09:15", "Sep 16", or "Sep 16, 2025" for another year. */
export function formatVersionTime(date: Date, locale: string, now = new Date()) {
	const time = date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
	const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

	if (date.getTime() >= startOfToday) return t`Today ${time}`;
	if (date.getTime() >= startOfToday - DAY_MS) return t`Yesterday ${time}`;
	return date.toLocaleDateString(locale, {
		month: "short",
		day: "numeric",
		...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
	});
}

/** A version's full date and time, for sentences: "Sep 28, 2026, 7:36 PM". */
export const formatVersionMoment = (date: Date, locale: string) =>
	date.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });

/** A version's title in History: its name when the user named it, otherwise what made it. */
export function getVersionTitle(version: Pick<VersionSummary, "kind" | "name">) {
	switch (version.kind) {
		case "named":
			return version.name || t`Named version`;
		case "created":
			return t`Created`;
		case "import":
			return t`Imported`;
		case "auto":
			return t`Editing session`;
		case "before-restore":
			return t`Before restore`;
		case "restored":
			return t`Restored a version`;
		case "ai":
			return t`AI edit`;
		case "sent":
			// Sent versions are named after the company they went to.
			return version.name ? t`Sent to ${version.name}` : t`Sent`;
	}
}

/** The line under a version's title: how it was saved. */
export function getVersionDetail(version: Pick<VersionSummary, "kind">) {
	switch (version.kind) {
		case "named":
			return t`named`;
		case "auto":
		case "before-restore":
			return t`autosaved`;
		case "ai":
			return t`from the assistant or API`;
		default:
			return t`saved`;
	}
}
