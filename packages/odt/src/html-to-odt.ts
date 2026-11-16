import type { InlineStyle, OdtBlock, OdtInline, OdtListItem } from "./types";
import type { HTMLElement, Node } from "node-html-parser";
import { parse, NodeType } from "node-html-parser";
import { isDarkColor, parseColorString } from "@reactive-resume/utils/color";
import { toSafeLink } from "@reactive-resume/utils/link";
import { paragraph, text } from "./types";

/** Parses a CSS colour to lowercase `rrggbb`, or null when it cannot be read. */
export function toHex(value: string): string | null {
	const parsed = parseColorString(value);
	if (!parsed) return null;
	return [parsed.r, parsed.g, parsed.b].map((channel) => channel.toString(16).padStart(2, "0")).join("");
}

/** Reads one CSS declaration from an element's inline style or presentational attribute. */
function styleProperty(element: HTMLElement | undefined, property: string): string | undefined {
	return element
		?.getAttribute("style")
		?.split(";")
		.reverse()
		.map((declaration) => {
			const colon = declaration.indexOf(":");
			return [declaration.slice(0, colon).trim().toLowerCase(), declaration.slice(colon + 1).trim()] as const;
		})
		.find(([name]) => name === property)?.[1];
}

/** Layers a tag's semantics (bold, italic, ...) onto the inherited inline style. */
function mergeStyle(parent: InlineStyle, tag: string, element?: HTMLElement): InlineStyle {
	const next: InlineStyle = { ...parent };

	switch (tag) {
		case "STRONG":
		case "B":
			next.bold = true;
			break;
		case "EM":
		case "I":
			next.italic = true;
			break;
		case "U":
			next.underline = true;
			break;
		case "S":
		case "STRIKE":
		case "DEL":
			next.strike = true;
			break;
		case "CODE":
			next.code = true;
			next.highlight = "eeeeee";
			break;
	}

	const colorValue = styleProperty(element, "color");
	const color = colorValue ? toHex(colorValue) : null;
	if (color) next.color = color;

	const backgroundValue =
		(tag === "MARK" ? element?.getAttribute("data-color") : undefined) ?? styleProperty(element, "background-color");
	const background = backgroundValue ? toHex(backgroundValue) : null;

	if (tag === "MARK") {
		next.highlight = background ?? "ffff00";
		if (background && backgroundValue && isDarkColor(backgroundValue) && !next.color) next.color = "ffffff";
	} else if (background) {
		next.highlight = background;
	}

	return next;
}

/** Walks a rich-text node into ODT inline runs, tracking nested formatting. */
function collectInline(node: Node, style: InlineStyle): OdtInline[] {
	const children: OdtInline[] = [];

	for (const child of node.childNodes) {
		if (child.nodeType === NodeType.TEXT_NODE) {
			const value = child.textContent ?? "";
			if (!value) continue;
			value.split("\t").forEach((part, index) => {
				if (index > 0) children.push({ type: "tab" });
				if (part) children.push({ type: "text", text: part, style });
			});
			continue;
		}

		if (child.nodeType !== NodeType.ELEMENT_NODE) continue;

		const element = child as HTMLElement;
		const tag = element.tagName;

		if (tag === "BR") {
			children.push({ type: "break" });
			continue;
		}

		if (tag === "A") {
			const href = toSafeLink(element.getAttribute("href") ?? "");
			const linkChildren = collectInline(element, style);
			if (href && linkChildren.length > 0) children.push({ type: "link", href, children: linkChildren });
			else children.push(...linkChildren);
			continue;
		}

		children.push(...collectInline(element, mergeStyle(style, tag, element)));
	}

	return children;
}

const BLOCK_TAGS = /^(UL|OL|LI|P|DIV|BLOCKQUOTE|PRE|HR|H[1-6])$/;

