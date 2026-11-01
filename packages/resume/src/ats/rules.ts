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
import { stripHtml } from "@reactive-resume/utils/string";
import { atsRuleSeverity } from "./catalog";
import { carriesUnmergedFields } from "./merge";
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
	stripHtml(value)
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

/** The heading fields an import can split, each judged on its own: employer and title; school, degree and field. */
const HEADING_FIELDS: Partial<Record<CustomSectionType, readonly string[]>> = {
	experience: ["company", "position"],
	education: ["school", "degree", "area"],
};

/**
 * Words a sentence can't end on: conjunctions, articles, possessives and prepositions, in lower case and on their own
 * (not "sign-on", "Vipps AS" or "Series A"). Particles a phrasal verb ends on ("logged in", "took over") are left out.
 */
const DANGLING_WORD =
	/(?:^|\s)(?:and|or|but|nor|by|of|to|the|for|with|from|as|into|onto|than|that|which|while|across|per|via|through|using|including|during|within|between|without|among|toward|towards|against|a|an|our|their|its|my|your|whose)$/;
/** Words that continue a sentence: a heading that opens on one was cut from the text above. */
const CONTINUING_WORD = /^(?:and|or|but|which|while|then|so|to|with|by|of|for|including|plus)\s/;
const MAX_HEADING_WORDS = 10;
/** How a sentence or bullet closes. A line without one is still open, unless the writer never closes lines. */
const CLOSING_PUNCTUATION = /[.!?…"”)]$/;

const textOf = (value: unknown) =>
	typeof value === "string"
		? stripHtml(value)
				.replace(/&nbsp;/g, " ")
				.trim()
		: "";

/** The description's lines: its paragraphs, bullets and line breaks. */
const linesOf = (value: unknown) =>
	typeof value === "string"
		? value
				.split(/<\/(?:p|li|h\d)>|<br\s*\/?>/i)
				.map(textOf)
				.filter(Boolean)
		: [];

/** Text that stops on a comma, dash or dangling word: the sentence goes on somewhere else. */
const endsMidSentence = (text: string) => /[,;:\u2013\u2014-]$/.test(text) || DANGLING_WORD.test(text);

/** A field cut out of a sentence: it ends mid-sentence, or opens on a continuing word. */
const isCutMidSentence = (text: string) => endsMidSentence(text) || CONTINUING_WORD.test(text);

/** How the text above ends: cut on a dangling word or comma, or only open (its last line has no closing punctuation). */
type AboveEnding = { cut: boolean; open: boolean };

function aboveEnding(value: Readonly<Record<string, unknown>>): AboveEnding {
	const lines = linesOf(value.description);
	const last = lines.at(-1) ?? "";
	// Bullets written without full stops aren't open sentences: only a line left open among closed ones, or a lone
	// line, says the sentence went on.
	const closesLines = lines.length === 1 || lines.slice(0, -1).some((line) => CLOSING_PUNCTUATION.test(line));
	return { cut: endsMidSentence(last), open: last.length > 0 && !CLOSING_PUNCTUATION.test(last) && closesLines };
}

/**
 * A heading that is the rest of a sentence from the entry above: it ends or opens like a cut ("…time by", "and kept…");
 * or the text above was cut and it runs on for more than 10 words; or the text above is open and it reads as prose,
 * opening on an ordinary lower-case word ("uptime above target…", "team by 40%…", "25% across…"). "Senior Vice
 * President of Global Engineering Operations", "eBay Marketplace" and "iOS platform lead" are real headings.
 */
function readsAsSentence(text: string, above: AboveEnding): boolean {
	if ((above.cut || above.open) && isCutMidSentence(text)) return true;
	const words = text.split(/\s+/).filter(Boolean);
	if (
		words.length > MAX_HEADING_WORDS &&
		(above.cut ||
			(isCutMidSentence(text) && /\b(?:built|shipped|reduced|led|delivered|managed|improved|mentored)\b/i.test(text)))
	)
		return true;
	const prose = /^(?:[\d•·*-]|\p{Ll}[^\p{Lu}]*$)/u.test(words[0] ?? "");
	return (above.cut || above.open) && words.length >= 4 && prose;
}

const isDated = (value: Readonly<Record<string, unknown>>) =>
	textOf(value.period).length > 0 || (readItemDates(value.dates)?.start ?? null) !== null;

/**
 * Entries a PDF import split off the entry above: nothing a merge would lose (no dates, link or roles of their own),
 * and a heading field that is a sentence fragment (or no heading at all, only text), directly after a dated entry or
 * another such fragment. Adding dates would make them look like real jobs, so they're reported as part of the entry
 * above instead. A real entry without dates still gets "Add dates".
 */
const fragmentsBySections = new WeakMap<readonly WalkedSection[], ReadonlySet<string>>();

function fragmentPointers(sections: readonly WalkedSection[]): ReadonlySet<string> {
	const cached = fragmentsBySections.get(sections);
	if (cached) return cached;

	const fragments = new Set<string>();
	for (const section of sections) {
		const fields = HEADING_FIELDS[section.type];
		if (!fields || !isRenderedSection(section)) continue;

		section.items.forEach((item, index) => {
			const previous = section.items[index - 1];
			if (!previous || !(isDated(previous.value) || fragments.has(previous.pointer))) return;
			if (carriesUnmergedFields(item.value)) return;

			const headings = fields.map((field) => textOf(item.value[field])).filter(Boolean);
			const above = aboveEnding(previous.value);
			if (fragments.has(previous.pointer)) above.open = true;
			const fragment =
				headings.length > 0
					? headings.some((heading) => readsAsSentence(heading, above))
					: !textOf(item.value.location) && textOf(item.value.description).length > 0;
			if (fragment) fragments.add(item.pointer);
		});
	}

	fragmentsBySections.set(sections, fragments);
	return fragments;
}

const fragmentRules: AtsRule = (context) =>
	[...fragmentPointers(context.sections)].map((pointer) => finding("FRAGMENTED_ENTRY", pointer));

const dateRules: AtsRule = (context) => {
	const findings: AtsRuleFinding[] = [];
	const fragments = fragmentPointers(context.sections);

	for (const section of context.sections) {
		if (isCoverLetter(section) || !isRenderedSection(section)) continue;

		for (const item of section.items) {
			// A fragment is reported as part of the entry above; asking for its dates would make it look real.
			if (fragments.has(item.pointer)) continue;
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
	fragmentRules,
	titleRules,
	layoutRules,
	twoColumnRules,
	typographyRules,
];
