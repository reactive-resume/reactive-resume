import type { SemanticNodeKind } from "../types";
import { SEMANTIC_NODE_KINDS } from "./semantic";

export type PropertyDefinition = {
	category:
		| "flexbox"
		| "layout"
		| "dimension"
		| "color"
		| "text"
		| "image"
		| "spacing"
		| "border"
		| "transform"
		| "structural";
	inheritable: boolean;
	appliesTo: readonly SemanticNodeKind[];
	values: readonly string[];
	units: readonly string[];
};

export type PropertyRegistry = Readonly<Record<string, PropertyDefinition | undefined>>;

export const SEMANTIC_CSS_CSS_WIDE_KEYWORDS_V1 = ["inherit", "initial"] as const;
export const SEMANTIC_CSS_LENGTH_UNITS_V1 = ["pt", "px", "in", "mm", "cm", "%", "em", "rem"] as const;
export const SEMANTIC_CSS_BORDER_STYLE_VALUES_V1 = ["dotted", "dashed", "solid"] as const;
export const SEMANTIC_CSS_LENGTH_VALUE_KEYWORDS_V1 = [
	"auto",
	"none",
	"normal",
	"max-content",
	"min-content",
	"fit-content",
	"thin",
	"medium",
	"thick",
] as const;
export const SEMANTIC_CSS_LENGTH_PROPERTIES_V1 = [
	"bottom",
	"border-bottom-left-radius",
	"border-bottom-right-radius",
	"border-bottom-width",
	"border-left-width",
	"border-radius",
	"border-right-width",
	"border-top-left-radius",
	"border-top-right-radius",
	"border-top-width",
	"border-width",
	"column-gap",
	"flex-basis",
	"font-size",
	"gap",
	"height",
	"left",
	"letter-spacing",
	"margin-bottom",
	"margin-left",
	"margin-right",
	"margin-top",
	"max-height",
	"max-width",
	"min-height",
	"min-width",
	"padding-bottom",
	"padding-left",
	"padding-right",
	"padding-top",
	"right",
	"row-gap",
	"text-indent",
	"top",
	"width",
	"-resume-min-presence-ahead",
	"-resume-shadow-width",
] as const;

const containerNodes = [
	"page",
	"region",
	"header",
	"contact-list",
	"contact-item",
	"section",
	"section-heading",
	"section-items",
	"item",
	"item-header",
	"rich-text",
	"list",
	"list-item",
	"horizontal-rule",
	"template-part",
] as const satisfies readonly SemanticNodeKind[];

const textNodes = [
	"name",
	"headline",
	"section-heading",
	"combined-text",
	"field",
	"rich-heading",
	"blockquote",
	"paragraph",
	"list-item-content",
	"list-marker",
	"strong",
	"emphasis",
	"underline",
	"strike",
	"code",
	"text-span",
	"mark",
	"hard-break",
] as const satisfies readonly SemanticNodeKind[];

