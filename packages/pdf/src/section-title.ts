import type { ResumeData, SectionType } from "@reactive-resume/schema/resume/data";
import sectionTitleCatalog from "./section-title-catalog.json";

// English headings by section id (builtin) or custom section type; the catalog translates them.
const defaultEnglishTitles: Record<string, string> = {
	summary: "Summary",
	profiles: "Profiles",
	experience: "Experience",
	education: "Education",
	projects: "Projects",
	skills: "Skills",
	languages: "Languages",
	interests: "Interests",
	awards: "Awards",
	certifications: "Certifications",
	publications: "Publications",
	volunteer: "Volunteer",
	references: "References",
	"cover-letter": "Cover Letter",
};

const catalogs: Record<string, Record<string, string>> = sectionTitleCatalog;

/** The summary, a built-in section or a custom section, by id. */
export const findSection = (data: ResumeData, id: string) => {
	if (id === "summary") return data.summary;
	if (id in data.sections) return data.sections[id as SectionType];
	return data.customSections.find((section) => section.id === id);
};

/** The stored title, else the default heading translated into the resume's locale. */
export const getResumeSectionTitle = (data: ResumeData, sectionId: string, legacyFallback?: string) => {
	const section = findSection(data, sectionId);
	if (!section) return legacyFallback ?? sectionId;
	if (section.title.trim()) return section.title;

	const type = "type" in section ? section.type : sectionId;
	const english = defaultEnglishTitles[type] ?? type;
	const locale = data.metadata.page.locale;
	return (Object.hasOwn(catalogs, locale) ? catalogs[locale]?.[english] : undefined) ?? english;
};
