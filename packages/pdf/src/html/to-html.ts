import type { PageSize } from "../forme/primitives";
import type { HostElement, HostNode } from "../forme/reconciler";
import type { Style, StyleProp } from "../forme/style-types";
import { toSafeLink } from "@reactive-resume/utils/link";
import { escapeHtml } from "@reactive-resume/utils/string";
import { HOST } from "../forme/primitives";
import { COLOR_KEYS, flattenStyle, LENGTH_KEYS, toColor, toFormeStyle, toPoints } from "../forme/style";
import { DEFAULT_PAGE, pageDimensions } from "../forme/to-forme";
import { HEADING_NODE_PROP, RESUME_NODE_PROP } from "../page-map";

/**
 * Host tree → HTML and CSS, the web page's counterpart of `to-forme.tsx`. Templates draw with react-pdf-style
 * primitives; here every `View` becomes a flex column box as in Yoga, text becomes block or inline elements, and the
 * page becomes a sheet that narrows with the screen. Styles go through the same vocabulary the PDF accepts, so a
 * template looks the same in both, and nothing a resume supplies can reach the stylesheet unchecked.
 */

export type HtmlOutput = {
	/** The page sheets, ready to place inside a `.rr` container. */
	html: string;
	/** Rules for the classes `html` uses, scoped to `.rr`. */
	css: string;
};

export type ToHtmlOptions = {
	/** Resolves a picture's source to the URL a browser loads; return `undefined` to leave the picture out. */
	imageUrl?: ((source: string) => string | undefined) | undefined;
};

type Context = {
	fontSize: number;
	pageWidth: number;
	pageHeight: number;
	inText: boolean;
	/** Inside the header region's own box: its rows fold too. */
	inHeader?: boolean;
	imageUrl: (source: string) => string | undefined;
	classes: Map<string, string>;
};

const kebab = (property: string) => property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

const round = (value: number) => Math.round(value * 1000) / 1000;

const length = (value: number | string) => (typeof value === "number" ? `${round(value)}pt` : value);

const PERCENT = /^-?\d*\.?\d+%$/;
const SAFE_COLOR = /^(?:#[0-9a-f]{3,8}|rgba?\([\d.\s,]+\))$/i;

/** A colour as CSS, or `undefined`: only the hex and rgb forms `toColor` writes, checked character by character. */
function cssColor(value: unknown) {
	const color = toColor(value);
	return color && SAFE_COLOR.test(color) ? color : undefined;
}

// Shorthands Forme expands itself; CSS has no `paddingHorizontal`.
const EXPANDED: Record<string, readonly string[]> = {
	paddingHorizontal: ["paddingLeft", "paddingRight"],
	paddingVertical: ["paddingTop", "paddingBottom"],
	marginHorizontal: ["marginLeft", "marginRight"],
	marginVertical: ["marginTop", "marginBottom"],
};

const BORDER_STYLES = new Set(["solid", "dashed", "dotted"]);
const OBJECT_FITS = new Set(["contain", "cover", "fill", "none", "scale-down"]);
const BORDER_SHORTHANDS = new Set(["border", "borderTop", "borderRight", "borderBottom", "borderLeft"]);
// What Forme reads that a browser does without: widow and orphan control, line breaking, transforms (rotation is
// already left out of the PDF), and `lang`, which the document sets.
const FORME_ONLY = new Set(["minWidowLines", "minOrphanLines", "lineBreaking", "transform", "transformOrigin", "lang"]);

/** `"1 solid #ccc"` → `1pt solid #ccc`, keeping only widths, solid styles and colours. */
function borderShorthand(value: unknown, context: { fontSize: number }): string | undefined {
	if (typeof value === "number") return `${length(value)} solid`;
	if (typeof value !== "string") return undefined;
	const parts: string[] = [];
	for (const token of value.trim().split(/\s+(?![^(]*\))/)) {
		const points = toPoints(token, context);
		if (typeof points === "number" && Number.isFinite(points)) parts.push(length(points));
		else if (BORDER_STYLES.has(token)) parts.push("solid");
		else {
			const color = cssColor(token);
			if (color) parts.push(color);
		}
	}
	if (parts.length === 0) return undefined;
	// A border is drawn solid in the PDF whatever style it names; CSS draws nothing without one.
	if (!parts.includes("solid")) parts.push("solid");
	return parts.join(" ");
}

/** One value `toFormeStyle` produced, as CSS; `undefined` when CSS can't take it. */
function cssValue(key: string, value: unknown, fontSize: number): string | undefined {
	if (BORDER_SHORTHANDS.has(key)) return borderShorthand(value, { fontSize });
	if (FORME_ONLY.has(key)) return undefined;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) return undefined;
		return key === "fontSize" || LENGTH_KEYS.has(key) ? length(value) : String(round(value));
	}
	if (typeof value !== "string") return undefined;
	if (key === "fontFamily")
		return value
			.split(",")
			.map((family) => `"${family.trim().replace(/["\\<>{};]/g, "")}"`)
			.join(", ");
	if (COLOR_KEYS.has(key)) return SAFE_COLOR.test(value) ? value : undefined;
	if (LENGTH_KEYS.has(key)) {
		if (value === "auto") return value;
		// Percentages and shorthands with several values ("4 8") stay strings in Forme; every part must be a length.
		const parts = value
			.split(" ")
			.map((part) => (PERCENT.test(part) ? part : part && Number.isFinite(Number(part)) ? length(Number(part)) : ""));
		return parts.every(Boolean) ? parts.join(" ") : undefined;
	}
	if (key === "objectFit") return OBJECT_FITS.has(value) ? value : undefined;
	if (key === "textOverflow") return value === "ellipsis" ? value : undefined;
	// The rest are keywords `toFormeStyle` checked against what the PDF reads.
	return /^[a-z-]+$/.test(value) ? value : undefined;
}

