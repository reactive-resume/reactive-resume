import { assertRichTextComplexity } from "@reactive-resume/schema/resume/limits";
// The rich text rules that need no editor: shared by the Tiptap extensions and the read-only preview shown while
// the editor loads (features/resume/editor/write/rich-text-editor.tsx).
import { isDarkColor } from "@reactive-resume/utils/color";
import { escapeHtml, stripHtml } from "@reactive-resume/utils/string";

export const MAX_TABLE_COLUMNS = 100;
export const MAX_TABLE_ROWS = 1_000;
const MAX_TABLE_CELLS = 20_000;

export const whitespaceAttribute = "data-resume-whitespace";
export const whitespacePreserveValue = "preserve";

const borderStyleProperties = [
	"border",
	"border-top",
	"border-right",
	"border-bottom",
	"border-left",
	"border-width",
	"border-style",
	"border-color",
	"border-top-width",
	"border-top-style",
	"border-top-color",
	"border-right-width",
	"border-right-style",
	"border-right-color",
	"border-bottom-width",
	"border-bottom-style",
	"border-bottom-color",
	"border-left-width",
	"border-left-style",
	"border-left-color",
] as const;

const textBlockTags = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6"]);
const inlineTags = new Set(["br", "strong", "b", "em", "i", "u", "s", "strike", "code", "a", "span", "mark"]);
const cellBlockTags = new Set([...textBlockTags, "blockquote", "ul", "ol", "hr"]);

export type ValueValidator = (value: string, element: Element) => boolean;

type ElementRule = {
	attributes?: ReadonlyMap<string, ValueValidator>;
	styles?: ReadonlyMap<string, ValueValidator>;
	validate?: (element: Element) => boolean;
};

type StyleDeclaration = {
	property: string;
	value: string;
};

const cssWideKeywords = new Set(["inherit", "initial", "revert", "revert-layer", "unset"]);
const textAlignments = new Set(["left", "center", "right", "justify"]);
const cellAlignments = new Set(["left", "center", "right"]);
const linkProtocols = new Set(["http", "https", "ftp", "ftps", "mailto", "tel", "callto", "sms", "cid", "xmpp"]);

const readStyleDeclarations = (element: Element): StyleDeclaration[] | null => {
	const style = element.getAttribute("style");
	if (style === null) return [];
	const declarations = style
		.split(";")
		.map((declaration) => declaration.trim())
		.filter(Boolean);
	if (declarations.length === 0) return null;
	const parsed = declarations.map((declaration) => {
		const separator = declaration.indexOf(":");
		if (separator <= 0) return null;
		const property = declaration.slice(0, separator).trim().toLowerCase();
		const value = declaration.slice(separator + 1).trim();
		return property && value ? { property, value } : null;
	});
	return parsed.every((declaration) => declaration !== null) ? parsed : null;
};

/** The element's style reduced to the declarations `styles` accepts, or null when none are left. */
export const keptStyle = (element: Element, styles: ReadonlyMap<string, ValueValidator> | undefined) => {
	const declarations = (readStyleDeclarations(element) ?? []).filter(({ property, value }) =>
		styles?.get(property)?.(value, element),
	);
	return declarations.length ? declarations.map(({ property, value }) => `${property}: ${value}`).join("; ") : null;
};

const supportsCssValue =
	(property: string): ValueValidator =>
	(value, element) => {
		if (/!important\s*$/i.test(value)) return false;
		const probe = element.ownerDocument.createElement("span").style;
		probe.setProperty(property, value);
		return probe.getPropertyValue(property) !== "";
	};

const supportsColor: ValueValidator = (value, element) => supportsCssValue("color")(value, element);
const supportsTextAlign =
	(allowed: ReadonlySet<string>): ValueValidator =>
	(value) =>
		allowed.has(value);
const supportsCanonicalInteger =
	(minimum: number, maximum = Number.MAX_SAFE_INTEGER): ValueValidator =>
	(value) => {
		if (!/^-?\d+$/.test(value)) return false;
		const parsed = Number(value);
		return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum && String(parsed) === value;
	};
const supportsBorderSpacing: ValueValidator = (value, element) => {
	if (cssWideKeywords.has(value)) return true;
	const parts = value.split(/\s+/);
	return parts.length <= 2 && parts.every((part) => supportsCssValue("width")(part, element));
};
const supportsVerticalAlign: ValueValidator = (value, element) => {
	const keywords = new Set(["baseline", "sub", "super", "text-top", "text-bottom", "middle", "top", "bottom"]);
	return cssWideKeywords.has(value) || keywords.has(value) || supportsCssValue("width")(value, element);
};
const supportsLinkHref: ValueValidator = (value) => {
	if (
		!value ||
		value.trim() !== value ||
		/[\s\u200B-\u200D\u2060\uFEFF]/u.test(value) ||
		Array.from(value).some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)
	)
		return false;
	const scheme = value.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
	return !scheme || linkProtocols.has(scheme);
};

