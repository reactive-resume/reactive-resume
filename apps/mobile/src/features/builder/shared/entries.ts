// Entry actions shared by B2 (swipe, hold), B3 (Delete entry, ···) and B21: each is one undo step, and the
// reversible ones offer Undo in a toast as well as in the status line.
import type { CustomSectionItem } from "@reactive-resume/schema/resume/data";
import { t } from "@lingui/core/macro";
import { createEntry } from "@reactive-resume/resume/entries";
import { generateId } from "@reactive-resume/utils/string";
import { editResume } from "./document";
import { type BuilderSection, getEntries } from "./model";
import { useResumeStore } from "@/data";
import { haptic, showToast } from "@/ui";

const undoAction = () => ({ label: t`Undo`, onPress: () => useResumeStore.getState().undo() });

/** Delete entry: no dialog; the row folds and the toast offers Undo. `light` lands with it. */
export function deleteEntry(section: BuilderSection, entryId: string, message = t`Entry deleted`) {
	editResume((d) => {
		const list = getEntries(d, section);
		const index = list.findIndex((e) => e.id === entryId);
		if (index >= 0) list.splice(index, 1);
	});
	haptic("light");
	showToast({ message, action: undoAction() });
}

/** Duplicate adds the copy under the original. */
export function duplicateEntry(section: BuilderSection, entryId: string) {
	editResume((d) => {
		const list = getEntries(d, section);
		const index = list.findIndex((e) => e.id === entryId);
		const original = list[index];
		if (original) list.splice(index + 1, 0, { ...structuredClone(original), id: generateId() } as typeof original);
	});
	showToast({ message: t`Entry duplicated`, action: undoAction() });
}

export function toggleEntryHidden(section: BuilderSection, entryId: string) {
	editResume((d) => {
		const entry = getEntries(d, section).find((e) => e.id === entryId);
		if (entry) entry.hidden = !entry.hidden;
	});
}

/** Move up / Move down; `selection` per step. */
export function moveEntry(section: BuilderSection, entryId: string, step: -1 | 1) {
	editResume((d) => {
		const list = getEntries(d, section);
		const from = list.findIndex((e) => e.id === entryId);
		const to = from + step;
		if (from < 0 || to < 0 || to >= list.length) return;
		const [moved] = list.splice(from, 1);
		if (moved) list.splice(to, 0, moved);
	});
	haptic("selection");
}

/** B20: the first character typed creates the entry at the end of the section, with that change in it. */
export function createEntryWith(section: BuilderSection, apply: (entry: CustomSectionItem) => void): string {
	const entry = createEntry(section.type);
	apply(entry);
	editResume((d) => {
		getEntries(d, section).push(entry as never);
	});
	return entry.id;
}
