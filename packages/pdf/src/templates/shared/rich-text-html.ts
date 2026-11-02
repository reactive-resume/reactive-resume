import type { HTMLElement, Node } from "node-html-parser";
import { NodeType, parse } from "node-html-parser";
import { assertRichTextComplexity } from "@reactive-resume/schema/resume/limits";
import { isDarkColor } from "@reactive-resume/utils/color";
import { getRichTextSemanticKind, getRichTextSemanticNodeKey } from "../../semantic/rich-text-keys";
import { textDirection } from "./bidi";

export const richTextMarkClassName = "rr-pdf-mark";
export const richTextSemanticNodeKeyAttribute = "data-resume-semantic-node-key";

const inlineTags = new Set([
	"a",
	"abbr",
	"b",
	"br",
	"button",
	"cite",
	"code",
	"dfn",
	"em",
	"i",
	"label",
	"q",
	"s",
	"span",
	"strong",
	"sub",
	"sup",
	"u",
]);

const getTagName = (node: Node) => node.rawTagName.toLowerCase();

const hasBlockDescendant = (node: Node): boolean =>
	node.childNodes.some((child) => child.nodeType === NodeType.ELEMENT_NODE && !isInlineNode(child));

const mergeClassNames = (...classNames: (string | undefined)[]): string => {
	const uniqueClassNames = new Set<string>();

	for (const className of classNames) {
		if (!className) continue;

		for (const part of className.split(/\s+/)) {
			if (part) uniqueClassNames.add(part);
		}
	}

	return [...uniqueClassNames].join(" ");
};

const normalizeMarkElements = (root: ReturnType<typeof parse>) => {
	for (const mark of root.querySelectorAll("mark")) {
		const dataColor = mark.getAttribute("data-color");

		mark.tagName = "span";
		mark.setAttribute("class", mergeClassNames(mark.getAttribute("class"), richTextMarkClassName));

		// Preserve custom highlight color as inline background-color for react-pdf-html.
		// Legacy marks without data-color fall back to the .rr-pdf-mark stylesheet (yellow).
		if (dataColor) {
			const existingStyle = mark.getAttribute("style") ?? "";
			let inlineStyle = `background-color: ${dataColor}`;
			if (isDarkColor(dataColor)) inlineStyle += "; color: #ffffff";
			mark.setAttribute("style", existingStyle ? `${existingStyle}; ${inlineStyle}` : inlineStyle);
		}
	}
};

// Match HTML document whitespace, not Unicode spaces authored as visible content. The lookbehind
// tries the trailing pattern only at the start of a run, so inner runs are scanned once.
const trimHtmlWhitespace = (text: string): string => text.replace(/^[\t\n\f\r ]+|(?<![\t\n\f\r ])[\t\n\f\r ]+$/g, "");

const isMeaningfulNode = (node: Node): boolean =>
	node.nodeType !== NodeType.TEXT_NODE || trimHtmlWhitespace(node.toString()).length > 0;

const isElement = (node: Node): node is HTMLElement => node.nodeType === NodeType.ELEMENT_NODE;

