import type { Level } from "@tiptap/extension-heading";
import type { Node as ProseMirrorNode, TagParseRule } from "@tiptap/pm/model";
import { Heading } from "@tiptap/extension-heading";
import { Paragraph } from "@tiptap/extension-paragraph";
import { DOMSerializer, DOMParser as ProseMirrorDOMParser } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import { ReplaceAroundStep, ReplaceStep } from "@tiptap/pm/transform";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { combineTransactionSteps, Extension, getChangedRanges } from "@tiptap/react";
import { hasUnsupportedTableMarkup, whitespaceAttribute, whitespacePreserveValue } from "./rich-text-markup";

const preservedWhitespace = {
	default: null,
	parseHTML: (element: HTMLElement) =>
		element.getAttribute(whitespaceAttribute) === whitespacePreserveValue ? whitespacePreserveValue : null,
	renderHTML: (attributes: { resumeWhitespace?: string | null }) =>
		attributes.resumeWhitespace === whitespacePreserveValue ? { [whitespaceAttribute]: whitespacePreserveValue } : {},
};

export const LiteralParagraph = Paragraph.extend({
	addAttributes() {
		return { ...this.parent?.(), resumeWhitespace: preservedWhitespace };
	},
	parseHTML() {
		return [
			{ tag: `p[${whitespaceAttribute}="${whitespacePreserveValue}"]`, preserveWhitespace: "full" },
			{ tag: "p" },
		] as TagParseRule[];
	},
});

export const LiteralHeading = Heading.extend({
	addAttributes() {
		return { ...this.parent?.(), resumeWhitespace: preservedWhitespace };
	},
	parseHTML() {
		return this.options.levels.flatMap((level: Level) => [
			{
				tag: `h${level}[${whitespaceAttribute}="${whitespacePreserveValue}"]`,
				attrs: { level },
				preserveWhitespace: "full",
			},
			{ tag: `h${level}`, attrs: { level } },
		]) as TagParseRule[];
	},
});

const isPreservableTextBlock = (node: ProseMirrorNode) =>
	node.type.name === "paragraph" || node.type.name === "heading";

// Mark real text blocks before ProseMirror collapses their whitespace. Containers
// that its parser turns into paragraphs need the same explicit block boundary.
const markPastedHtml = (html: string) => {
	const root = new DOMParser().parseFromString(html, "text/html").body;
	const blockTags = /^(P|H[1-6]|DIV|BLOCKQUOTE|UL|OL|LI|PRE|HR|TABLE)$/;
	const normalize = (container: HTMLElement) => {
		let paragraph: HTMLParagraphElement | undefined;
		for (const child of Array.from(container.childNodes)) {
			// Clipboard envelopes and ignored metadata do not create editor blocks.
			if (
				child.nodeType === Node.COMMENT_NODE ||
				(child instanceof HTMLElement && /^(HEAD|META|LINK|NOSCRIPT|OBJECT|SCRIPT|STYLE|TITLE)$/.test(child.tagName))
			)
				continue;
			if (child instanceof HTMLElement && blockTags.test(child.tagName)) {
				paragraph = undefined;
				if (/^(DIV|BLOCKQUOTE|LI)$/.test(child.tagName)) normalize(child);
				else if (/^(UL|OL)$/.test(child.tagName)) {
					for (const item of Array.from(child.children)) if (item instanceof HTMLElement) normalize(item);
				} else if (child.tagName === "TABLE") {
					for (const cell of child.querySelectorAll("td, th")) {
						if (cell instanceof HTMLElement) normalize(cell);
					}
				}
				continue;
			}
			// Formatting whitespace between blocks is not an authored paragraph.
			if (
				!paragraph &&
				child.nodeType === Node.TEXT_NODE &&
				!/[^\t\n\f\r ]/.test(child.textContent ?? "") &&
				Array.from(container.children).some((element) => blockTags.test(element.tagName))
			)
				continue;
			if (!paragraph) {
				paragraph = document.createElement("p");
				container.insertBefore(paragraph, child);
			}
			paragraph.appendChild(child);
		}
	};
	normalize(root);
	for (const block of root.querySelectorAll("p,h1,h2,h3,h4,h5,h6")) {
		if (!block.hasAttribute(whitespaceAttribute)) block.setAttribute(whitespaceAttribute, whitespacePreserveValue);
	}
	return root.innerHTML;
};

