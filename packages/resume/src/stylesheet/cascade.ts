import type { Specificity } from "./selector";
import type {
	CompiledDeclaration,
	CompiledMediaQuery,
	CompiledStyleRule,
	ResolvedNodeStyle,
	ResolvedPageDimensions,
	ResolvedPageSize,
	ResolveStylesheetContext,
	ResolveStylesheetResult,
	SemanticCssDiagnostic,
	SemanticNode,
	SourceRange,
	StructuralPresentation,
	StyleProgram,
} from "./types";
import { createDiagnostic, isFatalStylesheetDiagnostic } from "./diagnostics";
import { SEMANTIC_CSS_LIMITS_V1 } from "./limits";
import { PROPERTY_REGISTRY_V1 } from "./registry/properties";
import { createSystemVariables } from "./registry/system-variables";
import { createSelectorMatcher } from "./selector";
import {
	cssFunctionDepth,
	decodeCssEscapes,
	expandShorthand,
	SEMANTIC_CSS_LENGTH_PROPERTIES,
	valueSyntaxError,
} from "./values";

type FlatNode = {
	node: SemanticNode;
	parent: FlatNode | null;
	pageKey: string | null;
};

type MatchedRule = {
	rule: CompiledStyleRule;
	specificity: Specificity;
};

type Winner = {
	declaration: CompiledDeclaration;
	specificity: Specificity;
};

type LengthContext = {
	parentFontSize: number;
	fontSize: number;
	rootFontSize: number;
};

type CssWideKeyword = "inherit" | "initial";

type VariableExpansionBudget = {
	work: number;
};

const absoluteUnitToPt = {
	pt: 1,
	px: 72 / 96,
	in: 72,
	mm: 72 / 25.4,
	cm: 72 / 2.54,
} as const;

const cssWideKeywords = new Set(["inherit", "initial"]);
const maxVariableExpansionOutputCodeUnits = SEMANTIC_CSS_LIMITS_V1.maxSourceBytes;
const maxVariableExpansionWorkCodeUnits = SEMANTIC_CSS_LIMITS_V1.maxSourceBytes * 4;

const structuralKeys: Readonly<Record<string, keyof StructuralPresentation>> = {
	"break-before": "breakBefore",
	"break-inside": "breakInside",
	"-resume-fixed": "fixed",
	"-resume-min-presence-ahead": "minPresenceAhead",
	orphans: "orphans",
	widows: "widows",
	size: "pageSize",
};

function cssWideKeyword(value: string): CssWideKeyword | null {
	const keyword = value.toLowerCase();
	return cssWideKeywords.has(keyword) ? (keyword as CssWideKeyword) : null;
}

