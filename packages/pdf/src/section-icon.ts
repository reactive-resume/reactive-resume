import type { ResumeData, SectionType } from "@reactive-resume/schema/resume/data";
import { getDefaultSectionIconName } from "@reactive-resume/schema/resume/section-icons";

export const getResumeSectionIcon = (data: ResumeData, sectionId: string): string => {
	if (sectionId === "summary") {
		const icon = data.summary.icon;
		if (icon === "none") return "";
		return icon || getDefaultSectionIconName("summary");
	}

	if (sectionId in data.sections) {
		const sectionType = sectionId as SectionType;
		const icon = data.sections[sectionType].icon;
		if (icon === "none") return "";
		return icon || getDefaultSectionIconName(sectionType);
	}

	const customSection = data.customSections.find((section) => section.id === sectionId);
	if (!customSection) return "";

	const icon = customSection.icon;
	if (icon === "none") return "";
	// For custom sections, fall back to the default icon of their base type
	return icon || getDefaultSectionIconName(customSection.type);
};
