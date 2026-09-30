import type { ResumeRenderOptions } from "../../context";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { filterSections } from "./filtering";

type HeaderResumeData = ResumeData & {
	renderOptions?: ResumeRenderOptions;
};

const isCoverLetterSection = (data: ResumeData, sectionId: string) =>
	data.customSections.some((section) => section.id === sectionId && section.type === "cover-letter");

const isCoverLetterOnlyDocument = (data: ResumeData) => {
	const visibleSections = data.metadata.layout.pages.flatMap((page) =>
		filterSections([...page.main, ...page.sidebar], data),
	);

	return visibleSections.length > 0 && visibleSections.every((sectionId) => isCoverLetterSection(data, sectionId));
};

export const shouldShowResumeHeader = (data: HeaderResumeData, pageIndex: number) =>
	pageIndex === 0 && (data.renderOptions?.includeCoverLetterHeader || !isCoverLetterOnlyDocument(data));
