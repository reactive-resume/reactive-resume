import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { resumeDataSchema, sectionTypeSchema } from "@reactive-resume/schema/resume/data";
import { rethrowAsImportError } from "./error";

const BUILT_IN_LAYOUT_SECTION_IDS = sectionTypeSchema.options.filter((section) => section !== "cover-letter");

/** Recovers built-in sections missing from the layout (or a layout with no pages) without reordering it. */
function normalizeBuiltInSectionsInLayout(data: ResumeData): ResumeData {
	const { pages } = data.metadata.layout;
	const present = new Set(pages.flatMap((page) => [...page.main, ...page.sidebar]));
	const missing = BUILT_IN_LAYOUT_SECTION_IDS.filter((sectionId) => !present.has(sectionId));
	if (missing.length === 0) return data;

	const [first = { fullWidth: false, main: [], sidebar: [] }, ...rest] = pages;
	const layout = { ...data.metadata.layout, pages: [{ ...first, main: [...first.main, ...missing] }, ...rest] };
	return { ...data, metadata: { ...data.metadata, layout } };
}

// ponytail: stateless single-method class → plain function
export function parseReactiveResumeJSON(json: string): ResumeData {
	try {
		const parsed = resumeDataSchema.parse(JSON.parse(json));
		return resumeDataSchema.parse(normalizeBuiltInSectionsInLayout(parsed));
	} catch (error) {
		rethrowAsImportError(error);
	}
}
