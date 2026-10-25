import type { CustomSectionType, ResumeData } from "@reactive-resume/schema/resume/data";
import { getSectionTitle as getDefaultSectionTitle } from "./section";

export { moveItem } from "@reactive-resume/resume/move-item";

/** A custom section's own title, or the localized default title for its type. */
export function getSourceSectionTitle(
	resumeData: ResumeData,
	type: CustomSectionType,
	customSectionId?: string,
): string {
	const title = customSectionId ? resumeData.customSections.find((s) => s.id === customSectionId)?.title : undefined;
	return title?.trim() || getDefaultSectionTitle(type);
}

/** Sections of the same type on each page an item can move to, excluding its own section. */
export function getCompatibleMoveTargets(
	resumeData: ResumeData,
	sourceType: CustomSectionType,
	sourceSectionId: string | undefined,
): { pageIndex: number; sections: { sectionId: string; sectionTitle: string }[] }[] {
	const customSectionById = new Map(resumeData.customSections.map((section) => [section.id, section]));

	return resumeData.metadata.layout.pages.map((page, pageIndex) => ({
		pageIndex,
		sections: [...page.main, ...page.sidebar].flatMap((sectionId) => {
			if (sectionId === (sourceSectionId ?? sourceType)) return [];
			if (sectionId in resumeData.sections && sectionId === sourceType)
				return [{ sectionId, sectionTitle: getDefaultSectionTitle(sourceType) }];
			const custom = customSectionById.get(sectionId);
			if (custom?.type !== sourceType) return [];
			return [{ sectionId, sectionTitle: custom.title.trim() || getDefaultSectionTitle(custom.type) }];
		}),
	}));
}