/**
 * One flattened style as CSS declarations, through `toFormeStyle`: what the PDF draws, the web page draws; what it
 * drops (rotation, grid templates, unknown keys), the web page drops too.
 */
function toCssDeclarations(input: Style, context: Context) {
	const source = input as Record<string, unknown>;
	const { style, hidden } = toFormeStyle(input, context);
	const converted = style as Record<string, unknown>;
	const fontSize = typeof converted.fontSize === "number" ? converted.fontSize : context.fontSize;
	const declarations: [string, string][] = [];
	for (const key of Object.keys(source)) {
		const raw = source[key];
		// A browser draws percentage corners itself; Forme resolves them against the box's size, or drops them.
		const percentCorner =
			LENGTH_KEYS.has(key) && key.endsWith("Radius") && typeof raw === "string" && PERCENT.test(raw.trim());
		const css = percentCorner ? raw.trim() : cssValue(key, converted[key], fontSize);
		if (css === undefined) continue;
		for (const target of EXPANDED[key] ?? [key]) declarations.push([kebab(target), css]);
	}
	return { declarations, fontSize, hidden };
}

function className(declarations: [string, string][], context: Context): string | undefined {
	if (declarations.length === 0) return undefined;
	const body = declarations.map(([property, value]) => `${property}:${value}`).join(";");
	let name = context.classes.get(body);
	if (!name) {
		name = `c${context.classes.size}`;
		context.classes.set(body, name);
	}
	return name;
}

const isText = (node: HostNode) => "text" in node || node.type === HOST.text || node.type === HOST.link;

const isEmptyText = (node: HostNode): boolean =>
	"text" in node
		? node.text.length === 0
		: (node.type === HOST.text || node.type === HOST.link) && node.children.every(isEmptyText);

/** A text's runs without the line breaks that end it; a browser would draw an empty line for each. */
function withoutTrailingBreaks(nodes: HostNode[]): HostNode[] {
	const last = nodes.at(-1);
	if (!last) return nodes;
	if ("text" in last) {
		const text = last.text.replace(/\n+$/, "");
		if (text === last.text) return nodes;
		return text ? [...nodes.slice(0, -1), { ...last, text }] : withoutTrailingBreaks(nodes.slice(0, -1));
	}
	if (last.type !== HOST.text && last.type !== HOST.link) return nodes;
	const children = withoutTrailingBreaks(last.children);
	if (children === last.children) return nodes;
	if (children.length === 0) return withoutTrailingBreaks(nodes.slice(0, -1));
	return [...nodes.slice(0, -1), { ...last, children }];
}

const nodeKey = (element: HostElement): string | undefined => {
	const key = element.props[RESUME_NODE_PROP];
	return typeof key === "string" && key.length > 0 ? key : undefined;
};

