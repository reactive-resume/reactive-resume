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
