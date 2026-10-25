import type { Entry, WriteSection } from "./model";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { WritableDraft } from "immer";
import { useLingui } from "@lingui/react/macro";
import { useCallback } from "react";
import { sortSectionItemsByPeriod } from "@reactive-resume/resume/section-sort";
import { SECTION_TITLES } from "./fields";
import { createEntry, findEntry, getEntries, getSectionObject, readData } from "./model";
import { useResumeStore } from "@/draft";
import { showToast } from "@/ui";

/** Reads from the open resume's data. Return stable values (data sub-objects or primitives). */
export function useWriteData<T>(select: (data: ResumeData) => T, fallback: T): T {
	return useResumeStore(readData(select, fallback));
}

/** One entry, re-rendering only when it changes; null once it's deleted. */
export const useEntry = (sectionId: string, entryId: string) =>
	useWriteData((data) => findEntry(data, sectionId, entryId) ?? null, null);

export type EntryWriter = (key: string, mutate: (entry: Record<string, unknown>) => void) => void;

/** Writes one field of an entry. Typing in one field folds into one undo step; another field starts a new one. */
export function useEntryWriter(sectionId: string, entryId: string): EntryWriter {
	const update = useResumeStore((state) => state.update);
	return useCallback(
		(key, mutate) =>
			update(
				(draft) => {
					const entry = findEntry(draft, sectionId, entryId);
					if (entry) mutate(entry as Entry & Record<string, unknown>);
				},
				{ coalesceKey: `${entryId}:${key}` },
			),
		[update, sectionId, entryId],
	);
}

/** Adding, moving or deleting: always an undo step of its own. */
export const edit = (recipe: (draft: WritableDraft<ResumeData>) => void) =>
	useResumeStore.getState().update(recipe, { newStep: true });

/** The printed title: the one the user gave, else the section type's name. */
export function useSectionTitle(section: WriteSection | null) {
	const { i18n } = useLingui();
	const title = useWriteData((data) => (section ? (getSectionObject(data, section)?.title ?? "") : ""), "");
	return title.trim() || (section ? i18n._(SECTION_TITLES[section.type]) : "");
}

/** A toast with Undo, for destructive edits that don't ask first. */
export function useUndoToast() {
	const { t } = useLingui();
	return (message: string) =>
		showToast({ message, action: { label: t`Undo`, onPress: () => useResumeStore.getState().undo() } });
}

/** "+ Add {type}": a draft entry at the end of the section. Returns its id. */
export function addEntry(section: WriteSection): string {
	const entry = createEntry(section.type);
	edit((draft) => {
		getEntries(draft, section).push(entry);
	});
	return entry.id;
}

export function useDeleteEntry() {
	const { t } = useLingui();
	const undoToast = useUndoToast();
	return (section: WriteSection, entryId: string) => {
		edit((draft) => {
			const entries = getEntries(draft, section);
			const index = entries.findIndex((entry) => entry.id === entryId);
			if (index !== -1) entries.splice(index, 1);
		});
		undoToast(t`Entry deleted`);
	};
}

/** Sort by date (experience and education). Entries it can't read stay at the end, named in a warning. */
export function useSortByDate() {
	const { t } = useLingui();
	return (section: WriteSection) => {
		let unresolved: string[] = [];
		edit((draft) => {
			type Sortable = { id: string; period: string; company?: string; school?: string };
			const entries = getEntries(draft, section) as never as Sortable[];
			const result = sortSectionItemsByPeriod(entries, draft.metadata.page.locale);
			unresolved = result.unresolvedIds.map((id) => {
				const entry = entries.find((item) => item.id === id);
				return (entry?.company || entry?.school || id).trim();
			});
			entries.splice(0, entries.length, ...result.items);
		});
		if (unresolved.length > 0)
			showToast({ message: t`Couldn't sort these items, so they stayed at the end: ${unresolved.join(", ")}.` });
	};
}

// A new draft entry opens with its first field focused; later openings don't steal focus again.
let focusNext: string | null = null;
export const requestFocus = (entryId: string) => {
	focusNext = entryId;
};
export function consumeFocus(entryId: string) {
	if (focusNext !== entryId) return false;
	focusNext = null;
	return true;
}