const REGIONS = new Set(["main", "sidebar", "header"]);

/** Which part of the layout a box holds, as `SemanticRegionView` and `SemanticHeaderView` mark it. */
const regionOf = (element: HostElement) => {
	const region = element.props["data-region"];
	return typeof region === "string" && REGIONS.has(region) ? region : undefined;
};

/** The element a semantic node is best written as: the name is the page's heading, section titles its subheadings. */
function semanticTag(element: HostElement, block: boolean): { tag: string; attributes: string } | undefined {
	const heading = element.props[HEADING_NODE_PROP];
	const key = (typeof heading === "string" ? heading : nodeKey(element)) ?? "";
	if (key.endsWith("/header/name")) return block ? { tag: "h1", attributes: "" } : undefined;
	if (key.endsWith("/section-heading"))
		return block && element.children.every(isText)
			? { tag: "h2", attributes: "" }
			: { tag: "div", attributes: ' role="heading" aria-level="2"' };
	if (/\/section-[^/]+$/.test(key) && !key.endsWith("/section-items")) return { tag: "section", attributes: "" };
	return undefined;
}

const attributes = (classes: (string | undefined)[], extra = "") => {
	const list = classes.filter(Boolean).join(" ");
	return `${list ? ` class="${list}"` : ""}${extra}`;
};

/** The regions a box holds, itself included. */
const regionsCache = new WeakMap<HostElement, ReadonlySet<string>>();
function regionsIn(element: HostElement): ReadonlySet<string> {
	let regions = regionsCache.get(element);
	if (!regions) {
		const found = new Set<string>();
		const own = regionOf(element);
		if (own) found.add(own);
		for (const child of element.children)
			if (!("text" in child)) for (const region of regionsIn(child)) found.add(region);
		regions = found;
		regionsCache.set(element, regions);
	}
	return regions;
}

/** Whether a box holds a picture or a section: what makes a header row worth stacking on a phone. */
function holdsBlocks(element: HostElement): boolean {
	return element.children.some(
		(child) =>
			!("text" in child) &&
			(child.type === HOST.image || /\/section-[^/]+$/.test(nodeKey(child) ?? "") || holdsBlocks(child)),
	);
}

type Part = "main" | "sidebar" | "header-sidebar";

/**
 * Where a box's children sit when the columns fold: the box that splits the main column from the sidebar gets its
 * children marked, so a phone stacks them header, main, sidebar, however deep each template nests its columns.
 */
function splitParts(element: HostElement): Map<HostNode, Part> | undefined {
	const parts = new Map<HostNode, Part>();
	for (const child of element.children) {
		if ("text" in child) continue;
		const regions = regionsIn(child);
		if (regions.has("main")) parts.set(child, "main");
		else if (regions.has("sidebar")) parts.set(child, regions.has("header") ? "header-sidebar" : "sidebar");
	}
	const values = [...parts.values()];
	return values.includes("main") && values.some((part) => part !== "main") ? parts : undefined;
}

function convertSplitChildren(children: HostNode[], parts: Map<HostNode, Part> | undefined, context: Context) {
	return children
		.map((child) => {
			const html = convertNode(child, context);
			const part = parts?.get(child);
			// The part rides on the child's opening tag.
			return part ? html.replace(/^<([a-z0-9]+)/, `<$1 data-part="${part}"`) : html;
		})
		.join("");
}

function styleOf(element: HostElement, context: Context) {
	const flat = flattenStyle(element.props.style as StyleProp);
	return { ...toCssDeclarations(flat, context), flat: flat as Record<string, unknown> };
}

