import type { ResumeRenderOptions } from "../context";
import type { PageMap } from "../page-map";
import type { ConvertedDocument } from "./to-forme";
import type { ElementInfo, RenderWithLayoutResult } from "@formepdf/core";
import type { FormeDocument } from "@formepdf/react";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import type { Locale } from "@reactive-resume/utils/locale";
import type { ReactElement } from "react";
import { createElement } from "react";
import { ResumeDocument } from "../document";
import { resolvePdfFonts, resumeContentScripts, resumeUsesItalic } from "../hooks/use-register-fonts";
import { extractPageMap, NODE_CONTENT_PREFIX, NODE_SOURCE_PREFIX, parseResumeNodeKey } from "../page-map";
import { loadFonts } from "./fonts";
import { loadRequestedIcons } from "./icons";
import { imageSources, loadImages } from "./images";
import { renderHostTree } from "./reconciler";
import { FIXED_SOURCE, FREE_FORM_MEASURE_HEIGHT, LIST_ROLE, toFormeDocument } from "./to-forme";

/** The Forme entry point for this runtime: `@formepdf/core` in Node, `@formepdf/core/worker` in browsers. */
export type FormeEngine = {
	renderSerializedDocWithLayout: (document: Record<string, unknown>) => Promise<RenderWithLayoutResult>;
	/** What to hand Forme for a font's bytes, given every character the document draws (see `browser.tsx`). */
	prepareFont?: ((bytes: Uint8Array, text: string) => Uint8Array | string | Promise<Uint8Array | string>) | undefined;
};

export type RenderResumeInput = {
	/** Parsed with `parseResumeData`: the entry points check data at their boundary. */
	data: ResumeData;
	template?: Template | undefined;
	renderOptions?: ResumeRenderOptions | undefined;
	readImage?: ((source: string) => Promise<Uint8Array>) | undefined;
	/** Computer Modern mirror supplied by the server entry; browser callers leave it unset. */
	webFontBaseUrl?: string | undefined;
};

export type RenderedResume = {
	pdf: Uint8Array;
	/** Header, section and item boxes, for click-to-edit, Check and Fit (see `page-map.ts`). */
	pageMap: PageMap;
	/** Forme's layout of every page, for tests and diagnostics. */
	layout: RenderWithLayoutResult["layout"];
	/** Font families that couldn't be downloaded; their text falls back to the standard PDF fonts. */
	missingFonts: string[];
	/** Rendering diagnostics; `lostCharacters` reads the characters no font could draw from them. */
	warnings: string[];
};

/** A failed font download would print the resume in other fonts: the file waits for a retry instead. */
export function assertPdfFonts({ missingFonts }: Pick<RenderedResume, "missingFonts">) {
	if (missingFonts.length > 0)
		throw new Error(`Fonts could not be loaded: ${missingFonts.join(", ")}. Retry the export.`, {
			cause: "pdf-text-loss",
		});
}

/**
 * The characters no font in the resume can draw, as Forme names them (`"₹" (U+20B9)`); Forme draws them as "?".
 * Null when every character rendered; empty when text was lost without Forme naming the characters.
 */