const linkContainerNodes = [...containerNodes, "link"] as SemanticNodeKind[];
const textAndLinkNodes = [...textNodes, "link"] as SemanticNodeKind[];
const colorNodes = [...containerNodes, ...textNodes, "link", "icon", "level"] as SemanticNodeKind[];
const spacingNodes = [...containerNodes, ...textNodes, "link", "picture"] as SemanticNodeKind[];
const structuralNodes = SEMANTIC_NODE_KINDS.filter((kind) => kind !== "resume") as SemanticNodeKind[];
const lengthProperties = new Set<string>(SEMANTIC_CSS_LENGTH_PROPERTIES_V1);
const numericLengthUnits = SEMANTIC_CSS_LENGTH_UNITS_V1.filter((unit) => unit !== "%");
const borderStyleProperties = /^(?:border-style|border-(?:top|right|bottom|left)-style)$/;
const borderShorthandProperties = /^(?:border|border-(?:top|right|bottom|left))$/;
const propertyValueHints = {
	"align-content": ["flex-start", "flex-end", "center", "stretch", "space-between", "space-around", "space-evenly"],
	"align-items": ["flex-start", "flex-end", "center", "stretch", "baseline"],
	"align-self": ["auto", "flex-start", "flex-end", "center", "stretch", "baseline"],
	flex: ["none", "auto"],
	"flex-direction": ["row", "row-reverse", "column", "column-reverse"],
	"flex-wrap": ["nowrap", "wrap", "wrap-reverse"],
	"flex-flow": ["row", "row-reverse", "column", "column-reverse", "nowrap", "wrap", "wrap-reverse"],
	"justify-content": ["flex-start", "flex-end", "center", "space-between", "space-around", "space-evenly"],
	display: ["flex", "none"],
	position: ["absolute", "relative", "static"],
	overflow: ["hidden"],
	direction: ["ltr", "rtl"],
	"font-style": ["normal", "italic"],
	"font-weight": [
		"thin",
		"hairline",
		"ultralight",
		"extralight",
		"light",
		"normal",
		"medium",
		"semibold",
		"demibold",
		"bold",
		"ultrabold",
		"extrabold",
		"heavy",
		"black",
	],
	"line-height": ["normal"],
	"text-align": ["left", "right", "center", "justify"],
	"text-decoration": ["none", "underline", "line-through", "line-through underline", "underline line-through"],
	"text-overflow": ["ellipsis"],
	"text-transform": ["none", "capitalize", "lowercase", "uppercase", "upperfirst"],
	"vertical-align": ["sub", "super"],
	"object-fit": ["contain", "cover", "fill", "none", "scale-down"],
	"object-position": ["left", "right", "top", "bottom", "center"],
	"transform-origin": ["left", "right", "top", "bottom", "center"],
	"break-before": ["auto", "page"],
	"break-inside": ["auto", "avoid"],
	size: ["A4", "letter"],
	"-resume-fixed": ["true", "false", "0", "1"],
} as const satisfies Readonly<Record<string, readonly string[]>>;

function propertyValues(name: string): readonly string[] {
	const values = borderStyleProperties.test(name)
		? SEMANTIC_CSS_BORDER_STYLE_VALUES_V1
		: borderShorthandProperties.test(name)
			? SEMANTIC_CSS_BORDER_STYLE_VALUES_V1.map((style) => `1pt ${style}`)
			: (propertyValueHints[name as keyof typeof propertyValueHints] ?? []);
	return [...SEMANTIC_CSS_CSS_WIDE_KEYWORDS_V1, ...values];
}

function propertyUnits(name: string): readonly string[] {
	if (name === "size" || name === "-resume-min-presence-ahead") return numericLengthUnits;
	return lengthProperties.has(name) || name === "line-height" ? SEMANTIC_CSS_LENGTH_UNITS_V1 : [];
}

function entries(
	names: readonly string[],
	definition: Omit<PropertyDefinition, "units" | "values">,
): Readonly<Record<string, PropertyDefinition | undefined>> {
	return Object.fromEntries(
		names.map((name) => [
			name,
			{
				...definition,
				appliesTo: [...new Set(definition.appliesTo)],
				values: propertyValues(name),
				units: propertyUnits(name),
			},
		]),
	);
}

