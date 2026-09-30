import type { Style } from "../forme/style-types";
import type { ResumeData, StyleIntent, StyleRule, StyleSlot } from "@reactive-resume/schema/resume/data";
import type { SemanticStylesheet, StylesheetSource } from "@reactive-resume/schema/resume/stylesheet";
import {
	escapeCssComment,
	escapeCssString,
	SEMANTIC_CSS_LIMITS_V1,
	serializeGeneratedStylesheet,
} from "@reactive-resume/resume/stylesheet";
import { styleRulesSchema } from "@reactive-resume/schema/resume/data";
import { getSectionStyleRuleContext } from "@reactive-resume/schema/resume/style-rules";
import { rgbaStringToHex } from "@reactive-resume/utils/color";
import { resolveStyleRuleSlot } from "../templates/shared/style-rules";

export type LegacyStyleConversion = {
	source: StylesheetSource;
	sanitizedRules: readonly StyleRule[];
};

const styleSlots = [
	"section",
	"heading",
	"item",
	"text",
	"secondaryText",
	"link",
	"icon",
	"level",
	"richParagraph",
	"richList",
	"richListItemRow",
	"richListItemContent",
	"richLink",
	"richBold",
	"richMark",
] as const satisfies readonly StyleSlot[];

const lengthProperties = new Set<keyof StyleIntent>([
	"fontSize",
	"letterSpacing",
	"padding",
	"paddingTop",
	"paddingRight",
	"paddingBottom",
	"paddingLeft",
	"marginTop",
	"marginRight",
	"marginBottom",
	"marginLeft",
	"rowGap",
	"columnGap",
	"borderWidth",
	"borderRadius",
]);

const slotSelectors = {
	section: "",
	heading: " > section-heading",
	item: " > section-items > item",
	text: ' field:not([name="content"]):not([name="description"]):not([name="recipient"]):not([name="keywords"])',
	secondaryText: ' field[name="keywords"]',
	link: " item > link",
	icon: " icon",
	level: " level",
	richParagraph: " rich-text paragraph",
	richList: " rich-text list",
	richListItemRow: " rich-text list-item",
	richListItemContent: " rich-text list-item-content",
	richLink: " rich-text link",
	richBold: " rich-text strong",
	richMark: " rich-text mark",
} as const satisfies Record<StyleSlot, string>;

const selectorForSlot = (base: string, slot: StyleSlot): string => {
	if (slot === "link") {
		return [
			`${base} item > link`,
			`${base} item > template-part > link`,
			`${base} item-header > link`,
			`${base} item-header > template-part > link`,
		].join(",\n");
	}
	return `${base}${slotSelectors[slot]}`;
};

const ruleBaseSelector = (rule: StyleRule): string => {
	if (rule.target.scope === "sectionType") return `section[type=${escapeCssString(rule.target.sectionType)}]`;
	if (rule.target.scope === "sectionId") return `section[id=${escapeCssString(rule.target.sectionId)}]`;
	return "section";
};

const resolvedRuleStyle = (data: ResumeData, rule: StyleRule, slot: StyleSlot): Style => {
	const isolated = {
		...data,
		metadata: { ...data.metadata, styleRules: [rule] },
	};
	const options =
		rule.target.scope === "sectionType"
			? { slot, sectionId: "", sectionType: rule.target.sectionType }
			: rule.target.scope === "sectionId"
				? { slot, ...getSectionStyleRuleContext(data, rule.target.sectionId) }
				: { slot, sectionId: "" };
	return resolveStyleRuleSlot(isolated, options);
};

const declarationsFromStyle = (style: Style): Record<string, string | number> =>
	Object.fromEntries(
		Object.entries(style).flatMap(([property, value]) => {
			if (value === undefined) return [];
			const converted =
				typeof value === "number" && lengthProperties.has(property as keyof StyleIntent) ? `${value}pt` : value;
			return [[property, converted]];
		}),
	);

const serializeBlock = (
	selector: string,
	declarations: Readonly<Record<string, string | number>>,
	comment?: string,
): string =>
	serializeGeneratedStylesheet({
		languageVersion: 1,
		blocks: [{ selector, declarations, ...(comment === undefined ? {} : { comment }) }],
	}).trimEnd();