export function lostCharacters(warnings: readonly string[]): string[] | null {
	const lost = warnings.filter(
		(warning) =>
			warning.includes('was rendered as "?"') || warning.includes("character(s) of source text did not render"),
	);
	if (lost.length === 0) return null;
	return [...new Set(lost.flatMap((warning) => warning.match(/"[^"]*" \(U\+[0-9A-F]+\)/g) ?? []))];
}

/** Every character in the document's strings, sorted: its text, plus style values and links, which cost little. */
function documentText(document: FormeDocument): string {
	const characters = new Set<string>();
	const visit = (value: unknown, key?: string) => {
		if (typeof value === "string") {
			// Pictures are data URIs: base64 adds no character a font needs.
			if (key !== "src") for (const character of value) characters.add(character);
		} else if (Array.isArray(value)) for (const item of value) visit(item);
		else if (value && typeof value === "object") for (const [name, item] of Object.entries(value)) visit(item, name);
	};
	visit(document);
	return [...characters].sort().join("");
}

// A4 height: a free-form page is never shorter than a sheet of paper, as before.
const FREE_FORM_MIN_HEIGHT = 841.89;

type PageKind = Extract<FormeDocument["children"][number]["kind"], { type: "Page" }>;

// Forme leaves a box it failed to place at ±Number.MAX_VALUE; the page is then likely wrong.
const offPage = (value: number) => !(Math.abs(value) < 1e6);
const misplacesABox = (result: RenderWithLayoutResult) =>
	result.layout.pages.some((page) =>
		page.elements.some(function bad(element): boolean {
			return offPage(element.y) || offPage(element.height) || element.children.some(bad);
		}),
	);

/** Missing sections and items with text Forme failed to place while splitting a column. */
function unplacedBlocks(layout: RenderWithLayoutResult["layout"]): string[] {
	const placed = new Set(
		extractPageMap(layout)
			.nodes.filter((node) => node.kind === "section")
			.map((node) => node.key),
	);
	const missing = new Set<string>();
	const visit = (element: ElementInfo, itemKey?: string) => {
		let ownerItemKey = itemKey;
		const source = element.sourceLocation?.file;
		if (source?.startsWith(NODE_SOURCE_PREFIX) || source?.startsWith(NODE_CONTENT_PREFIX)) {
			const key = source.slice(source.indexOf(":") + 1);
			if (parseResumeNodeKey(key)?.kind === "item") ownerItemKey = key;
		}
		if (source?.startsWith(NODE_SOURCE_PREFIX) && (offPage(element.y) || offPage(element.height))) {
			const key = source.slice(NODE_SOURCE_PREFIX.length);
			if (parseResumeNodeKey(key)?.kind === "section" && !placed.has(key)) missing.add(key);
		}
		if (element.kind === "Text" && offPage(element.y) && ownerItemKey) missing.add(ownerItemKey);
		for (const child of element.children) visit(child, ownerItemKey);
	};
	for (const page of layout.pages) for (const element of page.elements) visit(element);
	return [...missing];
}

const isFixed = (element: ElementInfo): boolean =>
	element.sourceLocation?.file === FIXED_SOURCE || element.children.some(isFixed);

/** Flow constraints for large items, and marker/row repairs for items that still split (see `LIST_ROLE`). */
function listPaginationRepairs(layout: RenderWithLayoutResult["layout"]) {
	const markerPage = new Map<number, number>();
	const contentPage = new Map<number, number>();
	const itemPage = new Map<number, number>();
	const split = new Set<number>();
	const oversized = new Set<number>();
	const contentPages = new Map<number, Set<number>>();
	layout.pages.forEach((page, pageIndex) => {
		const visit = (element: ElementInfo, availableHeight: number, parentSource?: ElementInfo["sourceLocation"]) => {
			const source = element.sourceLocation;
			const inheritedSource = source ?? parentSource;
			if (inheritedSource?.column === LIST_ROLE.content && element.kind === "Text" && !offPage(element.y)) {
				const pages = contentPages.get(inheritedSource.line) ?? new Set<number>();
				pages.add(pageIndex);
				contentPages.set(inheritedSource.line, pages);
			}
			const { margin, padding, borderWidth } = element.style;
			if (source?.column === LIST_ROLE.item) {
				const height = element.height + margin.top + margin.bottom;
				// Prefer splitting large rows for page fill; only rows exceeding a fresh page cannot stay whole.
				if (height > availableHeight / 4) split.add(source.line - 1);
				if (height > availableHeight) oversized.add(source.line - 1);
			}
			const pages =
				source?.column === LIST_ROLE.marker
					? markerPage
					: source?.column === LIST_ROLE.content
						? contentPage
						: source?.column === LIST_ROLE.item
							? itemPage
							: null;
			// Forme leaves some fragments of a splitting box at y ±Number.MAX_VALUE; they aren't on this page.
			if (source && pages && !pages.has(source.line) && !offPage(element.y)) pages.set(source.line, pageIndex);
			const innerHeight = availableHeight - padding.top - padding.bottom - borderWidth.top - borderWidth.bottom;
			for (const child of element.children) visit(child, innerHeight, inheritedSource);
		};
		for (const element of page.elements) visit(element, page.contentHeight);
	});
	const breakBefore = [...markerPage]
		.flatMap(([line, page]) => {
			const content = contentPage.get(line) ?? page;
			// Forme can move both companions to a new page but drop their row, reserving only the marker's line height.
			const detached = page > 0 && content === page && itemPage.get(line) !== page;
			return content > page || detached ? [line - 1] : [];
		})
		.sort((a, b) => a - b);
	const unsplit = [...contentPages].flatMap(([line, pages]) => (pages.size === 1 ? [line - 1] : []));
	return { split, oversized, breakBefore, unsplit };
}

/**
 * Where a box's content ends on a free-form measuring page. A box reaching the bottom of the space it sits in was
 * stretched to fill the measuring page (the content box around repeated backgrounds, a row page's columns,
 * `minHeight: "100%"`), so it ends where its own children do instead.
 */
function contentBottom(element: ElementInfo, limit: number): number {
	const bottom = element.y + element.height;
	if (bottom + element.style.margin.bottom < limit - 0.5) return bottom;
	const { padding, borderWidth } = element.style;
	const end = padding.bottom + borderWidth.bottom;
	const content = element.children.reduce(
		(lowest, child) => Math.max(lowest, contentBottom(child, bottom - end) + child.style.margin.bottom),
		element.y + padding.top + borderWidth.top,
	);
	return content + end;
}

/** A free-form page's content height: where its content ends plus the page's bottom margin. */
function measuredHeight(result: RenderWithLayoutResult, pageIndex: number, marginBottom: number) {
	const page = result.layout.pages[pageIndex];
	if (!page) return FREE_FORM_MIN_HEIGHT;
	// Repeated backgrounds span the page they're measured on, so they don't count.
	const content = page.elements.filter((element) => !isFixed(element));
	const pageBottom = page.contentY + page.contentHeight;
	const bottom = content.reduce((lowest, element) => Math.max(lowest, contentBottom(element, pageBottom)), 0);
	return Math.max(FREE_FORM_MIN_HEIGHT, Math.ceil(bottom + marginBottom));
}

/** The font faces a resume's PDF embeds: its typography, italics if it uses any, and a fallback per writing system. */
export const resumeFontRequests = (data: ResumeData) =>
	resolvePdfFonts(
		data.metadata.typography,
		data.metadata.page.locale as Locale,
		resumeContentScripts(data),
		resumeUsesItalic(data),
	).fonts;

/**
 * Renders a resume or letter to PDF bytes with its page map. Every PDF in the app goes through here: the live
 * preview, downloads, thumbnails, the public page and the server export.
 */
export function renderResume(engine: FormeEngine, input: RenderResumeInput): Promise<RenderedResume> {
	const { data } = input;
	return renderResumeElement(
		engine,
		createElement(ResumeDocument, {
			data,
			template: input.template ?? data.metadata.template,
			...(input.renderOptions ? { renderOptions: input.renderOptions } : {}),
		}),
		input.readImage,
		input.webFontBaseUrl,
	);
}

/**
 * Renders an element tree (normally a `ResumeDocument`) to PDF. The fonts come from the `data` prop of the root
 * element when it has one; without it, only the standard PDF fonts are available.
 */
export async function renderResumeElement(
	engine: FormeEngine,
	element: ReactElement,
	readImage?: (source: string) => Promise<Uint8Array>,
	webFontBaseUrl?: string,
): Promise<RenderedResume> {
	const data = (element.props as { data?: ResumeData }).data;
	// Font downloads start first: they're the largest wait, and the tree needs only the icons.
	const fontsLoaded = loadFonts(data ? resumeFontRequests(data) : [], webFontBaseUrl);
	let tree = renderHostTree(element);
	// Icons load on first use: a tree that asked for new ones is drawn again once they arrive.
	if (await loadRequestedIcons()) tree = renderHostTree(element);
	const [{ fonts, warnings: fontWarnings, missing }, { images, warnings: imageWarnings }] = await Promise.all([
		fontsLoaded,
		loadImages(imageSources(tree), readImage),
	]);

	const breakBeforeListItems = new Set<number>();
	const splitListItems = new Set<number>();
	const breakBeforeNodes = new Set<string>();
	// Every pass draws the same text, so the fonts are prepared once, from the first pass's document.
	let formeFonts: typeof fonts | undefined;
	const layOutOnce = async (keepNestedRowsWhole: boolean) => {
		const convert = (freeFormHeights?: (number | undefined)[]) =>
			toFormeDocument(tree, {
				images,
				keepNestedRowsWhole,
				breakBeforeListItems,
				splitListItems,
				breakBeforeNodes,
				freeFormHeights,
			});
		// Forme rewrites the font entries it's given (bytes to base64), so each render gets its own.
		const render = async ({ document }: ConvertedDocument) => {
			if (!formeFonts) {
				const { prepareFont } = engine;
				const text = prepareFont ? documentText(document) : "";
				formeFonts = prepareFont
					? await Promise.all(
							fonts.map(async (font) => ({ ...font, src: await prepareFont(font.src as Uint8Array, text) })),
						)
					: fonts;
			}
			return engine.renderSerializedDocWithLayout({ ...document, fonts: formeFonts.map((font) => ({ ...font })) });
		};
		let converted = convert();
		let result = await render(converted);

		// Free-form pages grow with their content: measure it, then convert and render once more at that height, so
		// what spans the page (repeated backgrounds, percentages of it) spans the measured one.
		const heights = converted.document.children.map((page, index) => {
			const kind = page.kind as PageKind;
			if (kind.type !== "Page" || typeof kind.config.size !== "object") return undefined;
			if (kind.config.size.Custom.height !== FREE_FORM_MEASURE_HEIGHT) return undefined;
			return measuredHeight(result, index, kind.config.margin.bottom);
		});
		if (heights.some((height) => height !== undefined)) {
			converted = convert(heights);
			result = await render(converted);
		}
		return { result, warnings: converted.warnings };
	};

	// Flow constraints remain valid when earlier rows move: batch repairs of rows that fit a fresh page. Only
	// oversized rows need positional repairs, whose later break positions must be rechecked after each move.
	const layOut = async (keepNestedRowsWhole: boolean) => {
		breakBeforeListItems.clear();
		splitListItems.clear();
		const whole = new Set<number>();
		let measuredOversized: ReadonlySet<number> | undefined;
		for (;;) {
			const laidOut = await layOutOnce(keepNestedRowsWhole);
			const repairs = listPaginationRepairs(laidOut.result.layout);
			// Capture full intrinsic heights before reopening rows; later fragments do not measure the whole row.
			const oversized = (measuredOversized ??= repairs.oversized);
			let changed = false;
			for (const item of repairs.split) {
				if (whole.has(item) || splitListItems.has(item)) continue;
				splitListItems.add(item);
				changed = true;
			}
			if (changed) continue;
			if (repairs.breakBefore.some((item) => !oversized.has(item))) {
				// Reserve fitting rows already in one piece too, so later rows do not repeat the same defect after reflow.
				// Preserve genuine continuations: their content already spans pages without leaving its marker behind.
				for (const item of [...repairs.breakBefore, ...repairs.unsplit]) {
					if (oversized.has(item) || whole.has(item) || !splitListItems.has(item)) continue;
					whole.add(item);
					splitListItems.delete(item);
					changed = true;
				}
			}
			if (changed) continue;
			// shortcut: oversized rows need sequential marker repair until Forme supports atomic first fragments.
			const first = repairs.breakBefore.find((item) => oversized.has(item) && !breakBeforeListItems.has(item));
			if (first === undefined) {
				if (repairs.breakBefore.some((item) => !oversized.has(item)) && !misplacesABox(laidOut.result))
					throw new Error("The PDF engine could not keep a list marker with its content.");
				return laidOut;
			}
			breakBeforeListItems.add(first);
		}
	};

	let { result, warnings } = await layOut(false);
	if (misplacesABox(result)) ({ result, warnings } = await layOut(true));
	// ponytail: three repairs cap rendering cost; remove this workaround when Forme fixes nested pagination.
	for (let pass = 0; pass < 3; pass++) {
		const first = unplacedBlocks(result.layout).find((key) => !breakBeforeNodes.has(key));
		if (!first) break;
		// Retry the first failed block from a fresh page; later failures may recover without extra breaks.
		breakBeforeNodes.add(first);
		({ result, warnings } = await layOut(true));
	}
	if (misplacesABox(result))
		warnings.push("render defect: the engine couldn't place a box; a page may be laid out wrong");

	return {
		pdf: result.pdf,
		pageMap: extractPageMap(result.layout),
		missingFonts: [...new Set(missing)],
		layout: result.layout,
		warnings: [...fontWarnings, ...imageWarnings, ...warnings, ...result.warnings],
	};
}