const cssRules = (properties: readonly string[]) =>
	new Map<string, ValueValidator>(properties.map((property) => [property, supportsCssValue(property)]));

const styleValues = (element: Element, property: string) =>
	(readStyleDeclarations(element) ?? [])
		.filter((declaration) => declaration.property === property)
		.map(({ value }) => value);

const normalizedColor = (value: string, element: Element) => {
	const probe = element.ownerDocument.createElement("span").style;
	probe.color = value;
	return probe.color;
};

const validateCell = (element: Element) => {
	const colspan = element.getAttribute("colspan");
	const colwidth = element.getAttribute("colwidth");
	if (colwidth) {
		const widths = colwidth.split(",");
		const span = colspan ? Number(colspan) : 1;
		if (widths.length !== span || !widths.every((width) => supportsCanonicalInteger(1)(width, element))) return false;
	}
	const align = element.getAttribute("align")?.trim().toLowerCase();
	const styleAligns = styleValues(element, "text-align");
	return styleAligns.length <= 1 && (!align || styleAligns.length === 0 || align === styleAligns[0]);
};

const validateTextBlock = (element: Element) => {
	const indent = element.getAttribute("data-indent");
	const margins = styleValues(element, "margin-inline-start");
	const alignments = styleValues(element, "text-align");
	if (margins.length > 1 || alignments.length > 1) return false;
	if (!indent) return margins.length === 0;
	if (element.closest("li") || !supportsCanonicalInteger(1, 8)(indent, element)) return false;
	return margins.length === 0 || margins[0] === `${Number(indent) * 24}px`;
};

const validateMark = (element: Element) => {
	const dataColor = element.getAttribute("data-color");
	const backgrounds = styleValues(element, "background-color");
	const colors = styleValues(element, "color");
	if (backgrounds.length > 1 || colors.length > 2) return false;
	const semanticColor = dataColor ?? backgrounds[0];
	if (!semanticColor) return colors.length === 0;
	if (dataColor && backgrounds[0] && normalizedColor(dataColor, element) !== normalizedColor(backgrounds[0], element))
		return false;
	if (colors.length === 0) return true;
	return isDarkColor(semanticColor)
		? colors.length === 2 && colors[0] === "inherit" && normalizedColor(colors[1] ?? "", element) === "#ffffff"
		: colors.length === 1 && colors[0] === "inherit";
};

export const tableStyles = new Map([
	...cssRules(["width", "min-width", "max-width", "border-collapse", ...borderStyleProperties]),
	["border-spacing", supportsBorderSpacing],
]);
export const rowStyles = cssRules(["height", ...borderStyleProperties]);
export const cellStyles = new Map([
	...cssRules([
		"width",
		"min-width",
		"max-width",
		"height",
		"padding",
		"padding-top",
		"padding-right",
		"padding-bottom",
		"padding-left",
		...borderStyleProperties,
	]),
	["vertical-align", supportsVerticalAlign],
	["text-align", supportsTextAlign(cellAlignments)],
	["background-color", supportsColor],
]);
const textBlockStyles = new Map([
	["text-align", supportsTextAlign(textAlignments)],
	["margin-inline-start", supportsCssValue("margin-inline-start")],
]);
const listItemStyles = new Map([["text-align", supportsTextAlign(textAlignments)]]);
const textStyles = new Map([["color", supportsColor]]);
const highlightStyles = new Map([
	["background-color", supportsColor],
	["color", supportsColor],
]);
const cellAttributes = new Map<string, ValueValidator>([
	["colspan", supportsCanonicalInteger(1, MAX_TABLE_COLUMNS)],
	["rowspan", supportsCanonicalInteger(1, MAX_TABLE_ROWS)],
	["colwidth", (value, element) => value.split(",").every((width) => supportsCanonicalInteger(1)(width, element))],
	["align", (value) => cellAlignments.has(value.trim().toLowerCase())],
]);
const noValues: ElementRule = {};
const textBlockRule: ElementRule = {
	attributes: new Map([
		["data-indent", supportsCanonicalInteger(1, 8)],
		[whitespaceAttribute, (value) => value === whitespacePreserveValue],
	]),
	styles: textBlockStyles,
	validate: validateTextBlock,
};
const elementRules = new Map<string, ElementRule>([
	["table", { styles: tableStyles }],
	["tbody", noValues],
	["tr", { styles: rowStyles }],
	["td", { attributes: cellAttributes, styles: cellStyles, validate: validateCell }],
	["th", { attributes: cellAttributes, styles: cellStyles, validate: validateCell }],
	...[...textBlockTags].map((tag): [string, ElementRule] => [tag, textBlockRule]),
	["blockquote", noValues],
	["ul", noValues],
	["ol", { attributes: new Map([["start", supportsCanonicalInteger(Number.MIN_SAFE_INTEGER)]]) }],
	["li", { styles: listItemStyles, validate: (element) => styleValues(element, "text-align").length <= 1 }],
	["hr", noValues],
	["br", noValues],
	["strong", noValues],
	["b", noValues],
	["em", noValues],
	["i", noValues],
	["u", noValues],
	["s", noValues],
	["strike", noValues],
	["code", noValues],
	[
		"a",
		{
			attributes: new Map([
				["href", supportsLinkHref],
				["target", () => true],
				["rel", () => true],
				["title", () => true],
			]),
			validate: (element) => element.hasAttribute("href"),
		},
	],
	["span", { styles: textStyles, validate: (element) => styleValues(element, "color").length === 1 }],
	["mark", { attributes: new Map([["data-color", supportsColor]]), styles: highlightStyles, validate: validateMark }],
]);

