import type { TemplatePlacement } from "./styles";
import type { EntryHeader } from "@reactive-resume/schema/resume/data";
import { hasSplitRowText } from "./split-row";

type EntryLayout = EntryHeader["layout"];

/** Experience, Education and Volunteer take every layout; the other dated sections only move their date to a column. */
const ENTRY_LAYOUTS: Readonly<Record<string, readonly EntryLayout[]>> = {
	experience: ["stacked", "inline", "compact", "date-column", "eyebrow"],
	education: ["stacked", "inline", "compact", "date-column", "eyebrow"],
	volunteer: ["stacked", "inline", "compact", "date-column", "eyebrow"],
	projects: ["stacked", "date-column"],
	awards: ["stacked", "date-column"],
	certifications: ["stacked", "date-column"],
	publications: ["stacked", "date-column"],
};

/**
 * The layout a section's entries are drawn in. One line and Date column need the main column's width: in the sidebar
 * or in a section laid out in columns they fall back to Stacked. The renderer and the Semantic CSS tree both ask here.
 */
export const entryLayoutOf = (
	layout: EntryLayout,
	sectionType: string,
	placement: TemplatePlacement,
	columns = 1,
): EntryLayout => {
	if (!ENTRY_LAYOUTS[sectionType]?.includes(layout)) return "stacked";
	if ((layout === "inline" || layout === "date-column") && (placement === "sidebar" || columns > 1)) return "stacked";
	return layout;
};

const ROLE_FIELDS: Readonly<Record<string, string>> = { experience: "position", education: "area" };

/** Whether an entry leads with its role: only Experience and Education have one, and only when it's filled in. */
export const leadsWithRole = (
	lead: EntryHeader["lead"],
	sectionType: string,
	item: Readonly<Record<string, unknown>>,
): boolean => {
	const field = ROLE_FIELDS[sectionType];
	return lead === "role" && field !== undefined && hasSplitRowText(item[field] as string | undefined);
};
