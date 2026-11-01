import type { RouterOutput } from "@/libs/orpc/client";

export type DocumentSummary = RouterOutput["documents"]["list"][number];
export type DocumentTypeFilter = "all" | "resume" | "letter";
export type DocumentSort = "edited" | "name" | "created";

/** Days until a document in Trash is deleted for good (at least 0). */
export function daysLeftInTrash(trashedAt: Date, now = Date.now()) {
	const left = trashedAt.getTime() + 30 * 24 * 60 * 60 * 1000 - now;
	return Math.max(0, Math.ceil(left / (24 * 60 * 60 * 1000)));
}

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
