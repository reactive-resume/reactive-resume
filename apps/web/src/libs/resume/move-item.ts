import type {
	CustomSection,
	CustomSectionType,
	ResumeData,
	SectionItem,
	SectionType,
} from "@reactive-resume/schema/resume/data";
import type { WritableDraft } from "immer";
import { generateId } from "@reactive-resume/utils/string";
import { getSectionTitle as getDefaultSectionTitle } from "./section";

// ============================================================================
// Types
// ============================================================================

/** Target section that an item can be moved to */
type MoveTargetSection = {
	sectionId: string;
	sectionTitle: string;
	/** Whether this is a standard section (true) or custom section (false) */
	isStandard: boolean;
};

/** Page with its compatible sections for the move menu */
type MoveTargetPage = {
	pageIndex: number;
	sections: MoveTargetSection[];
};

// ============================================================================
// Helper Functions
// ============================================================================

// ponytail: derive standard section membership from data instead of a hand-maintained list
function isStandardSectionId(sectionId: string, sections: Record<string, unknown>): sectionId is SectionType {
	return sectionId in sections;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Gets the title of a section.
 * For standard sections, returns the localized default title.
 * For custom sections, returns the user-defined title.
 *
 * @param resumeData - The resume data object
 * @param type - The section type
 * @param customSectionId - The custom section ID (if applicable)
 * @returns The section title
 */
export function getSourceSectionTitle(
	resumeData: ResumeData,
	type: CustomSectionType,
	customSectionId?: string,
): string {
	if (customSectionId) {
		const customSection = resumeData.customSections.find((s) => s.id === customSectionId);
		return customSection?.title.trim() || getDefaultSectionTitle(type);
	}

	return getDefaultSectionTitle(type);
}

/**
 * Finds all compatible sections an item can be moved to.
 * A section is compatible if it has the same type as the source section.
 *
 * @param resumeData - The resume data object
 * @param sourceType - The type of the source section
 * @param sourceSectionId - The ID of the source section (custom section ID or undefined for standard)
 * @returns Array of pages with their compatible sections
 */
export function getCompatibleMoveTargets(
	resumeData: ResumeData,
	sourceType: CustomSectionType,
	sourceSectionId: string | undefined,
): MoveTargetPage[] {
	const { pages } = resumeData.metadata.layout;
	const customSectionById = new Map(resumeData.customSections.map((section) => [section.id, section]));
	const result: MoveTargetPage[] = [];

	for (const [pageIndex, page] of pages.entries()) {
		const allSectionIds = [...page.main, ...page.sidebar];
		const compatibleSections: MoveTargetSection[] = [];

		for (const sectionId of allSectionIds) {
			// Skip the source section itself
			if (sectionId === sourceSectionId || (sourceSectionId === undefined && sectionId === sourceType)) {
				continue;
			}

			// Check if it's a standard section with matching type
			if (isStandardSectionId(sectionId, resumeData.sections) && sectionId === sourceType) {
				compatibleSections.push({
					sectionId,
					sectionTitle: getDefaultSectionTitle(sectionId),
					isStandard: true,
				});
				continue;
			}

			// Check if it's a custom section with matching type
			const customSection = customSectionById.get(sectionId);
			if (customSection && customSection.type === sourceType) {
				compatibleSections.push({
					sectionId: customSection.id,
					sectionTitle: customSection.title.trim() || getDefaultSectionTitle(customSection.type),
					isStandard: false,
				});
			}
		}

		result.push({ pageIndex, sections: compatibleSections });
	}

	return result;
}

/**
 * Removes an item from its source section (standard or custom).
 *
 * @param draft - The immer draft of resume data
 * @param itemId - The ID of the item to remove
 * @param type - The section type
 * @param customSectionId - The custom section ID (if applicable)
 * @returns The removed item, or null if not found
 */
function removeItemFromSource(
	draft: WritableDraft<ResumeData>,
	itemId: string,
	type: CustomSectionType,
	customSectionId?: string,
): SectionItem | null {
	if (customSectionId) {
		const section = draft.customSections.find((s) => s.id === customSectionId);
		if (!section) return null;

		const index = section.items.findIndex((item) => item.id === itemId);
		if (index === -1) return null;

		const [removed] = section.items.splice(index, 1);
		return removed as SectionItem;
	}

	// Type assertion: when customSectionId is not provided, type is always a built-in SectionType
	const section = draft.sections[type as SectionType];
	if (!("items" in section)) return null;

	const index = section.items.findIndex((item) => item.id === itemId);
	if (index === -1) return null;

	const [removed] = section.items.splice(index, 1);
	return removed as SectionItem;
}

/**
 * Adds an item to a target section.
 *
 * @param draft - The immer draft of resume data
 * @param item - The item to add
 * @param targetSectionId - The target section ID
 * @param type - The section type
 */
function addItemToSection(
	draft: WritableDraft<ResumeData>,
	item: SectionItem,
	targetSectionId: string,
	type: CustomSectionType,
): void {
	// Check if target is a standard section
	if (isStandardSectionId(targetSectionId, draft.sections) && targetSectionId === type) {
		const section = draft.sections[type as SectionType];
		if ("items" in section) {
			section.items.push(item as never);
		}
		return;
	}

	// Otherwise, it's a custom section
	const customSection = draft.customSections.find((s) => s.id === targetSectionId);
	if (customSection) {
		customSection.items.push(item as never);
	}
}

/**
 * Creates a new custom section with the given item and adds it to the specified page.
 *
 * @param draft - The immer draft of resume data
 * @param item - The item to add to the new section
 * @param type - The section type for the new custom section
 * @param sectionTitle - The title for the new custom section
 * @param targetPageIndex - The page index to add the section to
 * @returns The ID of the newly created custom section
 */
function makeCustomSection(id: string, type: CustomSectionType, title: string, item: SectionItem): CustomSection {
	return {
		id,
		type,
		title,
		icon: "",
		columns: 1,
		hidden: false,
		showHeading: true,
		keepTogether: false,
		startOnNewPage: false,
		items: [item as never],
	};
}

function createCustomSectionWithItem(
	draft: WritableDraft<ResumeData>,
	item: SectionItem,
	type: CustomSectionType,
	sectionTitle: string,
	targetPageIndex: number,
): string {
	const newSectionId = generateId();
	draft.customSections.push(makeCustomSection(newSectionId, type, sectionTitle, item) as WritableDraft<CustomSection>);

	const page = draft.metadata.layout.pages[targetPageIndex];
	if (page) page.main.push(newSectionId);

	return newSectionId;
}

function createPageWithSection(
	draft: WritableDraft<ResumeData>,
	item: SectionItem,
	type: CustomSectionType,
	sectionTitle: string,
): void {
	const newSectionId = generateId();
	draft.customSections.push(makeCustomSection(newSectionId, type, sectionTitle, item) as WritableDraft<CustomSection>);
	draft.metadata.layout.pages.push({ fullWidth: false, main: [newSectionId], sidebar: [] });
}

type MoveItemInput = {
	itemId: string;
	type: CustomSectionType;
	customSectionId?: string | undefined;
	target:
		| { type: "section"; sectionId: string }
		| { type: "new-section"; pageIndex: number; title: string }
		| { type: "new-page"; title: string };
};

/** Moves an item atomically, then removes only custom source sections emptied by that move. */
export function moveItem(draft: WritableDraft<ResumeData>, input: MoveItemInput): void {
	const { itemId, type, customSectionId, target } = input;
	const source = customSectionId
		? draft.customSections.find((section) => section.id === customSectionId && section.type === type)
		: draft.sections[type as SectionType];
	if (!source?.items.some((item) => item.id === itemId)) return;

	if (target.type === "section") {
		if (target.sectionId === (customSectionId ?? type)) return;
		const compatible = isStandardSectionId(target.sectionId, draft.sections)
			? target.sectionId === type
			: draft.customSections.some((section) => section.id === target.sectionId && section.type === type);
		if (!compatible) return;
	} else if (target.type === "new-section" && !draft.metadata.layout.pages[target.pageIndex]) return;

	const item = removeItemFromSource(draft, itemId, type, customSectionId);
	if (!item) return;
	if (target.type === "section") addItemToSection(draft, item, target.sectionId, type);
	else if (target.type === "new-section")
		createCustomSectionWithItem(draft, item, type, target.title, target.pageIndex);
	else createPageWithSection(draft, item, type, target.title);

	// Insert first so removing the source page cannot change the chosen destination index.
	if (!customSectionId || source.items.length > 0) return;
	draft.customSections = draft.customSections.filter((section) => section.id !== customSectionId);
	draft.metadata.layout.pages = draft.metadata.layout.pages.filter((page, index) => {
		const affected = page.main.includes(customSectionId) || page.sidebar.includes(customSectionId);
		if (!affected) return true;
		page.main = page.main.filter((sectionId) => sectionId !== customSectionId);
		page.sidebar = page.sidebar.filter((sectionId) => sectionId !== customSectionId);
		// Keep the header page and any page with other references, even if those sections are hidden.
		return index === 0 || page.main.length > 0 || page.sidebar.length > 0;
	});
}
