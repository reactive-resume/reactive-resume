import type { Style, ViewProps } from "./forme/primitives";
import type { HTMLElement, Node } from "node-html-parser";
import type { ReactNode } from "react";
import { NodeType, parse } from "node-html-parser";
import { createElement, Fragment } from "react";
import { Text, View } from "./forme/primitives";

export { Link, Text } from "./forme/primitives";

/** A parsed HTML element, as rich-text renderers receive it. */
export type HtmlElement = HTMLElement & {
	/** Position among its parent's children with the same tag. */
	indexOfType: number;
	/** Stylesheet rules that match it, then its inline `style`. */
	styles: Style[];
};

type HtmlRendererProps = { element: HtmlElement; style: Style[]; children: ReactNode };
type HtmlRenderer = (props: HtmlRendererProps) => ReactNode;

type HtmlProps = Omit<ViewProps, "children"> & {
	children: string;
	/** Per-tag renderers; tags without one render as a View or, when inline, a Text. */
	renderers?: Record<string, HtmlRenderer>;
	/** Styles by tag name (`p`) or class (`.mark`). */
	stylesheet?: Record<string, Style>;
};

// Inline tags flow inside a line of text; everything else is a block.
const INLINE_TAGS = new Set([
	"span",
	"br",
	"b",
	"strong",
	"i",
	"em",
	"u",
	"s",
	"strike",
	"mark",
	"code",
	"sub",
	"sup",
	"q",
	"cite",
	"abbr",
	"dfn",
	"small",
	"label",
]);

// What browsers draw without a stylesheet, minus spacing and sizes: templates own those.
const TAG_STYLES: Record<string, Style> = {
	h1: { fontWeight: "bold" },
	h2: { fontWeight: "bold" },
	h3: { fontWeight: "bold" },
	h4: { fontWeight: "bold" },
	h5: { fontWeight: "bold" },
	h6: { fontWeight: "bold" },
	b: { fontWeight: "bold" },
	strong: { fontWeight: "bold" },
	i: { fontStyle: "italic" },
	em: { fontStyle: "italic" },
	cite: { fontStyle: "italic" },
	s: { textDecoration: "line-through" },
	strike: { textDecoration: "line-through" },
	u: { textDecoration: "underline" },
	a: { textDecoration: "underline" },
	li: { display: "flex", flexDirection: "row" },
	tr: { flexDirection: "row" },
	td: { flexGrow: 1, flexShrink: 1 },
	th: { flexGrow: 1, flexShrink: 1, fontWeight: "bold" },
};

const camelCase = (property: string) =>
	property.trim().replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

