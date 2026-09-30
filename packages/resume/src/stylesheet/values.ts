import type { SemanticCssCompilerDiagnosticCode } from "./diagnostics";
import type {
	CompiledDeclaration,
	CompiledMediaQuery,
	CompiledStyleRule,
	MediaFeature,
	ParsedStylesheet,
	SemanticCssDiagnostic,
	SourceRange,
	StyleProgram,
} from "./types";
import type { CssLocation, CssNode } from "css-tree";
import * as csstree from "css-tree";
import { createDiagnostic, EMPTY_SOURCE_RANGE, isFatalStylesheetDiagnostic } from "./diagnostics";
import { SEMANTIC_CSS_LIMITS_V1 } from "./limits";
import {
	PROPERTY_REGISTRY_V1,
	SEMANTIC_CSS_BORDER_STYLE_VALUES_V1,
	SEMANTIC_CSS_CSS_WIDE_KEYWORDS_V1,
	SEMANTIC_CSS_LENGTH_PROPERTIES_V1,
	SEMANTIC_CSS_LENGTH_UNITS_V1,
	SEMANTIC_CSS_LENGTH_VALUE_KEYWORDS_V1,
} from "./registry/properties";
import { compileSelector } from "./selector";

export type CompileProgramResult = {
	program: StyleProgram | null;
	diagnostics: readonly SemanticCssDiagnostic[];
};

type AstNode = CssNode & {
	block?: AstNode | null;
	children?: Iterable<AstNode>;
	important?: boolean | string;
	name?: string;
	prelude?: AstNode | null;
	property?: string;
	value?: AstNode | string;
};

const absoluteUnitToPt = {
	pt: 1,
	px: 72 / 96,
	in: 72,
	mm: 72 / 25.4,
	cm: 72 / 2.54,
} as const;

const spacingShorthands = new Set(["margin", "padding"]);
const sides = ["top", "right", "bottom", "left"] as const;
const borderStyles = new Set<string>(SEMANTIC_CSS_BORDER_STYLE_VALUES_V1);
const cssWideKeywords = new Set<string>(SEMANTIC_CSS_CSS_WIDE_KEYWORDS_V1);
const lengthValueKeywords = new Set<string>(SEMANTIC_CSS_LENGTH_VALUE_KEYWORDS_V1);
const maxMediaQueryBranches = SEMANTIC_CSS_LIMITS_V1.maxRules;
const lengthUnitPattern = SEMANTIC_CSS_LENGTH_UNITS_V1.map((unit) => (unit === "%" ? "%" : unit)).join("|");
const borderWidthPattern = new RegExp(
	`^(?:thin|medium|thick|[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?(?:${lengthUnitPattern})?)$`,
	"i",
);

function isCssWideKeyword(value: string): boolean {
	return cssWideKeywords.has(value.toLowerCase());
}

function isRegisteredPropertyValue(property: string, value: string): boolean {
	return (
		PROPERTY_REGISTRY_V1[property]?.values.some((candidate) => candidate.toLowerCase() === value.toLowerCase()) ?? false
	);
}

function isRegisteredShorthandComponent(property: string, value: string): boolean {
	return !isCssWideKeyword(value) && isRegisteredPropertyValue(property, value);
}

export const SEMANTIC_CSS_LENGTH_PROPERTIES = new Set<string>(SEMANTIC_CSS_LENGTH_PROPERTIES_V1);

function range(location: CssLocation | null | undefined): SourceRange {
	return location ? { start: { ...location.start }, end: { ...location.end } } : EMPTY_SOURCE_RANGE;
}

export function decodeCssEscapes(value: string): string {
	return value.replaceAll(
		/\\([0-9a-f]{1,6})[ \t\r\n\f]?|\\(.)/gi,
		(_match, hex: string | undefined, escaped: string | undefined) => {
			const codePoint = hex ? Number.parseInt(hex, 16) : 0;
			return hex ? String.fromCodePoint(codePoint === 0 || codePoint > 0x10ffff ? 0xfffd : codePoint) : (escaped ?? "");
		},
	);
}