function compareSpecificity(left: Specificity, right: Specificity): number {
	return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

function candidateWins(candidate: Winner, current: Winner | undefined): boolean {
	if (!current) return true;
	if (candidate.declaration.important !== current.declaration.important) return candidate.declaration.important;
	return (
		compareSpecificity(candidate.specificity, current.specificity) > 0 ||
		(compareSpecificity(candidate.specificity, current.specificity) === 0 &&
			candidate.declaration.sourceOrder > current.declaration.sourceOrder)
	);
}

function flattenTree(root: SemanticNode): FlatNode[] | null {
	const result: FlatNode[] = [];
	const stack: { node: SemanticNode; parent: FlatNode | null; pageKey: string | null }[] = [
		{ node: root, parent: null, pageKey: null },
	];
	while (stack.length > 0) {
		const next = stack.pop();
		if (!next) break;
		if (result.length >= SEMANTIC_CSS_LIMITS_V1.maxSemanticNodes) return null;
		const pageKey = next.node.kind === "page" ? next.node.key : next.pageKey;
		const flat = { node: next.node, parent: next.parent, pageKey };
		result.push(flat);
		const childCount = next.node.children.length;
		if (childCount > SEMANTIC_CSS_LIMITS_V1.maxSemanticNodes - result.length - stack.length) return null;
		for (let index = childCount - 1; index >= 0; index--) {
			const child = next.node.children[index];
			if (child) stack.push({ node: child, parent: flat, pageKey });
		}
	}
	return result;
}

function matchingSpecificity(
	rule: CompiledStyleRule,
	nodeKey: string,
	matches: ReturnType<typeof createSelectorMatcher>,
): Specificity | null {
	let best: Specificity | null = null;
	for (const selector of rule.selector.selectors) {
		if (!matches({ selectors: [selector] }, nodeKey)) continue;
		if (!best || compareSpecificity(selector.specificity, best) > 0) best = selector.specificity;
	}
	return best;
}

function defaultPageDimensions(
	format: ResolveStylesheetContext["baseSettings"]["page"]["format"],
): ResolvedPageDimensions {
	if (format === "letter") return { width: 612, height: 792 };
	return { width: 595.28, height: 841.89 };
}

function initialPages(
	flatNodes: readonly FlatNode[],
	context: ResolveStylesheetContext,
): Map<string, ResolvedPageDimensions> {
	const authored = new Map(context.pages.map((page) => [page.pageKey, { width: page.width, height: page.height }]));
	const fallback = defaultPageDimensions(context.baseSettings.page.format);
	const pages = new Map<string, ResolvedPageDimensions>();
	for (const { node } of flatNodes) {
		if (node.kind === "page") pages.set(node.key, authored.get(node.key) ?? fallback);
	}
	return pages;
}

function pageFor(
	node: FlatNode,
	pages: ReadonlyMap<string, ResolvedPageDimensions>,
	fallback: ResolvedPageDimensions,
): ResolvedPageDimensions {
	return (node.pageKey ? pages.get(node.pageKey) : undefined) ?? pages.values().next().value ?? fallback;
}

function toPoints(value: string, property: string, context: LengthContext): number | string | null {
	const match = value.trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(pt|px|in|mm|cm|%|em|rem)?$/i);
	if (!match) return null;
	const number = Number(match[1]);
	if (!Number.isFinite(number)) return null;
	const unit = match[2]?.toLowerCase() ?? "pt";
	if (unit === "%") return property === "font-size" ? (number / 100) * context.parentFontSize : `${number}%`;
	if (unit === "rem") return number * context.rootFontSize;
	if (unit === "em") {
		return number * (property === "font-size" ? context.parentFontSize : context.fontSize);
	}
	return number * absoluteUnitToPt[unit as keyof typeof absoluteUnitToPt];
}

function mediaMatches(query: CompiledMediaQuery, dimensions: ResolvedPageDimensions, rootFontSize: number): boolean {
	const lengthContext = {
		parentFontSize: rootFontSize,
		fontSize: rootFontSize,
		rootFontSize,
	};
	return query.features.every((feature) => {
		if (feature.name === "orientation") {
			return feature.value === (dimensions.width > dimensions.height ? "landscape" : "portrait");
		}
		const expected = toPoints(feature.value, feature.name, lengthContext);
		if (typeof expected !== "number") return false;
		const actual = dimensions[feature.name];
		if (feature.comparison === "min") return actual >= expected;
		if (feature.comparison === "max") return actual <= expected;
		return actual === expected;
	});
}

function ruleApplies(
	rule: CompiledStyleRule,
	dimensions: ResolvedPageDimensions,
	rootFontSize: number,
	includeMedia: boolean,
): boolean {
	if (rule.media.length === 0) return true;
	return includeMedia && rule.media.some((query) => mediaMatches(query, dimensions, rootFontSize));
}

function winnersFor(
	matches: readonly MatchedRule[],
	dimensions: ResolvedPageDimensions,
	rootFontSize: number,
	includeMedia: boolean,
): Map<string, Winner> {
	const winners = new Map<string, Winner>();
	for (const { rule, specificity } of matches) {
		if (!ruleApplies(rule, dimensions, rootFontSize, includeMedia)) continue;
		for (const declaration of rule.declarations) {
			const candidate = { declaration, specificity };
			if (candidateWins(candidate, winners.get(declaration.property))) {
				winners.set(declaration.property, candidate);
			}
		}
	}
	return winners;
}

function splitVariable(value: string): [name: string, fallback: string | null] {
	let depth = 0;
	for (let index = 0; index < value.length; index++) {
		if (value[index] === "(") depth++;
		if (value[index] === ")") depth--;
		if (value[index] === "," && depth === 0) {
			return [value.slice(0, index).trim(), value.slice(index + 1).trim()];
		}
	}
	return [value.trim(), null];
}

