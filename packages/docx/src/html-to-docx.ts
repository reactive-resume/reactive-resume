import type { IShadingAttributesProperties } from "docx";
import type { HTMLElement, Node } from "node-html-parser";
import { ExternalHyperlink, HeadingLevel, Paragraph, TextRun } from "docx";
import { parse, NodeType } from "node-html-parser";
import { isDarkColor, parseColorString } from "@reactive-resume/utils/color";
import { toSafeDocxLink } from "./link-utils";

export interface HtmlStyleConfig {
	font?: string;
	size?: number;
	color?: string;
	linkColor?: string;
}

interface InlineStyle {
	bold?: boolean;
	italics?: boolean;
	underline?: Record<string, never>;
	strike?: boolean;
	font?: string;
	size?: number;
	color?: string;
	shading?: IShadingAttributesProperties;
}

type InlineChild = TextRun | ExternalHyperlink;

const preservesWhitespace = (node: Node) => {
	let ancestor = node.parentNode;
	while (ancestor) {
		if (/^(P|H[1-6])$/.test(ancestor.tagName) && ancestor.getAttribute("data-resume-whitespace") === "preserve")
			return true;
		ancestor = ancestor.parentNode;
	}
	return false;
};

/** Module-level link color, set per htmlToParagraphs invocation. */
let currentLinkColor = "0563C1";

const HEADING_MAP: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
	H1: HeadingLevel.HEADING_1,
	H2: HeadingLevel.HEADING_2,
	H3: HeadingLevel.HEADING_3,
	H4: HeadingLevel.HEADING_4,
	H5: HeadingLevel.HEADING_5,
	H6: HeadingLevel.HEADING_6,
};

function toDocxColorValue(value: string) {
	const rgba = parseColorString(value);
	if (!rgba) return null;

	return [rgba.r, rgba.g, rgba.b].map((channel) => channel.toString(16).padStart(2, "0").toUpperCase()).join("");
}

function styleProperty(element: HTMLElement | undefined, property: string): string | undefined {
	return element
		?.getAttribute("style")
		?.split(";")
		.reverse()
		.map((declaration) => {
			const colon = declaration.indexOf(":");
			return [declaration.slice(0, colon).trim().toLowerCase(), declaration.slice(colon + 1).trim()];
		})
		.find(([name]) => name === property)?.[1];
}

function mergeStyle(parent: InlineStyle, tag: string, element?: HTMLElement): InlineStyle {
	const next = { ...parent };

	switch (tag) {
		case "STRONG":
		case "B":
			next.bold = true;
			break;
		case "EM":
		case "I":
			next.italics = true;
			break;
		case "U":
			next.underline = {};
			break;
		case "S":
		case "STRIKE":
			next.strike = true;
			break;
		case "CODE":
			next.font = "Courier New";
			break;
		case "MARK": {
			const bgColor = styleProperty(element, "background-color");
			const fill = bgColor ? toDocxColorValue(bgColor) : null;
			next.shading = { fill: fill ?? "FFFF00" };
			if (bgColor && isDarkColor(bgColor)) next.color = "FFFFFF";
			break;
		}
	}

	const colorValue = styleProperty(element, "color");
	if (colorValue) {
		const color = toDocxColorValue(colorValue);
		if (color) next.color = color;
	}

	return next;
}

function collectInlineChildren(node: Node, style: InlineStyle): InlineChild[] {
	const children: InlineChild[] = [];

	for (const child of node.childNodes) {
		if (child.nodeType === NodeType.TEXT_NODE) {
			const text = (child.textContent ?? "").replace(/\t/g, preservesWhitespace(child) ? "    " : "\t");
			if (text) {
				children.push(new TextRun({ text, ...style }));
			}
			continue;
		}

		if (child.nodeType !== NodeType.ELEMENT_NODE) continue;

		const el = child as HTMLElement;
		const tag = el.tagName;

		if (tag === "BR") {
			children.push(new TextRun({ break: 1 }));
			continue;
		}

		if (tag === "A") {
			const href = toSafeDocxLink(el.getAttribute("href") ?? "");
			const linkChildren = collectInlineChildren(el, { ...style, color: currentLinkColor, underline: {} });
			if (linkChildren.length > 0 && href) {
				children.push(new ExternalHyperlink({ link: href, children: linkChildren as TextRun[] }));
			} else {
				children.push(...linkChildren);
			}
			continue;
		}

		const merged = mergeStyle(style, tag, el);
		children.push(...collectInlineChildren(el, merged));
	}

	return children;
}

