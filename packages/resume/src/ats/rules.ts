import type { AtsRuleCode } from "./catalog";
import type { AtsFinding, AtsFindingParams } from "./types";
import type { WalkedSection } from "./walk";
import type { CustomSectionType, ResumeData } from "@reactive-resume/schema/resume/data";
import { resumeDatesSchema, resumeDatesToPeriod } from "@reactive-resume/schema/resume/dates";
import {
	isFutureEndpoint,
	isReversedPeriod,
	parsePeriod,
	parseSingleDate,
} from "@reactive-resume/schema/resume/period";
import { templateLayouts } from "@reactive-resume/schema/templates";
import { atsRuleSeverity } from "./catalog";
import { SECTION_TITLE_ALIASES } from "./section-aliases";
import { isRenderedSection } from "./walk";

export type RuleContext = {
	data: ResumeData;
	sections: readonly WalkedSection[];
	locale: string;
	now: Date;
};

/** A finding as a rule reports it; the linter adds its key. */
export type AtsRuleFinding = Omit<AtsFinding, "key">;

export type AtsRule = (context: RuleContext) => AtsRuleFinding[];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const ALLOWED_URL_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

const PERIOD_REQUIRED_TYPES = new Set<CustomSectionType>(["experience", "education"]);

const PROSE_SECTION_TYPES = new Set<CustomSectionType>(["summary", "experience", "education", "projects", "volunteer"]);

const MIN_BODY_FONT_SIZE = 9;
const MIN_LINE_HEIGHT = 1.15;
const MIN_PAGE_MARGIN = 8;

function finding(code: AtsRuleCode, pointer: string, params?: AtsFindingParams): AtsRuleFinding {
	return { code, severity: atsRuleSeverity(code), pointer, ...(params ? { params } : {}) };
}

const isCoverLetter = (section: WalkedSection) => section.type === "cover-letter";

const hasText = (value: unknown) =>
	typeof value === "string" &&
	value
		.replace(/<[^>]*>/g, "")
		.replace(/&nbsp;/g, " ")
		.trim().length > 0;

function isParseableUrl(value: string): boolean {
	try {
		return ALLOWED_URL_PROTOCOLS.has(new URL(value).protocol);
	} catch {
		return false;
	}
}

const contactRules: AtsRule = (context) => {
	const { basics, picture } = context.data;
	const findings: AtsRuleFinding[] = [];

	if (!basics.name.trim()) findings.push(finding("MISSING_NAME", "/basics/name"));

	const email = basics.email.trim();
	if (email) {
		if (!EMAIL_PATTERN.test(email)) findings.push(finding("MALFORMED_EMAIL", "/basics/email", { value: email }));
	} else {
		findings.push(finding("MISSING_EMAIL", "/basics/email"));
	}

	if (!basics.phone.trim()) findings.push(finding("MISSING_PHONE", "/basics/phone"));
	if (!basics.location.trim()) findings.push(finding("MISSING_LOCATION", "/basics/location"));
	if (!picture.hidden && picture.url.trim()) findings.push(finding("PICTURE_PRESENT", "/picture"));

	return findings;
};

const urlRules: AtsRule = (context) => {
	const findings: AtsRuleFinding[] = [];

	const website = context.data.basics.website.url.trim();
	if (website && !isParseableUrl(website)) {
		findings.push(finding("MALFORMED_URL", "/basics/website/url", { value: website }));
	}

	context.data.basics.customFields.forEach((field, index) => {
		const link = field.link.trim();
		if (link && !isParseableUrl(link)) {
			findings.push(finding("MALFORMED_URL", `/basics/customFields/${index}/link`, { value: link }));
		}
	});

	for (const section of context.sections) {
		if (isCoverLetter(section) || !isRenderedSection(section)) continue;

		for (const item of section.items) {
			const itemWebsite = item.value.website as { url?: unknown } | undefined;
			const url = typeof itemWebsite?.url === "string" ? itemWebsite.url.trim() : "";
			if (url && !isParseableUrl(url)) {
				findings.push(finding("MALFORMED_URL", `${item.pointer}/website/url`, { value: url }));
			}
		}
	}

	return findings;
};

