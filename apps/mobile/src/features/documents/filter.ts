import type { RouterOutput } from "@/api/client";

export type DocumentSummary = RouterOutput["documents"]["list"][number];
export type DocumentTypeFilter = "all" | "resume" | "letter";
export type DocumentSort = "edited" | "name" | "created";
export const documentKey = (document: Pick<DocumentSummary, "type" | "id">) => `${document.type}:${document.id}`;
export const documentRef = ({ type, id }: DocumentSummary) => ({ type, id });

export const sharedTags = (documents: readonly DocumentSummary[]) =>
	documents[0]?.tags.filter((tag) => documents.every((document) => document.tags.includes(tag))) ?? [];

/** Apply only the shared-tag delta; retain tags unique to each document. */
export function changedTags(document: DocumentSummary, shared: readonly string[], next: readonly string[]) {
	return [
		...document.tags.filter((tag) => !shared.includes(tag) || next.includes(tag)),
		...next.filter((tag) => !shared.includes(tag) && !document.tags.includes(tag)),
	];
}

export function daysLeftInTrash(trashedAt: Date, now = Date.now()) {
	return Math.max(0, Math.ceil((trashedAt.getTime() + 30 * 86_400_000 - now) / 86_400_000));
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