function convertNode(node: HostNode, parent: Context): string {
	if ("text" in node) return escapeHtml(node.text).replaceAll("\n", "<br>");
	const { props } = node;

	switch (node.type) {
		case HOST.view: {
			const { declarations, fontSize, hidden, flat } = styleOf(node, parent);
			if (hidden) return "";
			const context = { ...parent, fontSize };
			const region = regionOf(node);
			const split = splitParts(node);
			const semantic = semanticTag(node, false);
			const tag = semantic?.tag ?? "div";
			// A row in the header that holds the picture or a section (picture beside the name and summary), or a section
			// laid out as a row (a label gutter beside the entries), is too narrow on a phone: it stacks there instead.
			// Small rows, such as an icon beside a contact detail, stay rows.
			const direction = flat.flexDirection;
			const isRow = direction === "row" || direction === "row-reverse";
			const inHeader = region === "header" || parent.inHeader === true;
			const fold = isRow && !split && (tag === "section" || (inHeader && holdsBlocks(node)));
			const extra = [
				semantic?.attributes ?? "",
				region ? ` data-region="${region}"` : "",
				split ? " data-split" : "",
				fold ? " data-fold" : "",
				props.fixed === true ? " data-fixed" : "",
			].join("");
			const inner = { ...context, inHeader };
			return `<${tag}${attributes(["v", className(declarations, context)], extra)}>${convertSplitChildren(node.children, split, inner)}</${tag}>`;
		}
		case HOST.text:
		case HOST.link: {
			const { declarations, fontSize, hidden } = styleOf(node, parent);
			if (hidden) return "";
			const context = { ...parent, fontSize };
			const href =
				node.type === HOST.link && typeof props.src === "string" ? (toSafeLink(props.src) ?? undefined) : undefined;
			const external = href && /^https?:/i.test(href) ? ' rel="noopener ugc" target="_blank"' : "";
			const link = href ? ` href="${escapeHtml(href)}"${external}` : "";
			const own = className(declarations, context);

			if (parent.inText) {
				const tag = href ? "a" : "span";
				return `<${tag}${attributes([own], link)}>${node.children.map((child) => convertNode(child, context)).join("")}</${tag}>`;
			}
			if (node.children.every(isEmptyText)) return `<div${attributes(["t", own])}></div>`;

			// Text around views (a whole entry in a link) becomes a box: inline runs between the views share a line box.
			const hasBlockChild = node.children.some((child) => !isText(child));
			if (hasBlockChild) {
				const parts: string[] = [];
				let inline: HostNode[] = [];
				const flush = () => {
					const runs = withoutTrailingBreaks(inline);
					if (runs.length > 0)
						parts.push(
							`<div class="t">${runs.map((child) => convertNode(child, { ...context, inText: true })).join("")}</div>`,
						);
					inline = [];
				};
				for (const child of node.children) {
					if (isText(child)) inline.push(child);
					else {
						flush();
						parts.push(convertNode(child, context));
					}
				}
				flush();
				const tag = href ? "a" : "div";
				return `<${tag}${attributes(["v", own], link)}>${parts.join("")}</${tag}>`;
			}

			const semantic = semanticTag(node, true);
			const tag = href ? "a" : (semantic?.tag ?? "div");
			const inner = withoutTrailingBreaks(node.children)
				.map((child) => convertNode(child, { ...context, inText: true }))
				.join("");
			return `<${tag}${attributes(["t", own], link || (semantic?.attributes ?? ""))}>${inner}</${tag}>`;
		}
		case HOST.image: {
			const source = typeof props.src === "string" ? props.src.trim() : "";
			const url = source ? parent.imageUrl(source) : undefined;
			if (!url) return "";
			const { declarations, hidden } = styleOf(node, parent);
			if (hidden) return "";
			return `<img${attributes(["i", className(declarations, parent)], ` src="${escapeHtml(url)}" alt="" loading="lazy" decoding="async"`)}>`;
		}
		case HOST.svg: {
			const { declarations, hidden } = styleOf(node, parent);
			if (hidden) return "";
			const size = (value: unknown, fallback: number) => {
				const points = toPoints(value, parent);
				return typeof points === "number" ? points : fallback;
			};
			const width = size(props.width, 12);
			const height = size(props.height, width);
			const opacity: [string, string][] =
				typeof props.opacity === "number" && Number.isFinite(props.opacity) ? [["opacity", String(props.opacity)]] : [];
			const viewBox = typeof props.viewBox === "string" ? ` viewBox="${escapeHtml(props.viewBox)}"` : "";
			const own = className(
				[...declarations, ["width", length(width)], ["height", length(height)], ...opacity],
				parent,
			);
			// The drawing is one of the app's own icons (`forme/icons.tsx`), never resume content.
			return `<svg${attributes(["s", own], `${viewBox} aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg"`)}>${String(props.content ?? "")}</svg>`;
		}
		default:
			return "";
	}
}