function processBlockElement(
	el: HTMLElement,
	style: InlineStyle,
	paragraphs: Paragraph[],
	listLevel?: number,
	quoteIndent = 0,
): void {
	const tag = el.tagName;
	const mergedStyle = mergeStyle(style, tag, el);
	const level = Number(el.getAttribute("data-indent"));
	// 24 CSS px = 18 pt = 360 twips. Lists retain their existing numbering indentation.
	const paragraphIndent = listLevel == null && Number.isInteger(level) && level > 0 && level <= 8 ? level * 360 : 0;
	const start = quoteIndent + paragraphIndent;
	const indent = start ? { start } : undefined;

	if (HEADING_MAP[tag]) {
		const inlineChildren = collectInlineChildren(el, mergedStyle);
		if (inlineChildren.length > 0) {
			paragraphs.push(
				new Paragraph({ heading: HEADING_MAP[tag], children: inlineChildren, ...(indent ? { indent } : {}) }),
			);
		}
		return;
	}

	if (tag === "P" || tag === "DIV") {
		const inlineChildren = collectInlineChildren(el, mergedStyle);
		if (inlineChildren.length > 0) {
			paragraphs.push(
				new Paragraph({
					children: inlineChildren,
					...(tag === "P" && indent ? { indent } : quoteIndent ? { indent: { start: quoteIndent } } : {}),
				}),
			);
		}
		return;
	}

	if (tag === "UL" || tag === "OL") {
		// ponytail: ordered-list numbering (numberingRef path) was never reachable; always uses bullet
		const level = listLevel != null ? listLevel + 1 : 0;
		const listIndent = quoteIndent ? { start: (level + 1) * 720 + quoteIndent } : undefined;

		for (const li of el.children) {
			if (li.tagName !== "LI") continue;

			const hasNestedBlocks = Array.from(li.children).some(
				(c) => c.tagName === "UL" || c.tagName === "OL" || c.tagName === "P",
			);

			if (hasNestedBlocks) {
				for (const liChild of li.childNodes) {
					if (liChild.nodeType === NodeType.TEXT_NODE) {
						const text = (liChild.textContent ?? "").trim();
						if (text) {
							paragraphs.push(
								new Paragraph({
									children: [new TextRun({ text, ...mergedStyle })],
									bullet: { level },
									...(listIndent ? { indent: listIndent } : {}),
								}),
							);
						}
					} else if (liChild.nodeType === NodeType.ELEMENT_NODE) {
						processBlockElement(liChild as HTMLElement, mergedStyle, paragraphs, level, quoteIndent);
					}
				}
			} else {
				const inlineChildren = collectInlineChildren(li, mergedStyle);
				if (inlineChildren.length > 0) {
					paragraphs.push(
						new Paragraph({
							children: inlineChildren,
							bullet: { level },
							...(listIndent ? { indent: listIndent } : {}),
						}),
					);
				}
			}
		}
		return;
	}

	if (tag === "BLOCKQUOTE") {
		const quoteStyle = { ...mergedStyle, italics: true };
		const inline = parse("<p></p>").firstChild as HTMLElement;
		const flushInline = () => {
			if (inline.childNodes.length === 0) return;
			processBlockElement(inline, quoteStyle, paragraphs, listLevel, quoteIndent + 720);
			inline.set_content([]);
		};
		// Keep each semantic paragraph's own offset and preserve adjacent inline
		// content as one paragraph. Nested quotes add their existing 720-twip inset.
		for (const child of el.childNodes) {
			if (child.nodeType === NodeType.ELEMENT_NODE) {
				const element = child as HTMLElement;
				if (HEADING_MAP[element.tagName] || /^(P|DIV|UL|OL|BLOCKQUOTE|PRE|HR)$/.test(element.tagName)) {
					flushInline();
					processBlockElement(element, quoteStyle, paragraphs, listLevel, quoteIndent + 720);
					continue;
				}
			}
			if (child.nodeType === NodeType.TEXT_NODE && !child.textContent?.trim() && inline.childNodes.length === 0)
				continue;
			inline.appendChild(child.clone());
		}
		flushInline();
		return;
	}

	if (tag === "PRE") {
		const text = el.textContent ?? "";
		if (text) {
			paragraphs.push(
				new Paragraph({
					children: [new TextRun({ text, font: "Courier New", ...mergedStyle })],
					...(quoteIndent ? { indent: { start: quoteIndent } } : {}),
				}),
			);
		}
		return;
	}

	if (tag === "HR") {
		paragraphs.push(new Paragraph({ children: [] }));
		return;
	}

	if (tag === "LI") {
		const inlineChildren = collectInlineChildren(el, mergedStyle);
		if (inlineChildren.length > 0) {
			paragraphs.push(
				new Paragraph({
					children: inlineChildren,
					bullet: { level: listLevel ?? 0 },
				}),
			);
		}
		return;
	}

	// Fallback: treat as inline container
	const inlineChildren = collectInlineChildren(el, mergedStyle);
	if (inlineChildren.length > 0) {
		paragraphs.push(new Paragraph({ children: inlineChildren }));
	}
}

/**
 * Converts an HTML string (from TipTap rich text editor) into an array of docx Paragraphs.
 * Parses HTML without browser globals, then walks the tree to produce
 * structured docx content with proper formatting (bold, italic, lists, links, etc.).
 *
 * @param html - The HTML string to convert
 * @param styleConfig - Optional base typography (font, size, color) to apply to all text runs
 */
export function htmlToParagraphs(html: string, styleConfig?: HtmlStyleConfig): Paragraph[] {
	if (!html?.trim()) return [];

	currentLinkColor = styleConfig?.linkColor ?? "0563C1";

	const baseStyle: InlineStyle = {};
	if (styleConfig?.font) baseStyle.font = styleConfig.font;
	if (styleConfig?.size) baseStyle.size = styleConfig.size;
	if (styleConfig?.color) baseStyle.color = styleConfig.color;

	const doc = parse(html);
	// Script and style text is code, not content: drop it before any walk below prints it.
	for (const element of doc.querySelectorAll("script, style")) element.remove();
	const paragraphs: Paragraph[] = [];

	for (const child of doc.childNodes) {
		if (child.nodeType === NodeType.TEXT_NODE) {
			const text = (child.textContent ?? "").trim();
			if (text) {
				paragraphs.push(new Paragraph({ children: [new TextRun({ text, ...baseStyle })] }));
			}
			continue;
		}

		if (child.nodeType === NodeType.ELEMENT_NODE) {
			processBlockElement(child as HTMLElement, baseStyle, paragraphs);
		}
	}

	return paragraphs;
}
