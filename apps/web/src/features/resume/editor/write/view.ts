import type { EditorSelection } from "../store";
import { isSameSelection, useEditorStore } from "../store";

/**
 * Write shows one thing at a time: the outline of sections, one section and its entries, or one entry. Which one is the
 * editor's selection, so the panel and the page always agree: nothing selected is the outline, the header is Basics,
 * a section is its list, an entry is its fields. `?section=` and `?entry=` mirror it, so Back steps up and links hold.
 */
export type WriteView =
	| { kind: "outline" }
	| { kind: "basics" }
	| { kind: "section"; sectionId: string }
	| { kind: "entry"; sectionId: string; entryId: string };

/** The id Basics has wherever a section id is expected (`?section=basics`, `#sidebar-basics`). */
export const BASICS = "basics";

export function viewOf(selection: EditorSelection | null): WriteView {
	if (!selection) return { kind: "outline" };
	if (selection.kind === "header") return { kind: "basics" };
	if (selection.kind === "item") return { kind: "entry", sectionId: selection.sectionId, entryId: selection.itemId };
	return { kind: "section", sectionId: selection.sectionId };
}

export type WriteSearch = { section?: string | undefined; entry?: string | undefined };

export function searchOf(selection: EditorSelection | null): WriteSearch {
	if (!selection) return { section: undefined, entry: undefined };
	if (selection.kind === "header") return { section: BASICS, entry: undefined };
	if (selection.kind === "item") return { section: selection.sectionId, entry: selection.itemId };
	return { section: selection.sectionId, entry: undefined };
}

export function selectionOf({ section, entry }: WriteSearch): EditorSelection | null {
	if (!section) return null;
	if (section === BASICS) return { kind: "header" };
	return entry ? { kind: "item", sectionId: section, itemId: entry } : { kind: "section", sectionId: section };
}

const select = (selection: EditorSelection | null) => {
	if (!isSameSelection(useEditorStore.getState().selection, selection)) useEditorStore.setState({ selection });
};

/** Back to the outline of sections. */
export const openOutline = () => select(null);

/** Opens a section's list of entries (the summary's text, or Basics by its id). */
export const openSection = (sectionId: string) =>
	select(sectionId === BASICS ? { kind: "header" } : { kind: "section", sectionId });

/** One level up: an entry to its section, a section or Basics to the outline. */
export function stepUp() {
	const { selection } = useEditorStore.getState();
	if (selection?.kind === "item") select({ kind: "section", sectionId: selection.sectionId });
	else select(null);
}
