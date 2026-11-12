import type { WriteSection } from "./model";
import { useEditorStore } from "../store";
import { createEntry, getEntries } from "./model";
import { useResumeStore } from "@/features/resume/builder/draft";

/** Opens an entry in the panel (outlining it on the page), with the first field focused for a new draft. */
export function openEntry(sectionId: string, entryId: string, options: { focus?: boolean } = {}) {
	useEditorStore.setState({ selection: { kind: "item", sectionId, itemId: entryId } });
	if (options.focus) useEditorStore.setState({ focusEntryId: entryId });
}

/** "+ Add entry": a draft entry at the end of the section, open and focused. */
export function addEntryTo(section: WriteSection) {
	const entry = createEntry(section.type);
	useResumeStore.getState().updateResumeData(
		(draft) => {
			getEntries(draft, section).push(entry);
		},
		{ newStep: true },
	);
	openEntry(section.id, entry.id, { focus: true });
}
