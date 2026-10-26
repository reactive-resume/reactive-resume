import type { RouterOutput } from "@/libs/orpc/client";
import { t } from "@lingui/core/macro";

export type VersionSummary = RouterOutput["resume"]["listVersions"][number];

const DAY_MS = 24 * 60 * 60 * 1000;

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