export function cssFunctionDepth(value: string): number {
	const stack: boolean[] = [];
	let currentDepth = 0;
	let maximumDepth = 0;
	let identifier = "";
	let quote = "";

	for (let index = 0; index < value.length; index++) {
		const character = value[index] ?? "";
		if (quote) {
			if (character === quote && value[index - 1] !== "\\") quote = "";
			continue;
		}
		if (character === '"' || character === "'") {
			quote = character;
			identifier = "";
			continue;
		}
		if (character === "/" && value[index + 1] === "*") {
			const end = value.indexOf("*/", index + 2);
			index = end < 0 ? value.length : end + 1;
			continue;
		}
		if (/[-_a-zA-Z0-9\\]/.test(character)) {
			identifier += character;
			continue;
		}
		if (character === "(") {
			const isFunction = identifier.length > 0;
			stack.push(isFunction);
			if (isFunction) maximumDepth = Math.max(maximumDepth, ++currentDepth);
			identifier = "";
			continue;
		}
		if (character === ")") {
			if (stack.pop()) currentDepth--;
		}
		identifier = "";
	}

	return maximumDepth;
}

function identifier(value: string): string {
	return decodeCssEscapes(value);
}

function children(node: AstNode | null | undefined): AstNode[] {
	return node?.children ? [...node.children] : [];
}

function diagnostic(
	diagnostics: SemanticCssDiagnostic[],
	code: SemanticCssCompilerDiagnosticCode,
	message: string,
	node?: AstNode,
	severity: SemanticCssDiagnostic["severity"] = "error",
): void {
	diagnostics.push(createDiagnostic(code, severity, message, range(node?.loc)));
}

const gradientFunctionNames = new Set([
	"linear-gradient",
	"radial-gradient",
	"conic-gradient",
	"repeating-linear-gradient",
	"repeating-radial-gradient",
	"repeating-conic-gradient",
]);

function containsGradientFunction(node: AstNode | string | null | undefined): boolean {
	if (!node || typeof node === "string") return false;
	if (node.type === "Function" && node.name && gradientFunctionNames.has(identifier(node.name).toLowerCase()))
		return true;
	return children(node).some(containsGradientFunction);
}

function unsupportedPropertyMessage(property: string, value: AstNode | string | null | undefined): string {
	if (containsGradientFunction(value)) {
		return "Gradients are not supported by Semantic CSS. Use background-color or another supported property.";
	}
	return `The ${property} property is not supported by Semantic CSS.`;
}

function splitValue(value: string): string[] {
	const parts: string[] = [];
	let start = 0;
	let depth = 0;
	let quote = "";
	for (let index = 0; index < value.length; index++) {
		const character = value[index] ?? "";
		if (quote) {
			if (character === quote && value[index - 1] !== "\\") quote = "";
			continue;
		}
		if (character === '"' || character === "'") {
			quote = character;
			continue;
		}
		if (character === "(") depth++;
		if (character === ")") depth--;
		if (/\s/.test(character) && depth === 0) {
			if (start < index) parts.push(value.slice(start, index));
			start = index + 1;
		}
	}
	if (start < value.length) parts.push(value.slice(start));
	return parts.filter(Boolean);
}

function fourSides(property: string, values: readonly string[]): readonly [property: string, value: string][] | null {
	if (values.length < 1 || values.length > 4) return null;
	const [top, right = top, bottom = top, left = right] =
		values.length === 3
			? [values[0], values[1], values[2], values[1]]
			: values.length === 2
				? [values[0], values[1], values[0], values[1]]
				: values;
	return sides.map((side, index) => [`${property}-${side}`, [top, right, bottom, left][index] as string]);
}

function borderComponents(value: string): readonly [component: string, value: string][] | null {
	if (isCssWideKeyword(value)) {
		return [
			["width", value],
			["style", value],
			["color", value],
		];
	}
	const values = splitValue(value);
	let width = "medium";
	let style = "none";
	let color = "currentcolor";
	for (const part of values) {
		if (borderWidthPattern.test(part)) {
			if (width !== "medium") return null;
			width = part;
		} else if (borderStyles.has(part.toLowerCase())) {
			if (style !== "none") return null;
			style = part;
		} else if (color === "currentcolor") color = part;
		else return null;
	}
	return [
		["width", width],
		["style", style],
		["color", color],
	];
}