const appliesToAwards = (data: ResumeData, rule: StyleRule): boolean => {
	if (rule.target.scope === "global") return true;
	if (rule.target.scope === "sectionType") return rule.target.sectionType === "awards";
	return getSectionStyleRuleContext(data, rule.target.sectionId).sectionType === "awards";
};

const textWeightSelector = (data: ResumeData, rule: StyleRule, base: string): string => {
	const selectors = [
		`${base} field:not([name="content"]):not([name="description"]):not([name="recipient"]):not([name="keywords"]):not([role~="primary-text"])`,
		`${base} item[role~="nested-role"] > item-header > field[name="position"]`,
	];
	if (appliesToAwards(data, rule)) selectors.push(`${base} field[name="title"]`);
	return selectors.join(",\n");
};

const scizorBoldColorSelector = (data: ResumeData, rule: StyleRule, base: string): string | undefined => {
	const sectionType =
		rule.target.scope === "sectionType"
			? rule.target.sectionType
			: rule.target.scope === "sectionId"
				? getSectionStyleRuleContext(data, rule.target.sectionId).sectionType
				: undefined;
	if (sectionType === "awards") return;

	const scopedBase =
		rule.target.scope === "global"
			? 'resume[template="scizor"] section:not([type="awards"])'
			: `resume[template="scizor"] ${base}`;
	return ["company", "school", "name", "language", "network", "organization", "title"]
		.map((name) => `${scopedBase}${slotSelectors.text}[role~="primary-text"][name=${escapeCssString(name)}]`)
		.join(",\n");
};

const levelDecorationDeclarations = (
	data: ResumeData,
	fontSize: string | number | undefined,
): Record<string, string | number> => {
	if (fontSize === undefined) return {};
	const type = data.metadata.design.level.type;
	if (type === "progress-bar" || type === "rectangle" || type === "rectangle-full") return { height: fontSize };
	return { width: fontSize, height: fontSize };
};

const activeSlotChunks = (data: ResumeData, rule: StyleRule, slot: StyleSlot): string[] => {
	const base = ruleBaseSelector(rule);
	const selector = selectorForSlot(base, slot);
	const declarations = declarationsFromStyle(resolvedRuleStyle(data, rule, slot));
	const combinedTextDeclarations = slot === "text" ? { ...declarations } : undefined;
	const chunks: string[] = [];
	const comments: string[] = [];

	if ((slot === "link" || slot === "richLink") && "textDecoration" in declarations) {
		delete declarations.textDecoration;
		comments.push("No effect in legacy rendering: text-decoration is owned by the builder link preference.");
	}

	if (slot === "text" && "fontWeight" in declarations) {
		const { fontWeight } = declarations;
		delete declarations.fontWeight;
		if (Object.keys(declarations).length > 0)
			chunks.push(serializeBlock(selector, declarations, rule.label || rule.id));
		chunks.push(serializeBlock(textWeightSelector(data, rule, base), { fontWeight }, rule.label || rule.id));
		comments.push(
			"Legacy Bold hosts keep the template bold weight; award titles remain the explicit unbold exception.",
		);
	} else {
		if (slot === "icon" && declarations.fontSize !== undefined) {
			declarations.width = declarations.fontSize;
			declarations.height = declarations.fontSize;
		}
		if (Object.keys(declarations).length > 0)
			chunks.push(serializeBlock(selector, declarations, rule.label || rule.id));
	}

	if (combinedTextDeclarations && Object.keys(combinedTextDeclarations).length > 0) {
		chunks.push(
			serializeBlock(`${base} combined-text`, combinedTextDeclarations, `${rule.label || rule.id}: combined text host`),
		);
	}

	if (slot === "text" && declarations.color !== undefined) {
		const restorationSelector = scizorBoldColorSelector(data, rule, base);
		if (restorationSelector) {
			chunks.push(
				serializeBlock(
					restorationSelector,
					{ color: rgbaStringToHex(data.metadata.design.colors.text) },
					`${rule.label || rule.id}: Scizor Bold final color`,
				),
			);
		}
	}

	if (slot === "level" && declarations.fontSize !== undefined) {
		const geometry = levelDecorationDeclarations(data, declarations.fontSize);
		if (Object.keys(geometry).length > 0) {
			chunks.push(serializeBlock(`${base} level > icon`, geometry, `${rule.label || rule.id}: level decorations`));
		}
	}

	return [...chunks, ...comments.map((comment) => `/* ${escapeCssComment(comment)} */`)];
};

