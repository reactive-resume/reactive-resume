import type { ElementInfo, LayoutInfo } from "@formepdf/core";

/**
 * Maps rendered PDF regions back to resume data, so the editor can outline the block a field
 * belongs to and select an entry when its line on the page is clicked.
 *
 * Templates tag the views that own a semantic node with `RESUME_NODE_PROP` (see
 * `templates/shared/primitives.tsx` and `templates/shared/sections.tsx`). The Forme conversion gives
 * each tagged element a source location, `rr-node:<key>`, which Forme reports back with every box in
 * its layout info.
 */

export const RESUME_NODE_PROP = "data-resume-node";

/**
 * A heading's node key, for the web page only: it makes the name an `h1` and section titles `h2`s. Kept apart from
 * `RESUME_NODE_PROP` so the PDF's layout and page map stay as they are.
 */
export const HEADING_NODE_PROP = "data-resume-heading";

export type PageMapTarget =
	| { kind: "header" }
	| { kind: "section"; sectionId: string }
	| { kind: "item"; sectionId: string; itemId: string };

export type PageMapNode = PageMapTarget & {
	key: string;
	/** Physical page index, 0-based. One authored page can spill onto several physical pages. */
	page: number;
	/** Position and size in PDF points, relative to the page's top-left corner. */
	x: number;
	y: number;
	width: number;
	height: number;
};

export type PageMap = {
	pages: { width: number; height: number }[];
	nodes: PageMapNode[];
};

const decode = (value: string) => {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
};

/**
 * Reads a semantic node key (see `semantic/node-keys.ts`), e.g.
 * `page-1/region-main/section-experience/section-items/item-<id>`, as the part of the resume it
 * renders. Only the header, sections and items are addressable; deeper keys (fields, icons,
 * template parts) return `undefined` because they live inside one of those blocks.
 */
export const parseResumeNodeKey = (key: string): PageMapTarget | undefined => {
	const segments = key.split("/");
	const last = segments.at(-1);
	if (!last) return;
	if (last === "header") return { kind: "header" };

	const sectionSegment = segments.find(
		(segment) => segment.startsWith("section-") && segment !== "section-items" && segment !== "section-heading",
	);
	if (!sectionSegment) return;
	// Templates that merge main and sidebar into one region qualify ids with their origin
	// (`main:experience`, see `semantic/tree.ts`); section ids never contain a colon otherwise.
	const sectionId = decode(sectionSegment.slice("section-".length)).replace(/^(main|sidebar):/, "");

	if (last === sectionSegment) return { kind: "section", sectionId };
	if (last.startsWith("item-") && segments.at(-2) === "section-items") {
		return { kind: "item", sectionId, itemId: decode(last.slice("item-".length)) };
	}
};

/** Source-location files that carry a page-map key: `rr-node:<semantic key>` on the block itself. */
export const NODE_SOURCE_PREFIX = "rr-node:";
/** …and `rr-in:<semantic key>` on everything drawn inside it. */
export const NODE_CONTENT_PREFIX = "rr-in:";

type Box = { x: number; y: number; width: number; height: number };

const union = (a: Box, b: Box): Box => {
	const x = Math.min(a.x, b.x);
	const y = Math.min(a.y, b.y);
	return {
		x,
		y,
		width: Math.max(a.x + a.width, b.x + b.width) - x,
		height: Math.max(a.y + a.height, b.y + b.height) - y,
	};
};

/**
 * Page-relative boxes for every tagged header, section and item, from Forme's layout info. A block that breaks
 * across pages has a box on each page it reaches. Forme leaves a plain block that breaks across pages out of its
 * layout, so where a block's own box is missing, its box is the extent of what it contains on that page.
 */
export const extractPageMap = (layout: LayoutInfo): PageMap => {
	const nodes: PageMapNode[] = [];
	// Only blocks something is tagged with; the paths between them aren't blocks.
	const tagged = new Set<string>();

	const pages = layout.pages.map((page) => {
		const own = new Map<string, Box>();
		const contents = new Map<string, Box>();
		const visit = (element: ElementInfo) => {
			const file = element.sourceLocation?.file;
			const box = { x: element.x, y: element.y, width: element.width, height: element.height };
			// Forme leaves a box it failed to place at ±Number.MAX_VALUE.
			const finite = Object.values(box).every((value) => Math.abs(value) < 1e6);
			if (finite && file?.startsWith(NODE_SOURCE_PREFIX)) {
				const key = file.slice(NODE_SOURCE_PREFIX.length);
				if (!own.has(key)) own.set(key, box);
			}
			if (finite && (file?.startsWith(NODE_SOURCE_PREFIX) || file?.startsWith(NODE_CONTENT_PREFIX))) {
				// Content counts toward its block and every block around it: keys are paths.
				let key = file.slice(file.indexOf(":") + 1);
				tagged.add(key);
				while (key) {
					const current = contents.get(key);
					contents.set(key, current ? union(current, box) : box);
					key = key.slice(0, Math.max(0, key.lastIndexOf("/")));
				}
			}
			for (const child of element.children) visit(child);
		};
		for (const element of page.elements) visit(element);
		return { own, contents };
	});

	pages.forEach(({ own, contents }, index) => {
		for (const [key, contentBox] of contents) {
			const target = tagged.has(key) ? parseResumeNodeKey(key) : undefined;
			if (target) nodes.push({ ...target, key, page: index, ...(own.get(key) ?? contentBox) });
		}
	});

	return { pages: layout.pages.map((page) => ({ width: page.width, height: page.height })), nodes };
};
