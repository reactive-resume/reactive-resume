import type { Style } from "../../forme/style-types";
import type { StyleInput } from "./styles";
import type { HTMLElement, Node } from "node-html-parser";
import { NodeType } from "node-html-parser";
import { parseFiniteNumber, parsePxValue, parseStyleFontSize } from "./icon-size";
import { composeStyles } from "./styles";

type RichTextProseSpacing = {
	paragraph: Style;
	listItem: Style;
};

const parseLineHeight = (
	lineHeight: Style["lineHeight"],
): { type: "multiplier" | "absolute"; value: number } | undefined => {
	const multiplier = parseFiniteNumber(lineHeight);
	if (multiplier !== undefined) return { type: "multiplier", value: multiplier };

	const absoluteLineHeight = parsePxValue(lineHeight);
	if (absoluteLineHeight !== undefined) return { type: "absolute", value: absoluteLineHeight };

	return undefined;
};

const isElementNode = (node: Node): node is HTMLElement => node.nodeType === NodeType.ELEMENT_NODE;

const isRichTextTag = (element: HTMLElement, ...tagNames: string[]): boolean => {
	const normalizedTagName = element.rawTagName?.toLowerCase();

	return normalizedTagName !== undefined && tagNames.includes(normalizedTagName);
};

const getRootElement = (element: HTMLElement): HTMLElement => {
	let root = element;

	while (root.parentNode) {
		root = root.parentNode;
	}

	return root;
};

const getTopLevelFlowElements = (root: HTMLElement): HTMLElement[] => {
	const flowElements: HTMLElement[] = [];

	for (const childNode of root.childNodes) {
		if (!isElementNode(childNode)) continue;
		const child = childNode;

		if (isRichTextTag(child, "p")) {
			flowElements.push(child);
			continue;
		}

		if (!isRichTextTag(child, "ul", "ol")) continue;

		for (const listChildNode of child.childNodes) {
			if (isElementNode(listChildNode) && isRichTextTag(listChildNode, "li")) {
				flowElements.push(listChildNode);
			}
		}
	}

	return flowElements;
};

export const createRichTextProseSpacing = (bodyLineHeight: number | undefined): RichTextProseSpacing => {
	if (bodyLineHeight === undefined) return { paragraph: {}, listItem: {} };

	const sideMargin = bodyLineHeight * 0.2;

	return {
		paragraph: {
			marginTop: sideMargin,
			marginBottom: sideMargin,
		},
		listItem: {
			marginTop: sideMargin,
			marginBottom: sideMargin,
		},
	};
};

export const resolveRichTextBodyLineHeight = (...styles: StyleInput[]): number | undefined => {
	let bodyFontSize: number | undefined;
	let bodyLineHeight: ReturnType<typeof parseLineHeight>;

	for (const style of composeStyles(...styles)) {
		const fontSize = parseStyleFontSize(style.fontSize);
		if (fontSize !== undefined) bodyFontSize = fontSize;

		const lineHeight = parseLineHeight(style.lineHeight);
		if (lineHeight !== undefined) bodyLineHeight = lineHeight;
	}

	if (bodyFontSize === undefined || bodyLineHeight === undefined) return undefined;

	return bodyLineHeight.type === "multiplier" ? bodyFontSize * bodyLineHeight.value : bodyLineHeight.value;
};

export const getRichTextEdgeTrimStyle = (element: HTMLElement): Style => {
	const flowElements = getTopLevelFlowElements(getRootElement(element));
	const flowIndex = flowElements.indexOf(element);

	if (flowIndex === -1) return {};

	return {
		...(flowIndex === 0 ? { marginTop: 0 } : {}),
		...(flowIndex === flowElements.length - 1 ? { marginBottom: 0 } : {}),
	};
};

export const isRichTextElementInsideListItem = (element: HTMLElement): boolean => {
	let current = element.parentNode;

	while (current) {
		if (isRichTextTag(current, "li")) return true;
		current = current.parentNode;
	}

	return false;
};

export const isRichTextElementInsideOrderedList = (element: HTMLElement): boolean => {
	let current = element.parentNode;

	while (current) {
		if (isRichTextTag(current, "ol")) return true;
		if (isRichTextTag(current, "ul")) return false;
		current = current.parentNode;
	}

	return false;
};

export const stripRichTextVerticalMargins = (style: Style): Style => {
	const {
		margin: _margin,
		marginTop: _marginTop,
		marginBottom: _marginBottom,
		marginVertical: _marginVertical,
		...rest
	} = style;

	return rest;
};