const hasOnlySupportedValues = (element: Element) => {
	const rule = elementRules.get(element.tagName.toLowerCase());
	if (!rule) return false;
	for (const attribute of element.attributes) {
		const name = attribute.name.toLowerCase();
		if (name === "style" && rule.styles) continue;
		const validate = rule.attributes?.get(name);
		if (!validate?.(attribute.value, element)) return false;
	}
	const declarations = readStyleDeclarations(element);
	if (!declarations) return false;
	if (declarations.length > 0 && !rule.styles) return false;
	for (const { property, value } of declarations) {
		if (!rule.styles?.get(property)?.(value, element)) return false;
	}
	return rule.validate?.(element) ?? true;
};

const hasUnsupportedChildNode = (node: Node) =>
	node.nodeType === Node.TEXT_NODE ? Boolean(node.textContent?.trim()) : node.nodeType !== Node.ELEMENT_NODE;

const hasOnlyInlineContent = (element: Element): boolean =>
	Array.from(element.childNodes).every((child) => {
		if (child.nodeType === Node.TEXT_NODE) return true;
		if (!(child instanceof Element) || !inlineTags.has(child.tagName.toLowerCase())) return false;
		return hasOnlyInlineContent(child);
	});

const hasOnlyCellBlockContent = (element: Element): boolean =>
	Array.from(element.childNodes).every((child) => {
		if (child.nodeType === Node.TEXT_NODE) return true;
		if (!(child instanceof Element)) return false;
		const tagName = child.tagName.toLowerCase();
		if (inlineTags.has(tagName)) return hasOnlyInlineContent(child);
		if (!cellBlockTags.has(tagName)) return false;
		if (textBlockTags.has(tagName)) return hasOnlyInlineContent(child);
		if (tagName === "hr") return child.childNodes.length === 0;
		if (tagName === "blockquote") {
			const hasContent = Array.from(child.childNodes).some(
				(blockChild) => blockChild.nodeType === Node.ELEMENT_NODE || Boolean(blockChild.textContent?.trim()),
			);
			return hasContent && hasOnlyCellBlockContent(child);
		}
		const listItems = Array.from(child.children);
		if (listItems.length === 0) return false;
		return Array.from(child.childNodes).every((listChild) => {
			if (listChild.nodeType === Node.TEXT_NODE) return !listChild.textContent?.trim();
			if (!(listChild instanceof Element) || listChild.tagName.toLowerCase() !== "li") return false;
			return hasOnlyCellBlockContent(listChild);
		});
	});

const hasRectangularTableGrid = (rows: readonly Element[]) => {
	if (rows.length > MAX_TABLE_ROWS) return false;
	let expectedWidth: number | undefined;
	const occupiedUntil: number[] = [];

	for (const [rowIndex, row] of rows.entries()) {
		const coverage = occupiedUntil.map((endRow) => endRow > rowIndex);
		let column = 0;

		for (const cell of Array.from(row.children)) {
			while (coverage[column]) column++;
			const colspan = Number(cell.getAttribute("colspan") ?? 1);
			const rowspan = Number(cell.getAttribute("rowspan") ?? 1);
			if (
				!Number.isSafeInteger(colspan) ||
				colspan < 1 ||
				column + colspan > MAX_TABLE_COLUMNS ||
				(column + colspan) * rows.length > MAX_TABLE_CELLS
			)
				return false;
			if (rowIndex + rowspan > rows.length) return false;
			for (let offset = 0; offset < colspan; offset++) {
				if (coverage[column + offset]) return false;
				coverage[column + offset] = true;
				occupiedUntil[column + offset] = rowIndex + rowspan;
			}
			column += colspan;
		}

		const rowWidth = coverage.lastIndexOf(true) + 1;
		if (rowWidth === 0 || coverage.slice(0, rowWidth).some((covered) => !covered)) return false;
		expectedWidth ??= rowWidth;
		if (rowWidth !== expectedWidth) return false;
	}

	return true;
};