export function expandShorthand(property: string, value: string): readonly [property: string, value: string][] | null {
	const valueParts = splitValue(value);
	if (PROPERTY_REGISTRY_V1[property] && valueParts.length > 1 && valueParts.some(isCssWideKeyword)) return null;

	if (!spacingShorthands.has(property)) {
		if (property.endsWith("-horizontal")) {
			const prefix = property.slice(0, -"-horizontal".length);
			return [
				[`${prefix}-left`, value],
				[`${prefix}-right`, value],
			];
		}
		if (property.endsWith("-vertical")) {
			const prefix = property.slice(0, -"-vertical".length);
			return [
				[`${prefix}-top`, value],
				[`${prefix}-bottom`, value],
			];
		}
		if (property === "gap") {
			const values = splitValue(value);
			if (values.length < 1 || values.length > 2) return null;
			return [
				["row-gap", values[0] as string],
				["column-gap", (values[1] ?? values[0]) as string],
			];
		}
		if (property === "flex-flow") {
			if (isCssWideKeyword(value))
				return [
					["flex-direction", value],
					["flex-wrap", value],
				];
			const values = splitValue(value);
			if (values.length < 1 || values.length > 2) return null;
			const direction = values.find((part) => isRegisteredShorthandComponent("flex-direction", part)) ?? "row";
			const wrap = values.find((part) => isRegisteredShorthandComponent("flex-wrap", part)) ?? "nowrap";
			if (values.some((part) => part !== direction && part !== wrap)) return null;
			return [
				["flex-direction", direction],
				["flex-wrap", wrap],
			];
		}
		if (property === "flex") {
			if (isCssWideKeyword(value))
				return [
					["flex-grow", value],
					["flex-shrink", value],
					["flex-basis", value],
				];
			if (value === "none")
				return [
					["flex-grow", "0"],
					["flex-shrink", "0"],
					["flex-basis", "auto"],
				];
			if (value === "auto")
				return [
					["flex-grow", "1"],
					["flex-shrink", "1"],
					["flex-basis", "auto"],
				];
			const values = splitValue(value);
			if (values.length < 1 || values.length > 3) return null;
			const numeric = (part: string | undefined) => part !== undefined && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(part);
			if (!numeric(values[0])) {
				return values.length === 1
					? [
							["flex-grow", "1"],
							["flex-shrink", "1"],
							["flex-basis", values[0] as string],
						]
					: null;
			}
			const grow = values[0] as string;
			const hasShrink = numeric(values[1]);
			if (!hasShrink && values.length > 2) return null;
			const shrink = hasShrink ? (values[1] as string) : "1";
			const basis = values[hasShrink ? 2 : 1] ?? "0%";
			return [
				["flex-grow", grow],
				["flex-shrink", shrink],
				["flex-basis", basis],
			];
		}
		if (property === "border") {
			const components = borderComponents(value);
			return (
				components?.flatMap(([component, componentValue]) =>
					sides.map((side) => [`border-${side}-${component}`, componentValue] as const),
				) ?? null
			);
		}
		const sideBorder = property.match(/^border-(top|right|bottom|left)$/);
		if (sideBorder) {
			const components = borderComponents(value);
			return (
				components?.map(
					([component, componentValue]) => [`border-${sideBorder[1]}-${component}`, componentValue] as [string, string],
				) ?? null
			);
		}
		if (/^border-(width|style|color)$/.test(property)) {
			const component = property.slice("border-".length);
			return (
				fourSides("border", splitValue(value))?.map(([sideProperty, sideValue]) => [
					`${sideProperty}-${component}`,
					sideValue,
				]) ?? null
			);
		}
		if (property === "border-radius") {
			if (value.includes("/")) return null;
			const corners = fourSides("border", splitValue(value));
			if (!corners) return null;
			const cornerNames = ["top-left", "top-right", "bottom-right", "bottom-left"] as const;
			return corners.map(([, cornerValue], index) => [`border-${cornerNames[index]}-radius`, cornerValue]);
		}
		return [[property, value]];
	}

	const values = splitValue(value);
	return fourSides(property, values);
}

function parseAbsoluteLength(value: string): number | null {
	const match = value.trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(pt|px|in|mm|cm)?$/i);
	if (!match) return null;
	const number = Number(match[1]);
	const unit = (match[2]?.toLowerCase() ?? "pt") as keyof typeof absoluteUnitToPt;
	return number * absoluteUnitToPt[unit];
}

const lengthPattern = new RegExp(`^[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?(?:${lengthUnitPattern})?$`, "i");