const properties = {
	...entries(
		[
			"align-content",
			"align-items",
			"align-self",
			"flex",
			"flex-direction",
			"flex-wrap",
			"flex-flow",
			"flex-grow",
			"flex-shrink",
			"flex-basis",
			"justify-content",
		],
		{ category: "flexbox", inheritable: false, appliesTo: linkContainerNodes },
	),
	...entries(["gap", "row-gap", "column-gap"], {
		category: "flexbox",
		inheritable: false,
		appliesTo: [...linkContainerNodes, "level"],
	}),
	...entries(["aspect-ratio", "bottom"], {
		category: "layout",
		inheritable: false,
		appliesTo: linkContainerNodes,
	}),
	...entries(["display"], {
		category: "layout",
		inheritable: false,
		appliesTo: [...linkContainerNodes, "list-item-content", "list-marker"],
	}),
	...entries(["left", "position", "right", "top", "overflow", "z-index"], {
		category: "layout",
		inheritable: false,
		appliesTo: linkContainerNodes,
	}),
	...entries(["width", "height", "min-width", "min-height", "max-width", "max-height"], {
		category: "dimension",
		inheritable: false,
		appliesTo: [...linkContainerNodes, "picture"],
	}),
	...entries(["color"], { category: "color", inheritable: true, appliesTo: colorNodes }),
	...entries(["background-color"], { category: "color", inheritable: false, appliesTo: linkContainerNodes }),
	...entries(["opacity"], { category: "color", inheritable: false, appliesTo: colorNodes }),
	...entries(["direction"], { category: "text", inheritable: true, appliesTo: textAndLinkNodes }),
	...entries(["font-size"], {
		category: "text",
		inheritable: true,
		appliesTo: [...textAndLinkNodes, "icon", "level"],
	}),
	...entries(["font-style", "font-weight", "letter-spacing", "line-height"], {
		category: "text",
		inheritable: true,
		appliesTo: textAndLinkNodes,
	}),
	...entries(["max-lines"], { category: "text", inheritable: false, appliesTo: textAndLinkNodes }),
	...entries(["text-align"], { category: "text", inheritable: true, appliesTo: textAndLinkNodes }),
	...entries(["text-decoration", "text-decoration-color", "text-decoration-style"], {
		category: "text",
		inheritable: false,
		appliesTo: textAndLinkNodes,
	}),
	...entries(["text-indent"], { category: "text", inheritable: true, appliesTo: textAndLinkNodes }),
	...entries(["text-overflow"], { category: "text", inheritable: false, appliesTo: textAndLinkNodes }),
	...entries(["text-transform"], { category: "text", inheritable: true, appliesTo: textAndLinkNodes }),
	...entries(["vertical-align"], { category: "text", inheritable: false, appliesTo: textAndLinkNodes }),
	...entries(["object-fit", "object-position"], { category: "image", inheritable: false, appliesTo: ["picture"] }),
	...entries(["-resume-shadow-color", "-resume-shadow-width"], {
		category: "image",
		inheritable: false,
		appliesTo: ["picture"],
	}),
	...entries(
		[
			"margin",
			"margin-top",
			"margin-right",
			"margin-bottom",
			"margin-left",
			"margin-horizontal",
			"margin-vertical",
			"padding",
			"padding-top",
			"padding-right",
			"padding-bottom",
			"padding-left",
			"padding-horizontal",
			"padding-vertical",
		],
		{ category: "spacing", inheritable: false, appliesTo: spacingNodes },
	),
	...entries(
		[
			"border",
			"border-color",
			"border-style",
			"border-width",
			"border-top",
			"border-right",
			"border-bottom",
			"border-left",
			"border-top-color",
			"border-top-style",
			"border-top-width",
			"border-right-color",
			"border-right-style",
			"border-right-width",
			"border-bottom-color",
			"border-bottom-style",
			"border-bottom-width",
			"border-left-color",
			"border-left-style",
			"border-left-width",
			"border-radius",
			"border-top-left-radius",
			"border-top-right-radius",
			"border-bottom-right-radius",
			"border-bottom-left-radius",
		],
		{ category: "border", inheritable: false, appliesTo: [...linkContainerNodes, "picture"] },
	),
	...entries(["transform", "transform-origin"], {
		category: "transform",
		inheritable: false,
		appliesTo: [...linkContainerNodes, "picture"],
	}),
	...entries(["order", "break-before", "break-inside"], {
		category: "structural",
		inheritable: false,
		appliesTo: structuralNodes,
	}),
	...entries(["orphans", "widows"], { category: "structural", inheritable: false, appliesTo: textNodes }),
	...entries(["size"], { category: "structural", inheritable: false, appliesTo: ["page"] }),
	...entries(["-resume-fixed"], { category: "structural", inheritable: false, appliesTo: structuralNodes }),
	...entries(["-resume-min-presence-ahead"], {
		category: "structural",
		inheritable: false,
		appliesTo: structuralNodes,
	}),
} satisfies PropertyRegistry;

export const PROPERTY_REGISTRY_V1: PropertyRegistry = properties;
