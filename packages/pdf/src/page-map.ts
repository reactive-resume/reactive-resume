import type { ElementInfo, LayoutInfo } from "@formepdf/core";
import type { Proposal } from "@reactive-resume/resume/proposals";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { applyResumeProposals } from "@reactive-resume/resume/proposals";

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
	pages: { width: number; height: number; contentBounds?: { top: number; bottom: number } }[];
	nodes: PageMapNode[];
};

/** Physical spill pages grouped by their authored page, using the semantic keys carried through rendering. */
export function measureOverflow(data: ResumeData, rendered: { pageCount: number; pageMap: PageMap | undefined }) {
	const authored = Math.max(1, data.metadata.layout.pages.length);
	if (rendered.pageCount <= authored) return null;
	const groups = new Map<number, Map<number, { top: number; bottom: number }>>();
	for (const node of rendered.pageMap?.nodes ?? []) {
		const authoredPage = Number(node.key.match(/^page-(\d+)\//)?.[1]);
		if (!Number.isInteger(authoredPage) || authoredPage < 1 || authoredPage > authored) continue;
		let pages = groups.get(authoredPage);
		if (!pages) groups.set(authoredPage, (pages = new Map()));
		const extent = pages.get(node.page);
		const content = rendered.pageMap?.pages[node.page]?.contentBounds;
		pages.set(node.page, {
			top: content?.top ?? Math.min(extent?.top ?? node.y, node.y),
			bottom: content?.bottom ?? Math.max(extent?.bottom ?? 0, node.y + node.height),
		});
	}
	const lineHeight = data.metadata.typography.body.fontSize * data.metadata.typography.body.lineHeight;
	const spills = [...groups]
		.sort(([a], [b]) => a - b)
		.flatMap(([authoredPage, pages]) => {
			const ordered = [...pages].sort(([a], [b]) => a - b).slice(1);
			if (ordered.length === 0) return [];
			const height = ordered.reduce((sum, [, extent]) => sum + extent.bottom - extent.top, 0);
			return [
				{
					authoredPage,
					pages: ordered.map(([page]) => page + 1),
					lines: height > 0 && lineHeight > 0 ? Math.max(1, Math.round(height / lineHeight)) : null,
				},
			];
		});
	return { authored, pageCount: rendered.pageCount, spills };
}

/** Render the same private copies acceptance would write, without markings or persisted proposal decisions. */
export async function measureProposalPageFit(
	data: ResumeData,
	proposals: readonly Proposal[],
	render: (data: ResumeData) => Promise<PageMap>,
) {
	const before = structuredClone(data);
	const after = structuredClone(data);
	// Callers pass only currently acceptable edits; an undone receipt may override an older accepted status.
	applyResumeProposals(
		after,
		proposals.map((proposal) => ({ ...proposal, status: "pending" })),
	);
	const beforeMap = await render(before);
	const afterMap = await render(after);
	const lines = (data: ResumeData, pageMap: PageMap) => {
		const overflow = measureOverflow(data, { pageCount: pageMap.pages.length, pageMap });
		if (!overflow) return 0;
		if (!overflow.spills.length || overflow.spills.some((spill) => spill.lines === null)) return null;
		return overflow.spills.reduce((sum, spill) => sum + (spill.lines ?? 0), 0);
	};
	const oldLines = lines(before, beforeMap);
	const newLines = lines(after, afterMap);
	return {
		before: beforeMap.pages.length,
		after: afterMap.pages.length,
		lines: oldLines === null || newLines === null ? null : newLines - oldLines,
	};
}

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
	const contentBounds: ({ top: number; bottom: number } | undefined)[] = [];

	const pages = layout.pages.map((page) => {
		const own = new Map<string, Box>();
		const contents = new Map<string, Box>();
		let textBounds: { top: number; bottom: number } | undefined;
		const visit = (element: ElementInfo, parentFile?: string) => {
			const file = element.sourceLocation?.file;
			const textFile = file ?? parentFile;
			const box = { x: element.x, y: element.y, width: element.width, height: element.height };
			// Forme leaves a box it failed to place at ±Number.MAX_VALUE.
			const finite = Object.values(box).every((value) => Math.abs(value) < 1e6);
			if (
				finite &&
				element.kind === "Text" &&
				(textFile?.startsWith(NODE_SOURCE_PREFIX) || textFile?.startsWith(NODE_CONTENT_PREFIX))
			) {
				const top = Math.max(page.contentY, box.y);
				const bottom = Math.min(page.contentY + page.contentHeight, box.y + box.height);
				if (bottom > top)
					textBounds = {
						top: Math.min(textBounds?.top ?? top, top),
						bottom: Math.max(textBounds?.bottom ?? bottom, bottom),
					};
			}
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
			for (const child of element.children) visit(child, textFile);
		};
		for (const element of page.elements) visit(element);
		contentBounds.push(textBounds);
		return { own, contents };
	});

	pages.forEach(({ own, contents }, index) => {
		for (const [key, contentBox] of contents) {
			const target = tagged.has(key) ? parseResumeNodeKey(key) : undefined;
			if (target) nodes.push({ ...target, key, page: index, ...(own.get(key) ?? contentBox) });
		}
	});

	return {
		pages: layout.pages.map((page, index) => ({
			width: page.width,
			height: page.height,
			...(contentBounds[index] ? { contentBounds: contentBounds[index] } : {}),
		})),
		nodes,
	};
};
