import type { RouterOutput } from "@/libs/orpc/client";

export type DocumentSummary = RouterOutput["documents"]["list"][number];
export type DocumentTypeFilter = "all" | "resume" | "letter";
export type DocumentSort = "edited" | "name" | "created";

type DocumentFilters = {
	type: DocumentTypeFilter;
	q: string;
	tags: readonly string[];
	sort: DocumentSort;
	/** Only resumes whose public link is on. */
	public?: boolean | undefined;
};

const byName = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** Search covers titles, tags and linked applications; every chosen tag must be on the document, and Public keeps shared resumes. */
export function filterDocuments(documents: readonly DocumentSummary[], filters: DocumentFilters) {
	const query = filters.q.trim().toLocaleLowerCase();

	return documents
		.filter((document) => filters.type === "all" || document.type === filters.type)
		.filter((document) => filters.tags.every((tag) => document.tags.includes(tag)))
		.filter((document) => !filters.public || document.isPublic)
		.filter((document) => {
			if (!query) return true;
			const haystack = [document.name, ...document.tags, document.application?.company, document.application?.role];
			return haystack.some((text) => text?.toLocaleLowerCase().includes(query));
		})
		.sort((a, b) => {
			if (filters.sort === "name") return byName.compare(a.name, b.name);
			if (filters.sort === "created") return b.createdAt.getTime() - a.createdAt.getTime();
			return b.updatedAt.getTime() - a.updatedAt.getTime();
		});
}

/** Every tag in use, alphabetically; the tag chips appear only when there are some. */
export const collectTags = (documents: readonly DocumentSummary[]) =>
	[...new Set(documents.flatMap((document) => document.tags))].sort(byName.compare);

/** Days until a document in Trash is deleted for good (at least 0). */
export function daysLeftInTrash(trashedAt: Date, now = Date.now()) {
	const left = trashedAt.getTime() + 30 * 24 * 60 * 60 * 1000 - now;
	return Math.max(0, Math.ceil(left / (24 * 60 * 60 * 1000)));
}
