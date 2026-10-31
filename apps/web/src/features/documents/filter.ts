import type { RouterOutput } from "@/libs/orpc/client";

export type DocumentSummary = RouterOutput["documents"]["list"][number];
export type DocumentTypeFilter = "all" | "resume" | "letter";
export type DocumentSort = "edited" | "name" | "created";

/** Days until a document in Trash is deleted for good (at least 0). */
export function daysLeftInTrash(trashedAt: Date, now = Date.now()) {
	const left = trashedAt.getTime() + 30 * 24 * 60 * 60 * 1000 - now;
	return Math.max(0, Math.ceil(left / (24 * 60 * 60 * 1000)));
}