/** The colour of a page's sidebar band, drawn behind the sidebar when it folds under the main column on phones. */
function bandColor(page: HostElement): string | undefined {
	for (const child of page.children) {
		if ("text" in child || child.type !== HOST.view || child.props.fixed !== true) continue;
		const style = flattenStyle(child.props.style as StyleProp) as Record<string, unknown>;
		if (style.position !== "absolute" || typeof style.width !== "string" || !style.width.endsWith("%")) continue;
		const color = cssColor(style.backgroundColor);
		if (color) return color;
	}
	return undefined;
}

/**
 * The base rules every web page uses: Yoga's box model, the sheet, and how the layout folds on narrow screens. A folded
 * part never grows but may still shrink: a header that sits in a row (Pikachu's) narrows to the phone, so its contact
 * line wraps instead of running off the screen.
 */
const BASE_CSS = `
.rr,.rr *{box-sizing:border-box;margin:0;padding:0;border:0 solid}
.rr .v{display:flex;flex-direction:column;position:relative;min-width:0;align-content:flex-start}
.rr .t{display:block;min-width:0;overflow-wrap:break-word}
.rr a{color:inherit;text-decoration:none}
.rr h1,.rr h2{font:inherit}
.rr .s,.rr .i{flex-shrink:0;display:block}
.rr .rr-page{position:relative;width:100%;margin:0 auto;background:#fff;overflow:hidden}
@media (max-width:640px){
.rr .rr-page{min-height:0!important;padding:24px 20px!important}
.rr [data-split]{flex-direction:column!important;row-gap:20px!important}
.rr [data-split]>*,.rr [data-region]{width:auto!important;max-width:none!important;flex:0 1 auto!important}
.rr [data-part=main]{order:1}
.rr [data-part=sidebar]{order:2}
.rr [data-part=header-sidebar]{display:contents!important}
.rr [data-part=header-sidebar]>*{order:2}
.rr [data-part=header-sidebar]>[data-region=header]{order:0}
.rr [data-region=sidebar]{background-color:var(--rr-band,transparent)}
.rr [data-fold]{flex-direction:column!important;align-items:flex-start!important;row-gap:8px}
.rr [data-fold]>*{width:auto!important;max-width:100%!important;flex:none!important}
.rr [data-fixed]{display:none!important}
}
`;

/** Converts a host tree rendered from a `ResumeDocument` to the web page's markup. */
export function toHtml(tree: HostNode[], options: ToHtmlOptions = {}): HtmlOutput {
	const root = tree.find((node): node is HostElement => !("text" in node) && node.type === HOST.document);
	if (!root) throw new Error("The resume didn't render a <Document>.");

	const context: Context = {
		fontSize: 12,
		pageWidth: DEFAULT_PAGE.width,
		pageHeight: DEFAULT_PAGE.height,
		inText: false,
		imageUrl: options.imageUrl ?? ((source) => (/^(https?:|data:image\/)/i.test(source) ? source : undefined)),
		classes: new Map(),
	};

	const pages = root.children
		.filter((child): child is HostElement => !("text" in child) && child.type === HOST.page)
		.map((page) => {
			// `toWebLayout` asks for A4 or Letter; a free-form page would take A4's height as its minimum.
			const dimensions = pageDimensions(page.props.size as PageSize | undefined, DEFAULT_PAGE.height);
			const pageContext = { ...context, pageWidth: dimensions.width, pageHeight: dimensions.height };
			const { declarations, fontSize } = styleOf(page, pageContext);
			const band = bandColor(page);
			const sheet = className(
				[
					...declarations.filter(([property]) => property !== "width" && property !== "height"),
					["max-width", length(dimensions.width)],
					["min-height", length(dimensions.height)],
					...(band ? ([["--rr-band", band]] as [string, string][]) : []),
				],
				pageContext,
			);
			const split = splitParts(page);
			const children = convertSplitChildren(page.children, split, { ...pageContext, fontSize });
			return `<div${attributes(["rr-page", "v", sheet], split ? " data-split" : "")}>${children}</div>`;
		});

	const rules = [...context.classes].map(([body, name]) => `.rr .${name}{${body}}`).join("\n");
	return { html: pages.join(""), css: `${BASE_CSS}${rules}\n` };
}
