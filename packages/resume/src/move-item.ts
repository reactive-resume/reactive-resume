import type { CustomSection, CustomSectionType, ResumeData, SectionType } from "@reactive-resume/schema/resume/data";
import { generateId } from "@reactive-resume/utils/string";

export type MoveTarget =
	| { type: "section"; sectionId: string }
	| { type: "new-section"; pageIndex: number; title: string }
	| { type: "new-page"; title: string };

export type MoveItemInput = {
	itemId: string;
	type: CustomSectionType;
	customSectionId?: string | undefined;
	target: MoveTarget;
};

/** Moves an item atomically (pass an immer draft), then removes only a custom source section emptied by that move. */
export function moveItem(draft: ResumeData, input: MoveItemInput): void {
	const { itemId, type, customSectionId, target } = input;
	const source = customSectionId
		? draft.customSections.find((section) => section.id === customSectionId && section.type === type)
		: draft.sections[type as SectionType];
	const index = source?.items.findIndex((item) => item.id === itemId) ?? -1;
	if (!source || index === -1) return;

	if (target.type === "section") {
		if (target.sectionId === (customSectionId ?? type)) return;
		const destination =
			target.sectionId in draft.sections
				? target.sectionId === type
					? draft.sections[type as SectionType]
					: undefined
				: draft.customSections.find((section) => section.id === target.sectionId && section.type === type);
		if (!destination) return;
		destination.items.push(...(source.items.splice(index, 1) as never[]));
	} else {
		if (target.type === "new-section" && !draft.metadata.layout.pages[target.pageIndex]) return;
		const id = generateId();
		const section: CustomSection = {
			id,
			type,
			title: target.title,
			icon: "",
			columns: 1,
			hidden: false,
			showHeading: true,
			keepTogether: false,
			startOnNewPage: false,
			items: source.items.splice(index, 1) as never[],
		};
		draft.customSections.push(section);
		if (target.type === "new-section") draft.metadata.layout.pages[target.pageIndex]?.main.push(id);
		else draft.metadata.layout.pages.push({ fullWidth: false, main: [id], sidebar: [] });
	}

	// Insert first so removing the source page cannot change the chosen destination index.
	if (!customSectionId || source.items.length > 0) return;
	draft.customSections = draft.customSections.filter((section) => section.id !== customSectionId);
	draft.metadata.layout.pages = draft.metadata.layout.pages.filter((page, pageIndex) => {
		const affected = page.main.includes(customSectionId) || page.sidebar.includes(customSectionId);
		if (!affected) return true;
		page.main = page.main.filter((id) => id !== customSectionId);
		page.sidebar = page.sidebar.filter((id) => id !== customSectionId);
		// Keep the header page and any page with other references, even if those sections are hidden.
		return pageIndex === 0 || page.main.length > 0 || page.sidebar.length > 0;
	});
}