export function valueSyntaxError(property: string, value: string): string | null {
	const normalized = value.trim().toLowerCase();
	if (!normalized) return "Values cannot be empty.";
	if (cssWideKeywords.has(normalized) || /var\s*\(/i.test(decodeCssEscapes(value))) return null;
	if (SEMANTIC_CSS_LENGTH_PROPERTIES.has(property)) {
		if (lengthPattern.test(normalized)) {
			if (property === "font-size" && Number.parseFloat(normalized) < 0) {
				return "font-size cannot be negative.";
			}
			return null;
		}
		if (lengthValueKeywords.has(normalized)) return null;
		return `${property} requires a supported PDF length.`;
	}
	if (property === "size") {
		const parts = splitValue(normalized);
		return isRegisteredPropertyValue(property, normalized) ||
			(parts.length >= 1 && parts.length <= 2 && parts.every((part) => lengthPattern.test(part)))
			? null
			: "size requires A4, letter, or one or two PDF lengths.";
	}
	if (property === "display")
		return isRegisteredPropertyValue(property, normalized) ? null : "display supports flex or none.";
	if (property === "direction")
		return isRegisteredPropertyValue(property, normalized) ? null : "direction supports ltr or rtl.";
	if (/^(?:border-style|border-(?:top|right|bottom|left)-style)$/.test(property)) {
		return isRegisteredPropertyValue(property, normalized) ? null : "border styles support dotted, dashed, or solid.";
	}
	if (property === "break-before")
		return isRegisteredPropertyValue(property, normalized) ? null : "break-before supports auto or page.";
	if (property === "break-inside")
		return isRegisteredPropertyValue(property, normalized) ? null : "break-inside supports auto or avoid.";
	if (property === "-resume-fixed")
		return isRegisteredPropertyValue(property, normalized) ? null : "-resume-fixed requires a boolean.";
	if (
		property === "order" ||
		property === "orphans" ||
		property === "widows" ||
		property === "z-index" ||
		property === "max-lines"
	) {
		const number = Number(normalized);
		return Number.isInteger(number) ? null : `${property} requires an integer.`;
	}
	if (property === "opacity" || property === "flex-grow" || property === "flex-shrink") {
		const number = Number(normalized);
		if (!Number.isFinite(number)) return `${property} requires a finite number.`;
		if (property === "opacity" && (number < 0 || number > 1)) return "opacity must be between 0 and 1.";
		return null;
	}
	if (property === "line-height") {
		return isRegisteredPropertyValue(property, normalized) || lengthPattern.test(normalized)
			? null
			: "line-height requires a number or PDF length.";
	}
	return null;
}

function validateValue(property: string, value: string, node: AstNode, diagnostics: SemanticCssDiagnostic[]): void {
	const decoded = decodeCssEscapes(value).toLowerCase();
	if (property === "src" || /\burl\s*\(/i.test(decoded)) {
		diagnostic(diagnostics, "FORBIDDEN_CSS_VALUE", "External CSS resources are not supported.", node);
		return;
	}

	for (const match of decoded.matchAll(
		/(^|[\s,(])([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(pt|px|in|mm|cm)(?=$|[\s,)])/gi,
	)) {
		const points = parseAbsoluteLength(`${match[2]}${match[3]}`);
		if (points === null || !Number.isFinite(points) || Math.abs(points) > SEMANTIC_CSS_LIMITS_V1.maxAbsoluteLengthPt) {
			diagnostic(
				diagnostics,
				"INVALID_VALUE",
				"Absolute lengths must be finite and within the Semantic CSS limit.",
				node,
			);
			return;
		}
		if (property === "font-size" && (points < 4 || points > 72)) {
			diagnostic(diagnostics, "EXTREME_VALUE", "This font size is renderable but unusually extreme.", node, "warning");
		}
	}
}

function parseMediaFeature(source: string): MediaFeature | null {
	const orientation = source.match(/^\(\s*orientation\s*:\s*(portrait|landscape)\s*\)$/i);
	if (orientation) return { name: "orientation", value: orientation[1]?.toLowerCase() as "portrait" | "landscape" };

	const dimensions = source.match(/^\(\s*(min-|max-)?(width|height)\s*:\s*([^)]+)\s*\)$/i);
	if (!dimensions) return null;
	return {
		name: dimensions[2]?.toLowerCase() as "width" | "height",
		comparison: dimensions[1] ? (dimensions[1].toLowerCase().startsWith("min") ? "min" : "max") : "equal",
		value: dimensions[3]?.trim() ?? "",
	};
}

function splitOutsideParentheses(value: string, separator: "," | "and"): string[] {
	const parts: string[] = [];
	let start = 0;
	let depth = 0;
	for (let index = 0; index < value.length; index++) {
		const character = value[index];
		if (character === "(") depth++;
		if (character === ")") depth--;
		if (depth !== 0) continue;
		if (separator === "," && character === ",") {
			parts.push(value.slice(start, index).trim());
			start = index + 1;
		} else if (
			separator === "and" &&
			value.slice(index, index + 3).toLowerCase() === "and" &&
			/\s/.test(value[index - 1] ?? " ") &&
			/\s/.test(value[index + 3] ?? " ")
		) {
			parts.push(value.slice(start, index).trim());
			start = index + 3;
		}
	}
	parts.push(value.slice(start).trim());
	return parts;
}

function parseMedia(node: AstNode, diagnostics: SemanticCssDiagnostic[]): readonly CompiledMediaQuery[] | null {
	const source = node.prelude ? csstree.generate(node.prelude) : "";
	const querySources = splitOutsideParentheses(source, ",");
	if (querySources.length > maxMediaQueryBranches) {
		diagnostic(diagnostics, "RESOURCE_LIMIT", "The media query list exceeds the Semantic CSS branch limit.", node);
		return null;
	}
	const queries = querySources.map((query) => {
		const features = splitOutsideParentheses(query, "and").map(parseMediaFeature);
		return features.every((feature): feature is MediaFeature => feature !== null) ? { features } : null;
	});
	const invalidValue = queries.some((query) =>
		query?.features.some((feature) => {
			if (feature.name === "orientation") return false;
			const match = feature.value.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(?:pt|px|in|mm|cm|em|rem)?$/i);
			if (!match) {
				return true;
			}
			if (!Number.isFinite(Number(match[1]))) return true;
			const absolute = parseAbsoluteLength(feature.value);
			return (
				absolute !== null &&
				(!Number.isFinite(absolute) || Math.abs(absolute) > SEMANTIC_CSS_LIMITS_V1.maxAbsoluteLengthPt)
			);
		}),
	);
	if (queries.length === 0 || queries.some((query) => query === null) || invalidValue) {
		diagnostic(
			diagnostics,
			"INVALID_MEDIA_QUERY",
			"Semantic CSS media queries support only width, height, and orientation.",
			node,
		);
		return null;
	}
	return queries as readonly CompiledMediaQuery[];
}

function combineMedia(
	parent: readonly CompiledMediaQuery[],
	child: readonly CompiledMediaQuery[],
): readonly CompiledMediaQuery[] | null {
	const parentBranches = Math.max(parent.length, 1);
	if (child.length > Math.floor(maxMediaQueryBranches / parentBranches)) return null;
	if (parent.length === 0) return child;
	return parent.flatMap((left) => child.map((right) => ({ features: [...left.features, ...right.features] })));
}

export function compileProgram(stylesheet: ParsedStylesheet, languageVersion: number): CompileProgramResult {
	const diagnostics: SemanticCssDiagnostic[] = [];
	const rules: CompiledStyleRule[] = [];
	let ruleCount = 0;
	let declarationCount = 0;
	let sourceOrder = 0;

	const compileRule = (node: AstNode, media: readonly CompiledMediaQuery[]) => {
		if (++ruleCount > SEMANTIC_CSS_LIMITS_V1.maxRules) {
			if (ruleCount === SEMANTIC_CSS_LIMITS_V1.maxRules + 1) {
				diagnostic(diagnostics, "RESOURCE_LIMIT", "The stylesheet has too many rules.", node);
			}
			return;
		}

		const selectorResult = node.prelude
			? compileSelector(node.prelude)
			: { selector: null, error: "Missing selector." };
		if (!selectorResult.selector) {
			const code = selectorResult.resourceLimit ? "RESOURCE_LIMIT" : "INVALID_SELECTOR";
			diagnostic(diagnostics, code, selectorResult.error ?? "Invalid selector.", node.prelude ?? node);
			return;
		}

		const declarations: CompiledDeclaration[] = [];
		for (const declaration of children(node.block)) {
			if (declaration.type !== "Declaration" || !declaration.property) continue;
			if (++declarationCount > SEMANTIC_CSS_LIMITS_V1.maxDeclarations) {
				if (declarationCount === SEMANTIC_CSS_LIMITS_V1.maxDeclarations + 1) {
					diagnostic(diagnostics, "RESOURCE_LIMIT", "The stylesheet has too many declarations.", declaration);
				}
				continue;
			}

			const decodedProperty = identifier(declaration.property);
			const property = decodedProperty.startsWith("--") ? decodedProperty : decodedProperty.toLowerCase();
			const lowerProperty = property.toLowerCase();
			const value =
				typeof declaration.value === "string" ? declaration.value : csstree.generate(declaration.value as CssNode);
			if (lowerProperty.startsWith("--resume-")) {
				diagnostic(
					diagnostics,
					"SYSTEM_VARIABLE_READONLY",
					"System variables beginning with --resume- are read-only.",
					declaration,
				);
				continue;
			}
			if (!property.startsWith("--") && !PROPERTY_REGISTRY_V1[property]) {
				diagnostic(
					diagnostics,
					property === "src" ? "FORBIDDEN_CSS_VALUE" : "UNSUPPORTED_PROPERTY",
					unsupportedPropertyMessage(property, declaration.value),
					declaration,
				);
				continue;
			}
			if (media.length > 0 && property === "size") {
				diagnostic(diagnostics, "MEDIA_PAGE_SIZE", "The size property is not allowed inside @media.", declaration);
				continue;
			}

			const trimmedValue = value.trim();
			const expanded = /var\s*\(/i.test(decodeCssEscapes(trimmedValue))
				? ([[property, trimmedValue]] as const)
				: expandShorthand(property, trimmedValue);
			if (!expanded) {
				diagnostic(diagnostics, "INVALID_VALUE", `Invalid ${property} shorthand.`, declaration);
				continue;
			}
			for (const [expandedProperty, expandedValue] of expanded) {
				const diagnosticCount = diagnostics.length;
				validateValue(expandedProperty, expandedValue, declaration, diagnostics);
				const syntaxError = property.startsWith("--") ? null : valueSyntaxError(expandedProperty, expandedValue);
				if (syntaxError) diagnostic(diagnostics, "INVALID_VALUE", syntaxError, declaration);
				if (diagnostics.length > diagnosticCount && diagnostics.at(-1)?.severity === "error") continue;
				declarations.push({
					property: expandedProperty,
					value: expandedValue,
					important: declaration.important === true || declaration.important === "important",
					sourceOrder: sourceOrder++,
					range: range(declaration.loc),
				});
			}
		}

		rules.push({
			selector: selectorResult.selector,
			declarations,
			media,
			range: range(node.loc),
		});
	};

	const visit = (nodes: readonly AstNode[], media: readonly CompiledMediaQuery[], mediaDepth: number): void => {
		for (const node of nodes) {
			if (node.type === "Rule") {
				compileRule(node, media);
				continue;
			}
			if (node.type !== "Atrule" || !node.name) continue;
			const name = identifier(node.name).toLowerCase();
			// Stylesheets saved before the version moved out of the text start with `@version 1;`.
			if (name === "version") continue;
			if (name !== "media") {
				diagnostic(
					diagnostics,
					name === "import" || name === "font-face" ? "FORBIDDEN_AT_RULE" : "UNSUPPORTED_AT_RULE",
					`@${name} is not supported by Semantic CSS.`,
					node,
				);
				continue;
			}
			if (mediaDepth >= SEMANTIC_CSS_LIMITS_V1.maxMediaNesting) {
				diagnostic(diagnostics, "RESOURCE_LIMIT", "Media nesting exceeds the Semantic CSS limit.", node);
				continue;
			}
			const compiledMedia = parseMedia(node, diagnostics);
			if (!compiledMedia) continue;
			const combinedMedia = combineMedia(media, compiledMedia);
			if (!combinedMedia) {
				diagnostic(diagnostics, "RESOURCE_LIMIT", "Nested media queries exceed the Semantic CSS branch limit.", node);
				continue;
			}
			visit(children(node.block), combinedMedia, mediaDepth + 1);
		}
	};

	const ast = stylesheet.ast as AstNode | null;
	if (ast) visit(children(ast), [], 0);
	const program = { languageVersion, rules } satisfies StyleProgram;
	return diagnostics.some(isFatalStylesheetDiagnostic)
		? { program: null, diagnostics }
		: { program: structuredClone(program), diagnostics };
}
