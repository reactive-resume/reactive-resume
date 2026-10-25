import type { ResumeData } from "@reactive-resume/schema/resume/data";

export type ResumeExportTarget = "resume" | "cover-letter";

const isCoverLetterSection = (section: ResumeData["customSections"][number]) => section.type === "cover-letter";

const isVisibleCoverLetterSection = (section: ResumeData["customSections"][number]) =>
	isCoverLetterSection(section) && !section.hidden && section.items.some((item) => !item.hidden);

export const getVisibleCoverLetterSectionIds = (data: ResumeData) =>
	data.customSections.filter(isVisibleCoverLetterSection).map((section) => section.id);

/** True when every laid-out section is a visible cover letter; such a document prints no resume header. */
export function isCoverLetterOnlyDocument(data: ResumeData): boolean {
	const sectionIds = data.metadata.layout.pages.flatMap((page) => [...page.main, ...page.sidebar]);
	const letterIds = new Set(getVisibleCoverLetterSectionIds(data));
	return sectionIds.length > 0 && sectionIds.every((sectionId) => letterIds.has(sectionId));
}

export function getResumeExportData(data: ResumeData, target: ResumeExportTarget): ResumeData {
	const allCoverLetterIds = new Set(data.customSections.filter(isCoverLetterSection).map((section) => section.id));
	const visibleCoverLetterIds = new Set(getVisibleCoverLetterSectionIds(data));
	const keepSection =
		target === "cover-letter"
			? (id: string) => visibleCoverLetterIds.has(id)
			: (id: string) => !allCoverLetterIds.has(id);

	const pages = data.metadata.layout.pages
		.map((page) => {
			if (target === "cover-letter") {
				return { fullWidth: true, main: [...page.main, ...page.sidebar].filter(keepSection), sidebar: [] };
			}

			return { ...page, main: page.main.filter(keepSection), sidebar: page.sidebar.filter(keepSection) };
		})
		.filter((page) => page.main.length > 0 || page.sidebar.length > 0);

	if (target === "cover-letter" && pages.length === 0 && visibleCoverLetterIds.size > 0) {
		for (const id of visibleCoverLetterIds) pages.push({ fullWidth: true, main: [id], sidebar: [] });
	}

	return {
		...data,
		customSections:
			target === "cover-letter"
				? data.customSections.filter((section) => visibleCoverLetterIds.has(section.id))
				: data.customSections.filter((section) => !isCoverLetterSection(section)),
		metadata: {
			...data.metadata,
			layout: {
				...data.metadata.layout,
				pages: pages.length > 0 ? pages : [{ fullWidth: true, main: [], sidebar: [] }],
			},
		},
	};
}