function matchingParenthesis(value: string, opening: number): number {
	let depth = 0;
	for (let index = opening; index < value.length; index++) {
		if (value[index] === "(") depth++;
		if (value[index] === ")" && --depth === 0) return index;
	}
	return -1;
}

function expandVariables(
	source: string,
	custom: ReadonlyMap<string, string>,
	system: Readonly<Record<string, string>>,
	diagnostics: SemanticCssDiagnostic[],
	range: SourceRange,
	stack: readonly string[] = [],
	depth = 0,
	budget: VariableExpansionBudget = { work: 0 },
): string | null {
	if (depth > SEMANTIC_CSS_LIMITS_V1.maxVariableExpansionDepth) {
		diagnostics.push(
			createDiagnostic("RESOURCE_LIMIT", "error", "Variable expansion exceeds the Semantic CSS limit.", range),
		);
		return null;
	}
	if (
		source.length > maxVariableExpansionOutputCodeUnits ||
		source.length > maxVariableExpansionWorkCodeUnits - budget.work
	) {
		diagnostics.push(
			createDiagnostic("RESOURCE_LIMIT", "error", "Variable expansion exceeds the Semantic CSS limit.", range),
		);
		return null;
	}
	budget.work += source.length;

	let value = decodeCssEscapes(source);
	if (value.length > maxVariableExpansionOutputCodeUnits) {
		diagnostics.push(
			createDiagnostic("RESOURCE_LIMIT", "error", "Variable expansion exceeds the Semantic CSS limit.", range),
		);
		return null;
	}
	while (true) {
		const match = /var\s*\(/i.exec(value);
		if (!match) break;
		const opening = (match.index ?? 0) + match[0].lastIndexOf("(");
		const closing = matchingParenthesis(value, opening);
		if (closing < 0) {
			diagnostics.push(createDiagnostic("INVALID_VALUE", "error", "Malformed var() expression.", range));
			return null;
		}
		const [name, fallback] = splitVariable(value.slice(opening + 1, closing));
		if (!name.startsWith("--")) {
			diagnostics.push(createDiagnostic("INVALID_VALUE", "error", "var() requires a custom-property name.", range));
			return null;
		}
		if (stack.includes(name)) {
			diagnostics.push(createDiagnostic("VARIABLE_CYCLE", "error", `Variable cycle detected at ${name}.`, range));
			return null;
		}
		const replacement = custom.get(name) ?? system[name] ?? fallback;
		if (replacement === null || replacement === undefined) {
			diagnostics.push(
				createDiagnostic("UNRESOLVED_VARIABLE", "error", `No value or fallback exists for ${name}.`, range),
			);
			return null;
		}
		const expanded = expandVariables(
			replacement,
			custom,
			system,
			diagnostics,
			range,
			[...stack, name],
			depth + 1,
			budget,
		);
		if (expanded === null) return null;
		const nextLength = (match.index ?? 0) + expanded.length + value.length - closing - 1;
		if (
			nextLength > maxVariableExpansionOutputCodeUnits ||
			nextLength > maxVariableExpansionWorkCodeUnits - budget.work
		) {
			diagnostics.push(
				createDiagnostic("RESOURCE_LIMIT", "error", "Variable expansion exceeds the Semantic CSS limit.", range),
			);
			return null;
		}
		budget.work += nextLength;
		value = `${value.slice(0, match.index)}${expanded}${value.slice(closing + 1)}`;
	}

	if (/\burl\s*\(/i.test(value)) {
		diagnostics.push(
			createDiagnostic("FORBIDDEN_CSS_VALUE", "error", "External CSS resources are not supported.", range),
		);
		return null;
	}
	if (cssFunctionDepth(value) > SEMANTIC_CSS_LIMITS_V1.maxFunctionDepth) {
		diagnostics.push(
			createDiagnostic("RESOURCE_LIMIT", "error", "CSS function nesting exceeds the Semantic CSS limit.", range),
		);
		return null;
	}
	return value.trim();
}

function expandedWinnersFor(
	matches: readonly MatchedRule[],
	dimensions: ResolvedPageDimensions,
	rootFontSize: number,
	custom: ReadonlyMap<string, string>,
	system: Readonly<Record<string, string>>,
	diagnostics: SemanticCssDiagnostic[],
): Map<string, Winner> {
	const cascaded = new Map<string, Winner>();
	for (const { rule, specificity } of matches) {
		if (!ruleApplies(rule, dimensions, rootFontSize, true)) continue;
		for (const declaration of rule.declarations) {
			if (declaration.property.startsWith("--")) continue;
			const targets = expandShorthand(declaration.property, "inherit") ?? [[declaration.property, "inherit"]];
			for (const [property] of targets) {
				const candidate = { declaration, specificity };
				if (candidateWins(candidate, cascaded.get(property))) cascaded.set(property, candidate);
			}
		}
	}

	const expansions = new Map<CompiledDeclaration, readonly [property: string, value: string][] | null>();
	const winners = new Map<string, Winner>();
	for (const [property, winner] of cascaded) {
		if (property === "size") {
			winners.set(property, winner);
			continue;
		}
		let declarations = expansions.get(winner.declaration);
		if (declarations === undefined) {
			const expandedValue = expandVariables(
				winner.declaration.value,
				custom,
				system,
				diagnostics,
				winner.declaration.range,
			);
			declarations = expandedValue === null ? null : expandShorthand(winner.declaration.property, expandedValue);
			if (expandedValue !== null && !declarations) {
				diagnostics.push(
					createDiagnostic(
						"INVALID_VALUE",
						"error",
						`Invalid ${winner.declaration.property} shorthand.`,
						winner.declaration.range,
					),
				);
			}
			expansions.set(winner.declaration, declarations);
		}
		const value = declarations?.find(([expandedProperty]) => expandedProperty === property)?.[1];
		if (value === undefined) continue;
		winners.set(property, {
			declaration: { ...winner.declaration, property, value },
			specificity: winner.specificity,
		});
	}
	return winners;
}

function customProperties(
	winners: ReadonlyMap<string, Winner>,
	parent: ReadonlyMap<string, string> | undefined,
): Map<string, string> {
	let custom: Map<string, string> | undefined;
	for (const [property, { declaration }] of winners) {
		if (!property.startsWith("--")) continue;
		const keyword = cssWideKeyword(declaration.value);
		if (keyword === "inherit") continue;
		if (keyword === "initial") {
			if (parent?.has(property)) {
				custom ??= new Map(parent);
				custom.delete(property);
			}
		} else if (parent?.get(property) !== declaration.value) {
			custom ??= new Map(parent);
			custom.set(property, declaration.value);
		}
	}
	return custom ?? (parent as Map<string, string> | undefined) ?? new Map();
}

function parsePageSize(value: string, lengthContext: LengthContext): ResolvedPageSize | null {
	if (value.toLowerCase() === "a4") return "A4";
	if (value.toLowerCase() === "letter") return "LETTER";
	const parts = value.trim().split(/\s+/);
	if (parts.length < 1 || parts.length > 2) return null;
	const width = toPoints(parts[0] ?? "", "size", lengthContext);
	const height = parts[1] ? toPoints(parts[1], "size", lengthContext) : undefined;
	if (typeof width !== "number" || (height !== undefined && typeof height !== "number")) return null;
	if (
		width <= 0 ||
		Math.abs(width) > SEMANTIC_CSS_LIMITS_V1.maxAbsoluteLengthPt ||
		(height !== undefined && (height <= 0 || Math.abs(height) > SEMANTIC_CSS_LIMITS_V1.maxAbsoluteLengthPt))
	) {
		return null;
	}
	return height === undefined ? { width } : { width, height };
}

function dimensionsForSize(size: ResolvedPageSize, authored: ResolvedPageDimensions): ResolvedPageDimensions {
	if (size === "A4") return { width: 595.28, height: 841.89 };
	if (size === "LETTER") return { width: 612, height: 792 };
	return { width: size.width, height: size.height ?? authored.height };
}

function cssWideValue(
	keyword: CssWideKeyword,
	property: string,
	parent: Readonly<Record<string, string | number>> | undefined,
): string | number | undefined {
	return keyword === "inherit" ? parent?.[property] : undefined;
}

function normalizeValue(property: string, value: string, context: LengthContext): string | number | null {
	if (SEMANTIC_CSS_LENGTH_PROPERTIES.has(property)) {
		const length = toPoints(value, property, context);
		if (length !== null) return length;
		if (/^(auto|none|normal|max-content|min-content|fit-content|thin|medium|thick)$/i.test(value)) {
			return value.toLowerCase();
		}
		return null;
	}
	if (property === "line-height") {
		if (value.toLowerCase() === "normal") return "normal";
		// A bare number, `em` and `%` are multiples of the element's own font size, which is how renderers read a
		// number. Any other unit is a length: it keeps a unit so the renderer divides by the size it draws with.
		const multiple = value.trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(%|em)?$/i);
		if (multiple) {
			const number = Number(multiple[1]);
			if (!Number.isFinite(number)) return null;
			return multiple[2] === "%" ? number / 100 : number;
		}
		const points = toPoints(value, property, context);
		if (typeof points !== "number" || Math.abs(points) > SEMANTIC_CSS_LIMITS_V1.maxAbsoluteLengthPt) return null;
		return `${points}pt`;
	}
	if (/^(opacity|flex-grow|flex-shrink|order|orphans|widows|z-index|max-lines)$/i.test(property)) {
		const number = Number(value);
		if (!Number.isFinite(number)) return null;
		if (property === "opacity" && (number < 0 || number > 1)) return null;
		return number;
	}
	return value;
}

function applyStructuralCssWide(
	keyword: CssWideKeyword,
	property: string,
	structural: StructuralPresentation,
	parent: ResolvedNodeStyle | undefined,
): boolean {
	const key = structuralKeys[property];
	if (!key) return false;
	const value = keyword === "inherit" ? parent?.structural[key] : undefined;
	if (value === undefined) delete structural[key];
	else Object.assign(structural, { [key]: value });
	return true;
}

function structuralValue(
	property: string,
	value: string | number,
	structural: StructuralPresentation,
	pageSize?: ResolvedPageSize,
): boolean {
	if (property === "break-before") {
		if (value === "page") structural.breakBefore = "page";
		else if (value === "auto") delete structural.breakBefore;
		else return false;
	}
	if (property === "break-inside") {
		if (value === "avoid") structural.breakInside = "avoid";
		else if (value === "auto") delete structural.breakInside;
		else return false;
	}
	if (property === "-resume-fixed") {
		if (value === "true" || value === "1" || value === 1) structural.fixed = true;
		else if (value === "false" || value === "0" || value === 0) structural.fixed = false;
		else return false;
	}
	if (property === "-resume-min-presence-ahead") {
		if (typeof value === "number" && value >= 0) structural.minPresenceAhead = value;
		else return false;
	}
	if (property === "orphans" || property === "widows") {
		if (typeof value !== "number" || !Number.isInteger(value) || value < 1) return false;
		if (property === "orphans") structural.orphans = value;
		else structural.widows = value;
	}
	if (property === "size") {
		if (!pageSize) return false;
		structural.pageSize = pageSize;
	}
	return true;
}

function createRenderTree(
	tree: SemanticNode,
	flatNodes: readonly FlatNode[],
	nodes: Readonly<Record<string, ResolvedNodeStyle>>,
): SemanticNode {
	const rendered = new Map<string, SemanticNode>();
	for (let index = flatNodes.length - 1; index >= 0; index--) {
		const source = flatNodes[index]?.node;
		if (!source) continue;
		const children = source.children
			.map((child, sourceIndex) => ({ child: rendered.get(child.key), sourceIndex }))
			.filter((entry): entry is { child: SemanticNode; sourceIndex: number } => entry.child !== undefined)
			.filter(({ child }) => !nodes[child.key]?.hidden)
			.sort((left, right) => {
				const order = (nodes[left.child.key]?.order ?? 0) - (nodes[right.child.key]?.order ?? 0);
				return order || left.sourceIndex - right.sourceIndex;
			})
			.map(({ child }) => child);
		rendered.set(source.key, { ...source, attributes: { ...source.attributes }, roles: [...source.roles], children });
	}
	return rendered.get(tree.key) ?? tree;
}

export function resolveStylesheet(
	program: StyleProgram,
	tree: SemanticNode,
	context: ResolveStylesheetContext,
): ResolveStylesheetResult {
	const flatNodes = flattenTree(tree);
	if (!flatNodes) {
		return {
			nodes: {},
			renderTree: tree,
			diagnostics: [
				createDiagnostic("RESOURCE_LIMIT", "error", "The semantic tree exceeds the Semantic CSS node limit."),
			],
		};
	}
	if (
		context.pages.some(
			({ width, height }) =>
				!Number.isFinite(width) ||
				!Number.isFinite(height) ||
				width <= 0 ||
				height <= 0 ||
				width > SEMANTIC_CSS_LIMITS_V1.maxAbsoluteLengthPt ||
				height > SEMANTIC_CSS_LIMITS_V1.maxAbsoluteLengthPt,
		)
	) {
		return {
			nodes: {},
			renderTree: tree,
			diagnostics: [
				createDiagnostic("INVALID_VALUE", "error", "Authored page dimensions must be finite and positive."),
			],
		};
	}
	const diagnostics: SemanticCssDiagnostic[] = [];

	const matched = new Map<string, MatchedRule[]>();
	const selectorMatches = createSelectorMatcher(tree);
	for (const { node } of flatNodes) {
		const rules: MatchedRule[] = [];
		for (const rule of program.rules) {
			const specificity = matchingSpecificity(rule, node.key, selectorMatches);
			if (specificity) rules.push({ rule, specificity });
		}
		matched.set(node.key, rules);
	}
	const nodeKinds = new Map(flatNodes.map(({ node }) => [node.key, node.kind]));
	const cascadeKinds = new Map<string, ReadonlySet<SemanticNode["kind"]>>();
	for (const [canonicalKey, aliasKeys] of Object.entries(context.aliases ?? {})) {
		const canonicalKind = nodeKinds.get(canonicalKey);
		if (!canonicalKind) continue;
		const kinds = new Set<SemanticNode["kind"]>([canonicalKind]);
		const rules = [...(matched.get(canonicalKey) ?? [])];
		for (const aliasKey of aliasKeys) {
			const aliasKind = nodeKinds.get(aliasKey);
			if (!aliasKind) continue;
			kinds.add(aliasKind);
			rules.push(...(matched.get(aliasKey) ?? []));
		}
		matched.set(canonicalKey, rules);
		cascadeKinds.set(canonicalKey, kinds);
	}
	for (const rule of program.rules) {
		const matchingNodes = flatNodes.filter(({ node }) =>
			matched.get(node.key)?.some((matchedRule) => matchedRule.rule === rule),
		);
		if (matchingNodes.length === 0) {
			diagnostics.push(
				createDiagnostic("SELECTOR_NO_MATCH", "warning", "This selector matches no semantic resume node.", rule.range),
			);
			continue;
		}
		for (const declaration of rule.declarations) {
			if (declaration.property.startsWith("--")) continue;
			const definition = PROPERTY_REGISTRY_V1[declaration.property];
			if (definition && !matchingNodes.some(({ node }) => definition.appliesTo.includes(node.kind))) {
				diagnostics.push(
					createDiagnostic(
						"PROPERTY_NOT_APPLICABLE",
						"warning",
						`${declaration.property} cannot apply to the matched semantic node kinds.`,
						declaration.range,
					),
				);
			}
		}
	}

	const rootFontSize = context.baseSettings.typography.body.fontSize;
	const fallbackDimensions = defaultPageDimensions(context.baseSettings.page.format);
	const pages = initialPages(flatNodes, context);
	const resolvedPageSizes = new Map<string, ResolvedPageSize>();
	const resolvedPageSizeValues = new Map<string, string>();
	const preliminaryCustom = new Map<string, Map<string, string>>();

	for (const node of flatNodes) {
		const dimensions = pageFor(node, pages, fallbackDimensions);
		const rawWinners = winnersFor(matched.get(node.node.key) ?? [], dimensions, rootFontSize, false);
		const custom = customProperties(rawWinners, node.parent ? preliminaryCustom.get(node.parent.node.key) : undefined);
		preliminaryCustom.set(node.node.key, custom);
		if (node.node.kind !== "page") continue;
		const size = rawWinners.get("size");
		if (!size) continue;
		const system = createSystemVariables(context.baseSettings, dimensions);
		const expanded = expandVariables(size.declaration.value, custom, system, diagnostics, size.declaration.range);
		if (!expanded) continue;
		const keyword = cssWideKeyword(expanded);
		const parsed =
			keyword === "inherit"
				? node.parent
					? context.baseStyles[node.parent.node.key]?.structural.pageSize
					: undefined
				: keyword
					? undefined
					: parsePageSize(expanded, { parentFontSize: rootFontSize, fontSize: rootFontSize, rootFontSize });
		if (keyword && !parsed) {
			resolvedPageSizeValues.set(node.node.key, expanded);
			continue;
		}
		if (!parsed) {
			diagnostics.push(createDiagnostic("INVALID_VALUE", "error", "Invalid page size.", size.declaration.range));
			continue;
		}
		resolvedPageSizeValues.set(node.node.key, expanded);
		resolvedPageSizes.set(node.node.key, parsed);
		pages.set(node.node.key, dimensionsForSize(parsed, dimensions));
	}

	const customByNode = new Map<string, Map<string, string>>();
	const resolved: Record<string, ResolvedNodeStyle> = {};
	for (const node of flatNodes) {
		const dimensions = pageFor(node, pages, fallbackDimensions);
		const rawWinners = winnersFor(matched.get(node.node.key) ?? [], dimensions, rootFontSize, true);
		const custom = customProperties(rawWinners, node.parent ? customByNode.get(node.parent.node.key) : undefined);
		customByNode.set(node.node.key, custom);
		const system = createSystemVariables(context.baseSettings, dimensions);
		const winners = expandedWinnersFor(
			matched.get(node.node.key) ?? [],
			dimensions,
			rootFontSize,
			custom,
			system,
			diagnostics,
		);

		const base = context.baseStyles[node.node.key] ?? { style: {}, structural: {}, hidden: false, order: 0 };
		const parent = node.parent ? resolved[node.parent.node.key] : undefined;
		const style: Record<string, string | number> = { ...base.style };
		const specifiedStyleProperties = new Set<string>();
		for (const [property, definition] of Object.entries(PROPERTY_REGISTRY_V1)) {
			if (!definition?.inheritable) continue;
			const inheritedFromAuthoredRule = parent?.specifiedStyleProperties?.includes(property) && !winners.has(property);
			if (inheritedFromAuthoredRule) {
				specifiedStyleProperties.add(property);
				if (parent?.style[property] === undefined) delete style[property];
				else style[property] = parent.style[property];
			} else if (style[property] === undefined && parent?.style[property] !== undefined) {
				style[property] = parent.style[property];
			}
		}

		const fontSizeWinner = winners.get("font-size");
		const parentFontSize =
			typeof parent?.style["font-size"] === "number"
				? parent.style["font-size"]
				: context.baseSettings.typography.body.fontSize;
		const applicableKinds = cascadeKinds.get(node.node.key) ?? new Set([node.node.kind]);
		if (fontSizeWinner && PROPERTY_REGISTRY_V1["font-size"]?.appliesTo.some((kind) => applicableKinds.has(kind))) {
			const expanded = fontSizeWinner.declaration.value;
			const keyword = cssWideKeyword(expanded);
			if (keyword) {
				specifiedStyleProperties.add("font-size");
				const wide = cssWideValue(keyword, "font-size", parent?.style);
				if (wide === undefined) delete style["font-size"];
				else style["font-size"] = wide;
			} else {
				const syntaxError = valueSyntaxError("font-size", expanded);
				if (syntaxError) {
					diagnostics.push(createDiagnostic("INVALID_VALUE", "error", syntaxError, fontSizeWinner.declaration.range));
				} else {
					const normalized = normalizeValue("font-size", expanded, {
						parentFontSize,
						fontSize: parentFontSize,
						rootFontSize,
					});
					if (normalized === null) {
						diagnostics.push(
							createDiagnostic("INVALID_VALUE", "error", "Invalid font-size value.", fontSizeWinner.declaration.range),
						);
					} else if (
						typeof normalized === "number" &&
						(normalized < 0 || normalized > SEMANTIC_CSS_LIMITS_V1.maxAbsoluteLengthPt)
					) {
						diagnostics.push(
							createDiagnostic(
								"INVALID_VALUE",
								"error",
								"font-size exceeds the Semantic CSS length limit.",
								fontSizeWinner.declaration.range,
							),
						);
					} else {
						specifiedStyleProperties.add("font-size");
						style["font-size"] = normalized;
						if (typeof normalized === "number" && (normalized < 4 || normalized > 72)) {
							diagnostics.push(
								createDiagnostic(
									"EXTREME_VALUE",
									"warning",
									"This font size is renderable but unusually extreme.",
									fontSizeWinner.declaration.range,
								),
							);
						}
					}
				}
			}
		}

		const fontSize = typeof style["font-size"] === "number" ? style["font-size"] : parentFontSize;
		const structural: StructuralPresentation = { ...base.structural };
		let hidden = base.hidden;
		let order = base.order;
		for (const [property, winner] of winners) {
			if (property.startsWith("--") || property === "font-size") continue;
			const definition = PROPERTY_REGISTRY_V1[property];
			if (!definition?.appliesTo.some((kind) => applicableKinds.has(kind))) continue;
			const expanded = winner.declaration.value;
			if (property === "size") {
				const resolvedValue = resolvedPageSizeValues.get(node.node.key);
				if (resolvedValue === undefined) continue;
				const sizeKeyword = cssWideKeyword(resolvedValue);
				if (sizeKeyword) {
					applyStructuralCssWide(sizeKeyword, property, structural, parent);
				} else {
					const pageSize = resolvedPageSizes.get(node.node.key);
					if (pageSize) structuralValue(property, resolvedValue, structural, pageSize);
				}
				continue;
			}
			const keyword = cssWideKeyword(expanded);
			if (keyword) {
				if (property === "display") {
					if (keyword === "inherit") {
						hidden = parent?.hidden ?? false;
						if (!hidden && parent?.style.display !== undefined) style.display = parent.style.display;
						else delete style.display;
					} else {
						hidden = false;
						delete style.display;
					}
				} else if (property === "order") {
					order = keyword === "inherit" ? (parent?.order ?? 0) : 0;
				} else if (definition.category === "structural") {
					applyStructuralCssWide(keyword, property, structural, parent);
				} else {
					specifiedStyleProperties.add(property);
					const wide = cssWideValue(keyword, property, parent?.style);
					if (wide === undefined) delete style[property];
					else style[property] = wide;
				}
				continue;
			}
			const syntaxError = valueSyntaxError(property, expanded);
			if (syntaxError) {
				diagnostics.push(createDiagnostic("INVALID_VALUE", "error", syntaxError, winner.declaration.range));
				continue;
			}

			const normalized = normalizeValue(property, expanded, {
				parentFontSize,
				fontSize,
				rootFontSize,
			});
			if (normalized === null) {
				diagnostics.push(
					createDiagnostic("INVALID_VALUE", "error", `Invalid ${property} value.`, winner.declaration.range),
				);
				continue;
			}
			if (typeof normalized === "number" && Math.abs(normalized) > SEMANTIC_CSS_LIMITS_V1.maxAbsoluteLengthPt) {
				diagnostics.push(
					createDiagnostic(
						"INVALID_VALUE",
						"error",
						`${property} exceeds the Semantic CSS length limit.`,
						winner.declaration.range,
					),
				);
				continue;
			}
			if (property === "display") {
				hidden = normalized === "none";
				if (hidden) delete style.display;
				else style.display = normalized;
				continue;
			}
			if (property === "order") {
				const nextOrder = typeof normalized === "number" ? normalized : Number(normalized);
				if (!Number.isInteger(nextOrder)) {
					diagnostics.push(
						createDiagnostic("INVALID_VALUE", "error", "order must be an integer.", winner.declaration.range),
					);
				} else order = nextOrder;
				continue;
			}
			if (definition.category === "structural") {
				if (!structuralValue(property, normalized, structural)) {
					diagnostics.push(
						createDiagnostic("INVALID_VALUE", "error", `Invalid ${property} value.`, winner.declaration.range),
					);
				}
				continue;
			}
			specifiedStyleProperties.add(property);
			style[property] = normalized;
		}
		resolved[node.node.key] = {
			style,
			specifiedStyleProperties: [...specifiedStyleProperties],
			structural,
			hidden,
			order,
		};
	}

	if (diagnostics.some(isFatalStylesheetDiagnostic)) {
		return { nodes: {}, renderTree: tree, diagnostics };
	}
	return { nodes: resolved, renderTree: createRenderTree(tree, flatNodes, resolved), diagnostics };
}
