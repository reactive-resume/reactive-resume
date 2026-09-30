import type { HostNode } from "./reconciler";
import type { ReactElement } from "react";
import * as forme from "@formepdf/core";
import { loadIcons } from "./icons";
import { HOST } from "./primitives";
import { renderHostTree } from "./reconciler";
import { renderResumeElement } from "./render";

/**
 * Test helpers with the react-pdf calls the tests were written against: `renderToBuffer(element)` for bytes and
 * `pdf(element).container.document` for the tree the templates drew, in react-pdf's node shape.
 */

/** @lintignore Tests reach these through the module namespace. */
export { Document, Image, Link, Page, Svg, Text, View } from "./primitives";

// Icons draw nothing until their paths are loaded; `renderResume` waits for them, and so do the tests.
await loadIcons();

export type RenderedNode =
	| { type: "TEXT_INSTANCE"; value: string }
	| { type: string; props: Record<string, unknown>; style: unknown; children: RenderedNode[] };

const NODE_TYPES: Record<string, string> = {
	[HOST.document]: "DOCUMENT",
	[HOST.page]: "PAGE",
	[HOST.view]: "VIEW",
	[HOST.text]: "TEXT",
	[HOST.link]: "LINK",
	[HOST.image]: "IMAGE",
	[HOST.svg]: "SVG",
};

const toRenderedNode = (node: HostNode): RenderedNode =>
	"text" in node
		? { type: "TEXT_INSTANCE", value: node.text }
		: {
				type: NODE_TYPES[node.type] ?? node.type,
				props: node.props,
				// react-pdf kept the style beside the props.
				style: node.props.style,
				children: node.children.map(toRenderedNode),
			};

/** The PDF bytes, as a Node `Buffer` like react-pdf's. */
export async function renderToBuffer(element: ReactElement): Promise<Buffer> {
	return Buffer.from((await renderResumeElement(forme, element)).pdf);
}

export function pdf(element: ReactElement) {
	const [root] = renderHostTree(element);
	return {
		container: { document: root ? toRenderedNode(root) : null },
	};
}