/** Flattens a list item's children into blocks, allowing nested lists. */
function convertListItem(item: HTMLElement): OdtBlock[] {
	const blocks: OdtBlock[] = [];
	const hasNestedBlocks = item.children.some((child) => BLOCK_TAGS.test(child.tagName));

	if (!hasNestedBlocks) {
		const children = collectInline(item, {});
		if (children.length > 0) blocks.push(paragraph(children));
		return blocks;
	}

	let pending: OdtInline[] = [];
	const flush = () => {
		if (pending.length > 0) blocks.push(paragraph(pending));
		pending = [];
	};

	for (const child of item.childNodes) {
		if (child.nodeType === NodeType.TEXT_NODE) {
			const value = (child.textContent ?? "").trim();
			if (value) pending.push(text(value));
			continue;
		}

		if (child.nodeType !== NodeType.ELEMENT_NODE) continue;

		const element = child as HTMLElement;
		if (BLOCK_TAGS.test(element.tagName)) {
			flush();
			processBlock(element, blocks);
		} else {
			pending.push(...collectInline(element, {}));
		}
	}

	flush();
	return blocks;
}

/** Converts a `<ul>`/`<ol>` into a bulleted or ordered list block. */
function convertList(list: HTMLElement, ordered: boolean): OdtBlock {
	const items: OdtListItem[] = [];
	for (const child of list.children) {
		if (child.tagName !== "LI") continue;
		items.push({ blocks: convertListItem(child) });
	}
	return { type: "list", ordered, items };
}

/** Converts one block-level HTML element into ODT blocks and appends them. */
function processBlock(element: HTMLElement, blocks: OdtBlock[]): void {
	const tag = element.tagName;

	if (/^H[1-6]$/.test(tag)) {
		const children = collectInline(element, {});
		if (children.length > 0) blocks.push({ type: "heading", level: Number(tag[1]), children });
		return;
	}

	if (tag === "UL" || tag === "OL") {
		blocks.push(convertList(element, tag === "OL"));
		return;
	}

	if (tag === "BLOCKQUOTE") {
		const inner: OdtBlock[] = [];
		for (const child of element.childNodes) {
			if (child.nodeType === NodeType.TEXT_NODE) {
				const value = (child.textContent ?? "").trim();
				if (value) inner.push(paragraph([text(value)]));
			} else if (child.nodeType === NodeType.ELEMENT_NODE) {
				processBlock(child as HTMLElement, inner);
			}
		}
		for (const block of inner) if (block.type === "paragraph") block.style = "Quote";
		blocks.push(...inner);
		return;
	}

	if (tag === "PRE") {
		// ODF reads a newline in a paragraph as a space, so keep the code's lines as line breaks.
		const lines = (element.textContent ?? "").split("\n");
		const children = lines.flatMap((line, index): OdtInline[] => [
			...(index > 0 ? [{ type: "break" } as const] : []),
			...(line ? [text(line)] : []),
		]);
		if (children.some((child) => child.type === "text")) blocks.push(paragraph(children, "CodeBlock"));
		return;
	}

	if (tag === "HR") {
		blocks.push({ type: "rule" });
		return;
	}

	// Paragraphs, and any other element carrying inline content. TipTap stores indentation as `data-indent`.
	const children = collectInline(element, {});
	if (children.length === 0) return;
	const indent = Number(element.getAttribute("data-indent"));
	blocks.push(
		paragraph(children, undefined, Number.isInteger(indent) && indent > 0 && indent <= 8 ? indent : undefined),
	);
}

/** Converts the constrained TipTap rich-text HTML stored on resume fields into ODT blocks. */
export function htmlToOdtBlocks(html: string): OdtBlock[] {
	if (!html.trim()) return [];

	const root = parse(html);
	// Script and style text is code, not content: drop it before the walk below can print it.
	for (const element of root.querySelectorAll("script, style")) element.remove();

	const blocks: OdtBlock[] = [];
	for (const child of root.childNodes) {
		if (child.nodeType === NodeType.TEXT_NODE) {
			const value = (child.textContent ?? "").trim();
			if (value) blocks.push(paragraph([text(value)]));
			continue;
		}

		if (child.nodeType === NodeType.ELEMENT_NODE) processBlock(child as HTMLElement, blocks);
	}

	return blocks;
}