// Structured dates are read already; text that never parsed keeps its original in `raw`.
const readItemDates = (dates: unknown) => {
	const parsed = resumeDatesSchema.safeParse(dates);
	return parsed.success ? parsed.data : undefined;
};

function periodFindings(
	raw: unknown,
	dates: unknown,
	pointer: string,
	type: CustomSectionType,
	context: RuleContext,
): AtsRuleFinding[] {
	if (typeof raw !== "string") return [];

	const value = raw.trim();
	if (!value) return PERIOD_REQUIRED_TYPES.has(type) ? [finding("EMPTY_PERIOD", pointer)] : [];

	const structured = readItemDates(dates);
	const parsed = structured ? resumeDatesToPeriod(structured) : parsePeriod(value, context.locale);
	if (!parsed) return [finding("UNPARSEABLE_PERIOD", pointer, { value })];

	const findings: AtsRuleFinding[] = [];
	if (parsed.start && parsed.end && isReversedPeriod(parsed.start, parsed.end)) {
		findings.push(finding("REVERSED_PERIOD", pointer, { value }));
	}
	if (parsed.start && isFutureEndpoint(parsed.start, context.now)) {
		findings.push(finding("FUTURE_DATED_PERIOD", pointer, { value }));
	}

	return findings;
}

function singleDateFindings(raw: unknown, dates: unknown, pointer: string, context: RuleContext): AtsRuleFinding[] {
	if (typeof raw !== "string") return [];

	const value = raw.trim();
	if (!value) return [];

	const structured = readItemDates(dates);
	const readable = structured ? Boolean(structured.start) : Boolean(parseSingleDate(value, context.locale));
	return readable ? [] : [finding("UNPARSEABLE_DATE", pointer, { value })];
}

const dateRules: AtsRule = (context) => {
	const findings: AtsRuleFinding[] = [];

	for (const section of context.sections) {
		if (isCoverLetter(section) || !isRenderedSection(section)) continue;

		for (const item of section.items) {
			findings.push(
				...periodFindings(item.value.period, item.value.dates, `${item.pointer}/period`, section.type, context),
			);
			findings.push(...singleDateFindings(item.value.date, item.value.dates, `${item.pointer}/date`, context));

			const roles = item.value.roles;
			if (!Array.isArray(roles)) continue;

			roles.forEach((role, index) => {
				const { period, dates } = role as Record<string, unknown>;
				findings.push(...periodFindings(period, dates, `${item.pointer}/roles/${index}/period`, section.type, context));
			});
		}
	}

	return findings;
};

const structureRules: AtsRule = (context) => {
	const findings: AtsRuleFinding[] = [];

	// A section with no items is not reported: every template's renderer returns null before it
	// emits a heading, so an empty section produces nothing on the page rather than a bare title.
	// Only content that can never render — placed on no page at all — is worth a finding.
	for (const section of context.sections) {
		if (isCoverLetter(section) || section.hidden) continue;

		if (section.placement === "none" && section.items.length > 0) {
			findings.push(finding("SECTION_MISSING_FROM_LAYOUT", section.pointer, { section: section.id }));
		}
	}

	const experienceSections = context.sections.filter(
		(section) => section.type === "experience" && isRenderedSection(section),
	);

	if (!experienceSections.some((section) => section.items.length > 0)) {
		findings.push(finding("NO_VISIBLE_EXPERIENCE", "/sections/experience"));
	}

	for (const section of experienceSections) {
		for (const item of section.items) {
			const roles = item.value.roles;
			const roleHasText =
				Array.isArray(roles) && roles.some((role) => hasText((role as Record<string, unknown>).description));

			if (!hasText(item.value.description) && !roleHasText) {
				findings.push(finding("MISSING_EXPERIENCE_DESCRIPTION", `${item.pointer}/description`));
			}
		}
	}

	return findings;
};

