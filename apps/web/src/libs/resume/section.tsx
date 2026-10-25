import type { SectionType } from "@reactive-resume/schema/resume/data";
import { t } from "@lingui/core/macro";
import { match } from "ts-pattern";

type LeftSidebarSection = "picture" | "basics" | "summary" | SectionType | "custom";

// CustomSectionType values that are not in SectionType (used in custom sections only)
type CustomOnlyType = "cover-letter";

export type RightSidebarSection =
	| "template"
	| "layout"
	| "typography"
	| "design"
	| "styles"
	| "page"
	| "notes"
	| "sharing"
	| "statistics"
	| "export";

export type SidebarSection = LeftSidebarSection | RightSidebarSection;

export const getSectionTitle = (type: SidebarSection | CustomOnlyType): string => {
	return (
		match(type)
			// Left Sidebar Sections
			.with("picture", () => t`Picture`)
			.with("basics", () => t`Basics`)
			.with("summary", () => t`Summary`)
			.with("profiles", () => t`Profiles`)
			.with("experience", () => t`Experience`)
			.with("education", () => t`Education`)
			.with("projects", () => t`Projects`)
			.with("skills", () => t`Skills`)
			.with("languages", () => t`Languages`)
			.with("interests", () => t`Interests`)
			.with("awards", () => t`Awards`)
			.with("certifications", () => t`Certifications`)
			.with("publications", () => t`Publications`)
			.with("volunteer", () => t`Volunteer`)
			.with("references", () => t`References`)
			.with("custom", () => t`Custom sections`)

			// Custom Section Types (not in main sidebar)
			// Title case on purpose: this msgid is also the PDF section heading (tooling/locales/section-titles.ts).
			.with("cover-letter", () => t`Cover Letter`)

			// Right Sidebar Sections
			.with("template", () => t`Template`)
			.with("layout", () => t`Layout`)
			.with("typography", () => t`Typography`)
			.with("design", () => t`Design`)
			.with("styles", () => t`Custom styles`)
			.with("page", () => t`Page`)
			.with("notes", () => t`Notes`)
			.with("sharing", () => t`Sharing`)
			.with("statistics", () => t`Statistics`)
			.with("export", () => t`Export`)

			.exhaustive()
	);
};
