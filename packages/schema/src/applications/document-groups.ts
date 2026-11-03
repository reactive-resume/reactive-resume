import type { ApplicationStatus } from "./data";

type GroupableDocument = {
	type: "resume" | "letter";
	id: string;
	application: { id: string; company: string; role: string; status: ApplicationStatus } | null;
};

export type DocumentGroup<T extends GroupableDocument> =
	| {
			kind: "application";
			key: string;
			/** The job every document in the group was made for. */
			application: NonNullable<T["application"]>;
			documents: T[];
			/** A closed job's documents start under a collapsed heading. */
			closed: boolean;
	  }
	| {
			kind: "document";
			key: string;
			application: null;
			documents: [T];
			closed: false;
	  };

/** A stable key for a group's heading, used for expansion state and list keys. */
export function documentGroupKey(document: GroupableDocument): string {
	return document.application ? `application:${document.application.id}` : `document:${document.type}:${document.id}`;
}

/**
 * Groups each application's resume and letter under the job they share, leaving other documents in place. The
 * library's order is kept: a group appears where its first document does, and documents inside it keep their order.
 * Filters, page boundaries and selection stay the caller's; this only arranges the documents it is given.
 */
export function groupDocumentsByApplication<T extends GroupableDocument>(documents: readonly T[]): DocumentGroup<T>[] {
	const groups = new Map<string, DocumentGroup<T>>();
	const order: string[] = [];

	for (const document of documents) {
		const key = documentGroupKey(document);
		const existing = groups.get(key);
		if (existing?.kind === "application") {
			existing.documents.push(document);
			continue;
		}
		order.push(key);
		groups.set(
			key,
			document.application
				? {
						kind: "application",
						key,
						application: document.application,
						documents: [document],
						closed: document.application.status === "closed",
					}
				: { kind: "document", key, application: null, documents: [document], closed: false },
		);
	}

	return order.flatMap((key) => {
		const group = groups.get(key);
		return group ? [group] : [];
	});
}

/** Whether a group's documents are shown: closed jobs start collapsed, every other group starts expanded. */
export function groupIsExpanded(closed: boolean, overrides: ReadonlyMap<string, boolean>, key: string): boolean {
	return overrides.get(key) ?? !closed;
}