/** An inline `style` attribute as a style object. Values stay CSS strings; the Forme conversion reads them. */
function parseInlineStyle(value: string | undefined): Style | undefined {
	if (!value?.trim()) return undefined;
	const style: Record<string, unknown> = {};
	for (const declaration of value.split(";")) {
		const colon = declaration.indexOf(":");
		if (colon === -1) continue;
		const property = camelCase(declaration.slice(0, colon));
		const text = declaration.slice(colon + 1).trim();
		if (!property || !text) continue;
		if (property === "fontFamily")
			style.fontFamily = text.split(",").map((family) => family.trim().replace(/["']/g, ""));
		else if (property === "background") style.backgroundColor = text;
		else style[property] = text;
	}
	return style as Style;
}

const tagOf = (element: HTMLElement) => element.rawTagName?.toLowerCase() ?? "";

function matchingStyles(element: HTMLElement, tag: string, stylesheet: Record<string, Style>): Style[] {
	const styles: Style[] = [];
	if (TAG_STYLES[tag]) styles.push(TAG_STYLES[tag]);
	for (const [selector, style] of Object.entries(stylesheet)) {
		const matches = selector.startsWith(".") ? element.classList.contains(selector.slice(1)) : selector === tag;
		if (matches) styles.push(style);
	}
	const inline = parseInlineStyle(element.getAttribute("style"));
	if (inline) styles.push(inline);
	return styles;
}

type Converted = HtmlElement | string;

/** Gives every element in the tree its styles and `indexOfType`, before anything asks whether it's a block. */
function annotate(element: HtmlElement, stylesheet: Record<string, Style>) {
	element.styles = matchingStyles(element, tagOf(element), stylesheet);
	const counters = new Map<string, number>();
	for (const child of element.childNodes) {
		if (child.nodeType !== NodeType.ELEMENT_NODE) continue;
		const childElement = child as HtmlElement;
		const tag = tagOf(childElement);
		childElement.indexOfType = counters.get(tag) ?? 0;
		counters.set(tag, childElement.indexOfType + 1);
		annotate(childElement, stylesheet);
	}
}

const toConverted = (node: Node): Converted | null => {
	if (node.nodeType === NodeType.TEXT_NODE) return node.text;
	return node.nodeType === NodeType.ELEMENT_NODE ? (node as HtmlElement) : null;
};

const isBlockStyle = (style: Style) => style.display === "flex" || (style.display as string) === "block";

/** Whether an element lays out as a block (a View) rather than inside a line of text. */
function isBlock(node: Converted): boolean {
	if (typeof node === "string") return false;
	const tag = tagOf(node);
	if (tag !== "a" && !INLINE_TAGS.has(tag)) return true;
	if (node.styles.some(isBlockStyle)) return true;
	return node.childNodes.some((child) => child.nodeType === NodeType.ELEMENT_NODE && isBlock(child as HtmlElement));
}

type RenderOptions = { renderers: Record<string, HtmlRenderer>; collapse: boolean };

const collapseWhitespace = (text: string) => text.replace(/[\t\n\f\r ]+/g, " ");

/**
 * Children in runs: consecutive inline content shares one Text (one paragraph of lines), blocks stand alone.
 * Document whitespace collapses as in a browser; authored Unicode spaces are kept.
 */
function renderChildren(parent: HtmlElement | undefined, nodes: Node[], options: RenderOptions): ReactNode {
	const converted = nodes.map(toConverted).filter((node): node is Converted => node !== null);
	const runs: { block: boolean; items: Converted[] }[] = [];
	let lastBlock: boolean | undefined;

	converted.forEach((node, index) => {
		let item = node;
		if (typeof item === "string" && options.collapse) {
			if (lastBlock !== false) item = item.replace(/^[\t\n\f\r ]+/, "");
			const next = converted[index + 1];
			if (next && isBlock(next)) item = item.replace(/[\t\n\f\r ]+$/, "");
			item = collapseWhitespace(item);
		}
		if (item === "") return;
		const block = isBlock(item);
		if (block !== lastBlock || runs.length === 0) runs.push({ block, items: [] });
		runs.at(-1)?.items.push(item);
		lastBlock = block;
	});

	const parentIsText = parent !== undefined && tagOf(parent) !== "a" && !isBlock(parent);
	const rendered = runs.map((run, runIndex) => {
		const items = run.items.map((item, index) => renderNode(item, options, index));
		const [first] = run.items;
		const loneAnchor = run.items.length === 1 && typeof first === "object" && tagOf(first) === "a";
		const wrap = !run.block && !parentIsText && !loneAnchor && (items.length > 1 || typeof run.items[0] === "string");
		return wrap
			? createElement(Text, { key: runIndex }, ...items)
			: createElement(Fragment, { key: runIndex }, ...items);
	});
	return rendered.length === 1 ? rendered[0] : rendered;
}

function renderNode(node: Converted, options: RenderOptions, key: number): ReactNode {
	if (typeof node === "string") return node;
	const tag = tagOf(node);
	const preserve = tag === "pre" || node.getAttribute("data-resume-whitespace") === "preserve";
	const children = renderChildren(node, node.childNodes, preserve ? { ...options, collapse: false } : options);
	const renderer = options.renderers[tag];
	if (renderer) return createElement(Fragment, { key }, renderer({ element: node, style: node.styles, children }));
	return createElement(isBlock(node) ? View : Text, { key, style: node.styles }, children);
}

/** HTML from the rich-text editor, drawn with PDF primitives. Same contract as react-pdf-html's `Html`. */
export function Html({ children, renderers = {}, stylesheet = {}, style, ...flowProps }: HtmlProps) {
	const root = parse(children, { comment: false }) as unknown as HtmlElement;
	annotate(root, stylesheet);
	return (
		<View {...flowProps} style={style}>
			{renderChildren(undefined, root.childNodes, { renderers, collapse: true })}
		</View>
	);
}