export const LiteralWhitespaceInput = Extension.create({
	name: "literalWhitespaceInput",

	addProseMirrorPlugins() {
		let rejectHtmlPaste = false;
		return [
			new Plugin({
				props: {
					decorations(state) {
						const tabs: Decoration[] = [];
						state.doc.descendants((block, blockPosition) => {
							if (!isPreservableTextBlock(block) || block.attrs.resumeWhitespace !== whitespacePreserveValue) return;
							block.descendants((node, offset) => {
								if (!node.isText || !node.text) return;
								for (const match of node.text.matchAll(/\t/g)) {
									const from = blockPosition + 1 + offset + match.index;
									// Each inline box starts its own tab stops at zero: exactly four
									// ordinary spaces in the inherited font, regardless of preceding text.
									// Decorations leave the single stored character and editor positions intact.
									tabs.push(
										Decoration.inline(from, from + 1, {
											style: "display: inline-block; white-space: pre; tab-size: 4;",
										}),
									);
								}
							});
							return false;
						});
						return DecorationSet.create(state.doc, tabs);
					},
					transformPastedHTML: (html) => {
						// Inspect original bytes before either DOM parser can repair unsafe tables.
						rejectHtmlPaste = hasUnsupportedTableMarkup(html);
						return rejectHtmlPaste ? "" : markPastedHtml(html);
					},
					handlePaste: () => {
						const reject = rejectHtmlPaste;
						rejectHtmlPaste = false;
						return reject;
					},
					clipboardTextParser(text, $context, _plain, view) {
						rejectHtmlPaste = false;
						const wrapper = document.createElement("div");
						const serializer = DOMSerializer.fromSchema(view.state.schema);
						for (const block of text.split(/(?:\r\n?|\n)+/)) {
							const paragraph = document.createElement("p");
							paragraph.setAttribute(whitespaceAttribute, whitespacePreserveValue);
							if (block)
								paragraph.appendChild(serializer.serializeNode(view.state.schema.text(block, $context.marks())));
							wrapper.appendChild(paragraph);
						}
						return ProseMirrorDOMParser.fromSchema(view.state.schema).parseSlice(wrapper, {
							context: $context,
							preserveWhitespace: "full",
						});
					},
				},
				appendTransaction(transactions, oldState, newState) {
					if (transactions.some((transaction) => transaction.getMeta("preventUpdate"))) return null;
					const authored = transactions.some(
						(transaction) =>
							transaction.docChanged &&
							!transaction.getMeta("appendedTransaction") &&
							!transaction.getMeta("history$") &&
							transaction.steps.some((step) => step instanceof ReplaceStep),
					);
					const structural = transactions.some(
						(transaction) =>
							!transaction.getMeta("appendedTransaction") &&
							!transaction.getMeta("history$") &&
							transaction.steps.some((step) => step instanceof ReplaceAroundStep),
					);
					if (!authored && !structural) return null;
					const transform = combineTransactionSteps(oldState.doc, [...transactions]);
					const preservedPositions: number[] = [];
					oldState.doc.descendants((node, position) => {
						if (isPreservableTextBlock(node) && node.attrs.resumeWhitespace === whitespacePreserveValue)
							preservedPositions.push(transform.mapping.map(position + 1));
					});

					const changedRanges = getChangedRanges(transform).map(({ newRange }) => newRange);
					if (changedRanges.length === 0) return null;

					const transaction = newState.tr;
					newState.doc.descendants((node, position) => {
						if (!isPreservableTextBlock(node) || node.attrs.resumeWhitespace === whitespacePreserveValue) return;
						const nodeEnd = position + node.nodeSize;
						if (!authored && !preservedPositions.some((mapped) => mapped > position && mapped < nodeEnd)) return;
						if (!changedRanges.some(({ from, to }) => from < nodeEnd && to > position)) return;
						transaction.setNodeMarkup(position, undefined, {
							...node.attrs,
							resumeWhitespace: whitespacePreserveValue,
						});
					});

					return transaction.steps.length > 0 ? transaction : null;
				},
			}),
		];
	},
});
