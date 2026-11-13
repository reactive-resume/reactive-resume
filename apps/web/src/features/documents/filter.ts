import type { RouterOutput } from "@/libs/orpc/client";
import { formatRelativeTime } from "@/libs/locale";

export type DocumentSummary = RouterOutput["documents"]["list"][number];
export type DocumentTypeFilter = "all" | "resume" | "letter";
export type DocumentSort = "edited" | "name" | "created";

/**
 * Where a copy for a job starts by default: the most recently edited resume that isn't already a job's copy (the base
 * every copy should come from), or the most recent one when every resume is a job copy.
 */
export function defaultCopySource<
	T extends Pick<DocumentSummary, "updatedAt" | "application"> & Partial<Pick<DocumentSummary, "editedAt">>,
>(resumes: readonly T[]): T | undefined {
	const recent = resumes.toSorted(
		(a, b) => new Date(b.editedAt ?? b.updatedAt).getTime() - new Date(a.editedAt ?? a.updatedAt).getTime(),
	);
	return recent.find((resume) => !resume.application) ?? recent[0];
}

export const documentKey = (document: Pick<DocumentSummary, "type" | "id">) => `${document.type}:${document.id}`;

const startOfDay = (value: number | Date) => new Date(value).setHours(0, 0, 0, 0);

/**
 * When a document was last edited, as the library says it: "16 minutes ago" today, then "yesterday", the weekday
 * for the few days before that ("Tuesday"), then the date ("2 Nov", with the year once it differs).
 */
export function formatEdited(editedAt: Date | string, locale: string, now = Date.now()) {
	const date = new Date(editedAt);
	const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
	if (Number.isNaN(days) || days <= 0) return formatRelativeTime(date, locale);
	if (days === 1) return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-1, "day");
	if (days < 5) return date.toLocaleDateString(locale, { weekday: "long" });
	const sameYear = date.getFullYear() === new Date(now).getFullYear();
	return date.toLocaleDateString(locale, { day: "numeric", month: "short", year: sameYear ? undefined : "numeric" });
}