/** The heading rule knows English headings only, so it applies to English resumes alone. */
export const checksSectionTitles = (locale: string) => locale.toLowerCase().startsWith("en");

const titleRules: AtsRule = (context) => {
	if (!checksSectionTitles(context.locale)) return [];

	const findings: AtsRuleFinding[] = [];

	for (const section of context.sections) {
		if (isCoverLetter(section) || !isRenderedSection(section)) continue;

		const title = section.title.trim();
		if (!title) continue;

		const aliases = SECTION_TITLE_ALIASES[section.type];
		if (!aliases || aliases.has(title.toLowerCase())) continue;

		findings.push(finding("NON_STANDARD_SECTION_TITLE", `${section.pointer}/title`, { section: section.id, title }));
	}

	return findings;
};

const layoutRules: AtsRule = (context) => {
	const findings: AtsRuleFinding[] = [];

	for (const section of context.sections) {
		if (isCoverLetter(section) || !isRenderedSection(section)) continue;
		if (!PROSE_SECTION_TYPES.has(section.type) || section.items.length === 0) continue;

		if (section.columns > 1) {
			findings.push(
				finding("MULTI_COLUMN_PROSE_SECTION", `${section.pointer}/columns`, {
					section: section.id,
					columns: section.columns,
				}),
			);
		}

		if (section.placement === "sidebar") {
			findings.push(finding("PROSE_SECTION_IN_SIDEBAR", section.pointer, { section: section.id }));
		}
	}

	return findings;
};

/**
 * A two-column template prints its sidebar as a column of its own, which most systems read after the main
 * column (or interleave with it). Full-width pages print their sidebar sections in the main column instead.
 */
const twoColumnRules: AtsRule = (context) => {
	const { layout, template } = context.data.metadata;
	if (templateLayouts[template].columns !== 2) return [];

	const printed = new Set(
		context.sections
			.filter((section) => !isCoverLetter(section) && isRenderedSection(section) && section.items.length > 0)
			.map((section) => section.id),
	);
	const sidebar = new Set(
		layout.pages.flatMap((page) => (page.fullWidth ? [] : page.sidebar.filter((id) => printed.has(id)))),
	);
	if (sidebar.size === 0) return [];

	return [finding("TWO_COLUMN_LAYOUT", "/metadata/layout/pages", { sections: [...sidebar].join(",") })];
};

const typographyRules: AtsRule = (context) => {
	const findings: AtsRuleFinding[] = [];
	const { page, typography } = context.data.metadata;

	if (typography.body.fontSize < MIN_BODY_FONT_SIZE) {
		findings.push(
			finding("SMALL_BODY_FONT", "/metadata/typography/body/fontSize", {
				fontSize: typography.body.fontSize,
				minimum: MIN_BODY_FONT_SIZE,
			}),
		);
	}

	if (typography.body.lineHeight < MIN_LINE_HEIGHT) {
		findings.push(
			finding("TIGHT_LINE_HEIGHT", "/metadata/typography/body/lineHeight", {
				lineHeight: typography.body.lineHeight,
				minimum: MIN_LINE_HEIGHT,
			}),
		);
	}

	for (const axis of ["marginX", "marginY"] as const) {
		if (page[axis] < MIN_PAGE_MARGIN) {
			findings.push(
				finding("TIGHT_PAGE_MARGINS", `/metadata/page/${axis}`, { margin: page[axis], minimum: MIN_PAGE_MARGIN }),
			);
		}
	}

	return findings;
};

export const ATS_RULES: readonly AtsRule[] = [
	contactRules,
	urlRules,
	dateRules,
	structureRules,
	titleRules,
	layoutRules,
	twoColumnRules,
	typographyRules,
];
