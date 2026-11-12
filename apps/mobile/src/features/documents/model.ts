import type { useDocuments, TrashRef } from "@/data";

export type Document = NonNullable<ReturnType<typeof useDocuments>["data"]>[number];

export function parseDocumentTags(value: string): string[] | null {
	const tags = [
		...new Set(
			value
				.split(",")
				.map((tag) => tag.trim())
				.filter(Boolean),
		),
	];
	return tags.length > 20 || tags.some((tag) => tag.length > 40) ? null : tags;
}
export const documentHref = (document: { type: string; id: string }) =>
	document.type === "application"
		? `/applications/${document.id}`
		: document.type === "letter"
			? `/letter/${document.id}`
			: `/builder/${document.id}`;

export function daysLeft(trashedAt: Date, now: Date): number {
	return Math.max(0, Math.ceil((trashedAt.getTime() + 30 * 86_400_000 - now.getTime()) / 86_400_000));
}

/** Confirmation holds these exact refs; items arriving in Trash later are never silently included. */
export function destructionCounts(refs: readonly TrashRef[]) {
	return {
		documents: refs.filter((ref) => ref.type !== "application").length,
		applications: refs.filter((ref) => ref.type === "application").length,
	};
}