const LEADING_BOLD_BOUNDARY_WHITESPACE = /^(?:[\u0020\u00a0]|&nbsp;|&#160;|&#xA0;)+/i;
// Starts only where the previous text is not boundary whitespace, keeping a long inner run linear.
const TRAILING_BOLD_BOUNDARY_WHITESPACE =
	/(?<![\u0020\u00a0]|&nbsp;|&#160;|&#xA0;)(?:[\u0020\u00a0]|&nbsp;|&#160;|&#xA0;)+$/i;

const normalizeBoldBoundaryWhitespace = (root: ReturnType<typeof parse>) => {
	for (const bold of root.querySelectorAll("strong,b").reverse()) {
		const firstChild = bold.childNodes[0];
		if (firstChild?.nodeType === NodeType.TEXT_NODE) {
			const whitespace = firstChild.rawText.match(LEADING_BOLD_BOUNDARY_WHITESPACE)?.[0];
			if (whitespace) {
				firstChild.rawText = firstChild.rawText.slice(whitespace.length);
				bold.insertAdjacentHTML("beforebegin", whitespace);
			}
		}

		const lastChild = bold.childNodes[bold.childNodes.length - 1];
		if (lastChild?.nodeType === NodeType.TEXT_NODE) {
			const whitespace = lastChild.rawText.match(TRAILING_BOLD_BOUNDARY_WHITESPACE)?.[0];
			if (whitespace) {
				lastChild.rawText = lastChild.rawText.slice(0, -whitespace.length);
				bold.insertAdjacentHTML("afterend", whitespace);
			}
		}
	}
};

const unwrapSingleParagraphListItems = (root: ReturnType<typeof parse>) => {
	for (const listItem of root.querySelectorAll("li")) {
		const meaningfulChildren = listItem.childNodes.filter(isMeaningfulNode);
		if (meaningfulChildren.length !== 1) continue;

		const child = meaningfulChildren[0];
		if (!child || !isElement(child) || getTagName(child) !== "p") continue;
		if (child.getAttribute("data-resume-whitespace") === "preserve") continue;

		listItem.innerHTML = child.innerHTML;
	}
};

const normalizeParagraphIndentation = (root: ReturnType<typeof parse>, direction: "ltr" | "rtl") => {
	for (const element of root.querySelectorAll("p,h1,h2,h3,h4,h5,h6")) {
		if (!element.hasAttribute("data-indent")) continue;
		// react-pdf-html does not support CSS logical margins. Convert only the editor's
		// explicit indentation contract to PDF points, keeping semantic ancestry intact.
		const style = (element.getAttribute("style") ?? "").replace(/(?:^|;)\s*margin-inline-start\s*:[^;]*(?:;|$)/gi, ";");
		const level = Number(element.getAttribute("data-indent"));
		const insideList = element.closest("li") !== null;
		// A list item sets its own inset: a paragraph's indent inside one is dropped, pseudo-bullets included.
		if (insideList) element.removeAttribute("data-indent");
		const indent =
			!insideList && Number.isInteger(level) && level > 0 && level <= 8
				? `margin-${direction === "rtl" ? "right" : "left"}: ${level * 18}pt`
				: "";
		const nextStyle = [style, indent].filter(Boolean).join(";");
		if (nextStyle) element.setAttribute("style", nextStyle);
		else element.removeAttribute("style");
	}
};

const expandPreservedTabs = (root: ReturnType<typeof parse>) => {
	for (const element of root.querySelectorAll(
		'p[data-resume-whitespace="preserve"],h1[data-resume-whitespace="preserve"],h2[data-resume-whitespace="preserve"],h3[data-resume-whitespace="preserve"],h4[data-resume-whitespace="preserve"],h5[data-resume-whitespace="preserve"],h6[data-resume-whitespace="preserve"]',
	)) {
		const visit = (node: Node): void => {
			if (node.nodeType === NodeType.TEXT_NODE) node.rawText = node.rawText.replace(/\t/g, "    ");
			for (const child of node.childNodes) visit(child);
		};
		visit(element);
	}
};

const isInlineNode = (node: Node): boolean => {
	if (node.nodeType === NodeType.TEXT_NODE || node.nodeType === NodeType.COMMENT_NODE) return true;
	if (node.nodeType !== NodeType.ELEMENT_NODE) return false;

	return inlineTags.has(getTagName(node)) && !hasBlockDescendant(node);
};

// Allow optional leading whitespace + LRM/RLM marks before the bullet character.
const PSEUDO_BULLET_LEAD = /^[\s\u200e\u200f]*[-•*]\s+/;

const stripEmptyInlineWrappers = (html: string): string =>
	html.replace(/<(strong|b|em|i|u|span)\b[^>]*>\s*<\/\1>/gi, "");

// Treat a bare <br> or one wrapped in an inline tag (e.g. `<strong><br></strong>` from
// the editor) as the segment separator.
const splitByBreaks = (html: string): string[] =>
	html.split(/(?:<(?:strong|b|em|i|u|span)\b[^>]*>\s*<br\b[^>]*\/?>\s*<\/(?:strong|b|em|i|u|span)>)|<br\b[^>]*\/?>/gi);

const tryConvertPseudoBulletParagraph = (paragraphInnerHtml: string): string | null => {
	const cleaned = stripEmptyInlineWrappers(paragraphInnerHtml);
	if (!/<br\b/i.test(cleaned)) return null;

	const segments: string[] = [];
	for (const segment of splitByBreaks(cleaned)) {
		const trimmed = segment.trim();
		if (trimmed.length > 0) segments.push(trimmed);
	}

	if (segments.length < 2) return null;
	if (!segments.every((segment) => PSEUDO_BULLET_LEAD.test(segment))) return null;

	const items = segments.map((segment) => segment.replace(PSEUDO_BULLET_LEAD, ""));

	return `<ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>`;
};

export const convertPseudoBulletParagraphs = (html: string, direction: "ltr" | "rtl" = "ltr"): string =>
	html.replace(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi, (full, _attrs, inner) => {
		const paragraph = parse(full).querySelector("p");
		if (paragraph?.getAttribute("data-resume-whitespace") === "preserve") return full;
		const converted = tryConvertPseudoBulletParagraph(inner);
		if (!converted) return full;
		const level = Number(paragraph?.getAttribute("data-indent"));
		if (!Number.isInteger(level) || level <= 0 || level > 8) return converted;
		// Keep the original paragraph's offset around the entire generated list.
		return converted.replace(
			"<ul>",
			`<ul data-paragraph-indent="${level}" style="margin-${direction === "rtl" ? "right" : "left"}: ${level * 18}pt">`,
		);
	});

const decodeSoftHyphens = (node: Node): void => {
	if (node.nodeType === NodeType.TEXT_NODE) {
		node.rawText = node.rawText.replace(/&(?:shy|#0*173|#[xX]0*[aA][dD]);/g, "\u00AD");
	}
	for (const child of node.childNodes) decodeSoftHyphens(child);
};

type NormalizeRichTextHtmlOptions = {
	direction?: "ltr" | "rtl";
	softHyphens?: boolean;
};

export const normalizeRichTextHtml = (
	html: string,
	{ direction = "ltr", softHyphens = false }: NormalizeRichTextHtmlOptions = {},
): string => {
	assertRichTextComplexity(html);
	const root = parse(trimHtmlWhitespace(html), { comment: false });
	const normalized: string[] = [];
	let inlineNodes: string[] = [];

	if (softHyphens) decodeSoftHyphens(root);
	normalizeBoldBoundaryWhitespace(root);
	normalizeMarkElements(root);
	normalizeParagraphIndentation(root, direction);
	expandPreservedTabs(root);
	unwrapSingleParagraphListItems(root);

	const flushInlineNodes = () => {
		const inlineHtml = inlineNodes.join("");

		if (trimHtmlWhitespace(inlineHtml)) normalized.push(`<p>${inlineHtml}</p>`);

		inlineNodes = [];
	};

	for (const node of root.childNodes) {
		const nodeHtml = node.toString();

		if (isInlineNode(node)) {
			inlineNodes.push(nodeHtml);
			continue;
		}

		flushInlineNodes();
		normalized.push(nodeHtml);
	}

	flushInlineNodes();

	const normalizedHtml = normalized.join("");
	if (direction !== "rtl") return normalizedHtml;

	// RTL pseudo-bullets must become real list items before both the semantic
	// descriptor and renderer traverse the HTML. RLM anchors each independent
	// react-pdf-html text frame without changing element ancestry or indices.
	// A paragraph that starts with a Latin (or other left-to-right) letter reads left to right (see
	// `paragraphDirection`): an RLM there would pull its first fragment to the far side of the line.
	return convertPseudoBulletParagraphs(normalizedHtml, direction).replace(
		/<(p|li)\b([^>]*)>/gi,
		(match: string, tag: string, rest: string, offset: number, html: string) =>
			textDirection(leadingText(html, offset + match.length)) === "ltr" ? match : `<${tag}${rest}>‏`,
	);
};

/** The text that follows `from` up to its first letter, with tags skipped: enough to read its direction. */
const leadingText = (html: string, from: number) => {
	let text = "";
	for (let at = from; at < html.length && text.length < 200; at++) {
		const char = html[at];
		if (char === "<" || char === "&") {
			// A tag, or an entity such as &nbsp;, whose letters aren't the text's.
			const close = html.indexOf(char === "<" ? ">" : ";", at);
			if (close === -1 || (char === "&" && close - at > 10)) break;
			at = close;
			continue;
		}
		text += char;
		if (/\p{L}/u.test(char ?? "")) break;
	}
	return text;
};

export const parseNormalizedRichTextHtml = (html: string, options?: NormalizeRichTextHtmlOptions) =>
	parse(normalizeRichTextHtml(html, options), { comment: false });

export const projectNormalizedRichTextHtml = (
	html: string,
	rootNodeKey: string,
	renderedChildKeysFor: (nodeKey: string) => readonly string[] | undefined,
): string => {
	const root = parse(html, { comment: false });
	const elements = root.querySelectorAll("*");

	for (const element of elements) {
		if (!getRichTextSemanticKind(element, richTextMarkClassName)) continue;
		element.setAttribute(
			richTextSemanticNodeKeyAttribute,
			getRichTextSemanticNodeKey(rootNodeKey, element, richTextMarkClassName),
		);
	}

	const visit = (parent: HTMLElement, parentNodeKey: string) => {
		for (const child of parent.childNodes) {
			if (!isElement(child)) continue;
			const childNodeKey = child.getAttribute(richTextSemanticNodeKeyAttribute);
			const childContentNodeKey =
				childNodeKey && getTagName(child) === "li"
					? `${childNodeKey}/list-item-content-0`
					: (childNodeKey ?? parentNodeKey);
			visit(child, childContentNodeKey);
		}

		const keyedChildren = parent.childNodes.flatMap((child) => {
			if (!isElement(child)) return [];
			const nodeKey = child.getAttribute(richTextSemanticNodeKeyAttribute);
			return nodeKey ? [{ nodeKey, child }] : [];
		});
		if (keyedChildren.length === 0) return;
		const renderedChildKeys = renderedChildKeysFor(parentNodeKey);
		if (!renderedChildKeys) return;

		const childByNodeKey = new Map(keyedChildren.map(({ nodeKey, child }) => [nodeKey, child]));
		const projected = renderedChildKeys.flatMap((nodeKey) => {
			const child = childByNodeKey.get(nodeKey);
			return child ? [child] : [];
		});
		let projectedIndex = 0;
		const nextChildren = parent.childNodes.flatMap((child) => {
			if (!isElement(child) || !child.getAttribute(richTextSemanticNodeKeyAttribute)) return [child];
			const projectedChild = projected[projectedIndex++];
			return projectedChild ? [projectedChild] : [];
		});
		parent.set_content(nextChildren);
	};

	visit(root, rootNodeKey);
	return root.toString();
};