const hasUnsupportedCellDescendant = (element: Element) => {
	const tagName = element.tagName.toLowerCase();
	return !inlineTags.has(tagName) && !cellBlockTags.has(tagName) && tagName !== "li"
		? true
		: !hasOnlySupportedValues(element);
};

const sourceTablesFrom = (html: string) =>
	Array.from(html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi), (match) => match[0]);

const tableMarkersFrom = (html: string) => Array.from(html.matchAll(/<\/?table(?=\s|\/?>|$)/gi));

const openingTableMarkersFrom = (html: string) => Array.from(html.matchAll(/<table(?=\s|\/?>|$)/gi));

const parsedTablesMatchSource = (sourceTables: readonly string[], tables: readonly HTMLTableElement[]) => {
	return (
		sourceTables.length === tables.length && sourceTables.every((source, index) => source === tables[index]?.outerHTML)
	);
};

export const hasUnsupportedTableMarkup = (html: string) => {
	try {
		assertRichTextComplexity(html);
	} catch {
		return true;
	}
	const tableMarkers = tableMarkersFrom(html);
	if (tableMarkers.length === 0) return false;
	const document = new DOMParser().parseFromString(html, "text/html");
	const tables = Array.from(document.querySelectorAll("table"));
	const sourceTables = sourceTablesFrom(html);
	const openingTableMarkers = openingTableMarkersFrom(html);
	if (
		tables.length === 0 ||
		sourceTables.length === 0 ||
		openingTableMarkers.length !== sourceTables.length ||
		tableMarkers.length !== sourceTables.length * 2 ||
		!parsedTablesMatchSource(sourceTables, tables)
	)
		return true;

	for (const table of tables) {
		if (!hasOnlySupportedValues(table)) return true;
		const bodies = Array.from(table.children);
		if (bodies.length !== 1 || bodies[0]?.tagName.toLowerCase() !== "tbody") return true;
		if (Array.from(table.childNodes).some(hasUnsupportedChildNode)) return true;

		const body = bodies[0];
		if (!body || !hasOnlySupportedValues(body)) return true;
		if (Array.from(body.childNodes).some(hasUnsupportedChildNode)) return true;
		const rows = Array.from(body.children);
		if (rows.length === 0 || rows.some((row) => row.tagName.toLowerCase() !== "tr")) return true;

		for (const row of rows) {
			if (!hasOnlySupportedValues(row)) return true;
			if (Array.from(row.childNodes).some(hasUnsupportedChildNode)) return true;
			if (Array.from(row.children).some((cell) => !["td", "th"].includes(cell.tagName.toLowerCase()))) return true;
		}
		for (const cell of table.querySelectorAll("td, th")) {
			if (!hasOnlySupportedValues(cell)) return true;
			if (!hasOnlyCellBlockContent(cell)) return true;
			if (Array.from(cell.querySelectorAll("*"), hasUnsupportedCellDescendant).some(Boolean)) return true;
		}
		if (!hasRectangularTableGrid(rows)) return true;
	}
	return false;
};

const droppedTags = new Set(["script", "style", "template", "noscript", "iframe", "object", "embed", "svg", "math"]);

/**
 * The HTML reduced to the elements, attributes and styles the editor keeps, for showing it read-only before the
 * editor loads. Links lose their address so a click focuses the field instead of leaving the page.
 */
export const toPreviewHtml = (html: string) => {
	try {
		assertRichTextComplexity(html);
	} catch {
		return escapeHtml(stripHtml(html).slice(0, 200_000));
	}
	// An inert document: nothing in it runs or loads.
	const body = new DOMParser().parseFromString(html, "text/html").body;
	const clean = (element: Element) => {
		for (const child of Array.from(element.children)) clean(child);
		const tag = element.tagName.toLowerCase();
		const rule = elementRules.get(tag);
		if (!rule) {
			if (droppedTags.has(tag)) element.remove();
			else element.replaceWith(...element.childNodes);
			return;
		}
		const style = keptStyle(element, rule.styles);
		for (const { name, value } of Array.from(element.attributes)) {
			if (name === "href" || name === "style" || !rule.attributes?.get(name)?.(value, element))
				element.removeAttribute(name);
		}
		if (style) element.setAttribute("style", style);
		if (tag === "table" && !hasRectangularTableGrid(Array.from(element.querySelectorAll("tr"))))
			element.replaceWith(element.ownerDocument.createTextNode(element.textContent ?? ""));
	};
	for (const child of Array.from(body.children)) clean(child);
	return body.innerHTML;
};
