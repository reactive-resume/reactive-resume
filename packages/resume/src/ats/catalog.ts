import type { AtsCategory, AtsSeverity } from "./types";

type AtsRuleReference = {
	severity: AtsSeverity;
	category: AtsCategory;
};

export const ATS_RULE_CATALOG_V1 = {
	MISSING_NAME: {
		severity: "error",
		category: "contact",
	},
	MISSING_EMAIL: {
		severity: "error",
		category: "contact",
	},
	MALFORMED_EMAIL: {
		severity: "error",
		category: "contact",
	},
	MISSING_PHONE: {
		severity: "warning",
		category: "contact",
	},
	MISSING_LOCATION: {
		severity: "info",
		category: "contact",
	},
	MALFORMED_URL: {
		severity: "warning",
		category: "contact",
	},
	PICTURE_PRESENT: {
		severity: "info",
		category: "contact",
	},

	EMPTY_PERIOD: {
		severity: "warning",
		category: "dates",
	},
	UNPARSEABLE_PERIOD: {
		severity: "error",
		category: "dates",
	},
	UNPARSEABLE_DATE: {
		severity: "warning",
		category: "dates",
	},
	REVERSED_PERIOD: {
		severity: "error",
		category: "dates",
	},
	FUTURE_DATED_PERIOD: {
		severity: "warning",
		category: "dates",
	},

	SECTION_MISSING_FROM_LAYOUT: {
		severity: "error",
		category: "layout",
	},
	NO_VISIBLE_EXPERIENCE: {
		severity: "warning",
		category: "headings",
	},
	MISSING_EXPERIENCE_DESCRIPTION: {
		severity: "warning",
		category: "writing",
	},
	FRAGMENTED_ENTRY: {
		severity: "warning",
		category: "writing",
	},
	NON_STANDARD_SECTION_TITLE: {
		severity: "info",
		category: "headings",
	},

	MULTI_COLUMN_PROSE_SECTION: {
		severity: "warning",
		category: "layout",
	},
	PROSE_SECTION_IN_SIDEBAR: {
		severity: "warning",
		category: "layout",
	},
	TWO_COLUMN_LAYOUT: {
		severity: "warning",
		category: "layout",
	},

	SMALL_BODY_FONT: {
		severity: "warning",
		category: "layout",
	},
	TIGHT_LINE_HEIGHT: {
		severity: "warning",
		category: "layout",
	},
	TIGHT_PAGE_MARGINS: {
		severity: "warning",
		category: "layout",
	},
} as const satisfies Readonly<Record<string, AtsRuleReference>>;

export type AtsRuleCode = keyof typeof ATS_RULE_CATALOG_V1;

export const ATS_RULE_CODES = Object.keys(ATS_RULE_CATALOG_V1) as readonly AtsRuleCode[];

/** The order Check lists its category rows in. */
export const ATS_CATEGORIES = [
	"contact",
	"dates",
	"layout",
	"headings",
	"writing",
] as const satisfies readonly AtsCategory[];

export const atsRuleSeverity = (code: AtsRuleCode): AtsSeverity => ATS_RULE_CATALOG_V1[code].severity;

export const atsRuleCategory = (code: AtsRuleCode): AtsCategory => ATS_RULE_CATALOG_V1[code].category;