const disabledRuleChunk = (data: ResumeData, rule: StyleRule): string => {
	const blocks = styleSlots.flatMap((slot) => {
		if (!rule.slots[slot]) return [];
		const declarations = declarationsFromStyle(resolvedRuleStyle(data, { ...rule, enabled: true }, slot));
		if (Object.keys(declarations).length === 0) return [];
		const base = ruleBaseSelector(rule);
		return [
			serializeBlock(selectorForSlot(base, slot), declarations),
			...(slot === "text" ? [serializeBlock(`${base} combined-text`, declarations)] : []),
		];
	});
	const label = escapeCssComment(rule.label || rule.id);
	const body = escapeCssComment(blocks.join("\n\n"));
	return `/* Disabled legacy rule: ${label}${body ? `\n${body}` : ""}\n*/`;
};

export function convertLegacyStyleRules(data: ResumeData): LegacyStyleConversion {
	const sanitizedRules = styleRulesSchema.parse(data.metadata.styleRules ?? []);
	const sanitizedData = {
		...data,
		metadata: { ...data.metadata, styleRules: sanitizedRules },
	};
	const scopePrecedence = { global: 0, sectionType: 1, sectionId: 2 } as const;
	const orderedRules = sanitizedRules
		.map((rule, index) => ({ rule, index }))
		.sort(
			(left, right) =>
				scopePrecedence[left.rule.target.scope] - scopePrecedence[right.rule.target.scope] || left.index - right.index,
		)
		.map(({ rule }) => rule);
	const chunks = orderedRules.flatMap((rule) => {
		if (!rule.enabled) return [disabledRuleChunk(sanitizedData, rule)];
		return styleSlots.flatMap((slot) => (rule.slots[slot] ? activeSlotChunks(sanitizedData, rule, slot) : []));
	});
	const text = chunks.length > 0 ? `${chunks.join("\n\n")}\n` : "";

	return {
		source: { languageVersion: 1, text },
		sanitizedRules,
	};
}

/**
 * Data from before Semantic CSS styled itself with legacy style rules (`metadata.styleRules`), which nothing renders
 * any more. It needs converting when it's still in the old editor's legacy mode, or has rules and no stylesheet at all;
 * anything already semantic, or with neither, renders the same as it is.
 */
export function needsLegacyStyleConversion(
	metadata: { stylesheet?: unknown; styleRules?: unknown } | undefined,
): boolean {
	const stylesheet = metadata?.stylesheet;
	if (stylesheet && typeof stylesheet === "object") return (stylesheet as { mode?: unknown }).mode === "legacy";
	return Array.isArray(metadata?.styleRules) && metadata.styleRules.length > 0;
}

/**
 * The Semantic CSS stylesheet that reproduces legacy-styled data. A draft typed in the old editor but never activated
 * was never on the page, so the converted rules (what the page showed) win and the draft is kept after them, commented
 * out, unless that would push the stylesheet over its size limit. The rules themselves are left in the data.
 */
export function convertLegacyStylesheet(data: ResumeData): SemanticStylesheet {
	const converted = convertLegacyStyleRules(data).source;
	const draft = data.metadata.stylesheet?.source.text.replace(/^\s*@version\s+\d+\s*;\s*/, "").trim();
	const withDraft =
		draft && draft !== converted.text.trim()
			? `${converted.text}${converted.text ? "\n" : ""}/* Unapplied draft from the old editor:\n${draft.replaceAll("*/", "*\\/")}\n*/\n`
			: converted.text;
	const text =
		new TextEncoder().encode(withDraft).byteLength > SEMANTIC_CSS_LIMITS_V1.maxSourceBytes ? converted.text : withDraft;
	return { mode: "semantic", source: { ...converted, text } };
}
