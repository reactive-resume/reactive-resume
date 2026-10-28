import type { SemanticNodeKind } from "@reactive-resume/resume/stylesheet";
import { semanticNodeKeys } from "./node-keys";

export type RichTextElement = {
	nodeType: number;
	rawTagName: string;
	parentNode?: unknown;
	childNodes: readonly unknown[];
	getAttribute: (name: string) => string | undefined;
};

const isElement = (node: unknown): node is RichTextElement =>
	typeof node === "object" &&
	node !== null &&
	"nodeType" in node &&
	(node as { nodeType: number }).nodeType === 1 &&
	"rawTagName" in node;

export const getRichTextSemanticKind = (
	element: RichTextElement,
	markClassName: string,
): SemanticNodeKind | undefined => {
	const tag = element.rawTagName.toLowerCase();

	if (/^h[1-6]$/.test(tag)) return "rich-heading";
	if (tag === "p") return "paragraph";
	if (tag === "blockquote") return "blockquote";
	if (tag === "ul" || tag === "ol") return "list";
	if (tag === "li") return "list-item";
	if (tag === "a") return "link";
	if (tag === "strong" || tag === "b") return "strong";
	if (tag === "em" || tag === "i") return "emphasis";
	if (tag === "u") return "underline";
	if (tag === "s" || tag === "strike") return "strike";
	if (tag === "code") return "code";
	if (tag === "br") return "hard-break";
	if (tag === "hr") return "horizontal-rule";
	if (tag === "mark") return "mark";
	if (tag === "span") {
		return element.getAttribute("class")?.split(/\s+/).includes(markClassName) ? "mark" : "text-span";
	}

	return undefined;
};

// Keys are assigned before projection reorders children. Index each immutable sibling list once.
const siblingIndexes = new WeakMap<readonly unknown[], WeakMap<RichTextElement, number>>();

function elementIndexIn(parent: RichTextElement, element: RichTextElement): number {
	let indexes = siblingIndexes.get(parent.childNodes);
	if (!indexes) {
		indexes = new WeakMap();
		let index = 0;
		for (const child of parent.childNodes) if (isElement(child)) indexes.set(child, index++);
		siblingIndexes.set(parent.childNodes, indexes);
	}
	return indexes.get(element) ?? -1;
}

export const getRichTextSemanticNodeKey = (
	rootNodeKey: string,
	element: RichTextElement,
	markClassName: string,
): string => {
	const ancestry: RichTextElement[] = [];
	let current: RichTextElement | undefined = element;

	while (current?.rawTagName) {
		ancestry.push(current);
		current = isElement(current.parentNode) ? current.parentNode : undefined;
	}

	let nodeKey = rootNodeKey;
	for (const [ancestryIndex, ancestor] of ancestry.reverse().entries()) {
		const parent = ancestor.parentNode;
		const elementIndex = isElement(parent) ? elementIndexIn(parent, ancestor) : 0;
		const kind = getRichTextSemanticKind(ancestor, markClassName);
		nodeKey = semanticNodeKeys.richTextNode(nodeKey, kind ?? `html-${ancestor.rawTagName.toLowerCase()}`, elementIndex);

		if (kind === "list-item" && ancestryIndex < ancestry.length - 1) {
			nodeKey = semanticNodeKeys.richTextNode(nodeKey, "list-item-content", 0);
		}
	}

	return nodeKey;
};
