import type { Style } from "../../forme/style-types";
import type { ResumeData } from "@reactive-resume/schema/resume/data";

const A4_PAGE_SIZE = {
	width: 595.28,
	height: 841.89,
} as const;

export const getTemplatePageSize = (format: ResumeData["metadata"]["page"]["format"]) => {
	if (format === "free-form") return { width: A4_PAGE_SIZE.width };
	if (format === "letter") return "LETTER";

	return "A4";
};

export const getTemplatePageMinHeightStyle = (format: ResumeData["metadata"]["page"]["format"]): Style | undefined => {
	if (format !== "free-form") return undefined;

	return { minHeight: A4_PAGE_SIZE.height };
};
