import type { ResumeRenderOptions } from "../context";
import type { PageMap } from "../page-map";
import type { SectionTitleResolver } from "../section-title";
import type { ConvertedDocument } from "./to-forme";
import type { ElementInfo, RenderWithLayoutResult } from "@formepdf/core";
import type { FormeDocument } from "@formepdf/react";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import type { Locale } from "@reactive-resume/utils/locale";
import type { ReactElement } from "react";
import { createElement } from "react";
import { ResumeDocument } from "../document";
import { resolvePdfFonts, resumeContentContainsCJK, resumeContentScripts } from "../hooks/use-register-fonts";
import { extractPageMap, NODE_SOURCE_PREFIX, parseResumeNodeKey } from "../page-map";
import { loadFonts } from "./fonts";
import { loadIcons } from "./icons";
import { imageSources, loadImages } from "./images";
import { renderHostTree } from "./reconciler";
import { FIXED_SOURCE, FREE_FORM_MEASURE_HEIGHT, LIST_ROLE, toFormeDocument } from "./to-forme";

/** The Forme entry point for this runtime: `@formepdf/core` in Node, `@formepdf/core/worker` in browsers. */
export type FormeEngine = {
	renderSerializedDocWithLayout: (document: Record<string, unknown>) => Promise<RenderWithLayoutResult>;
};

export type RenderResumeInput = {
	/** Parsed with `parseResumeData`: the entry points check data at their boundary. */
	data: ResumeData;
	template?: Template | undefined;
	renderOptions?: ResumeRenderOptions | undefined;
	resolveSectionTitle?: SectionTitleResolver | undefined;
	readImage?: ((source: string) => Promise<Uint8Array>) | undefined;
};

export type RenderedResume = {
	pdf: Uint8Array;
	/** Header, section and item boxes, for click-to-edit, Check and Fit (see `page-map.ts`). */
	pageMap: PageMap;
	/** Forme's layout of every page, for tests and diagnostics. */
	layout: RenderWithLayoutResult["layout"];
	/** Font families that couldn't be downloaded; their text falls back to the standard PDF fonts. */
	missingFonts: string[];
	/** Rendering diagnostics; export entrypoints reject warnings that indicate lost text. */
	warnings: string[];
};

/** A downloadable file must retain its text; preview success and downloaded fonts alone cannot prove that. */
export function assertPdfText({ missingFonts, warnings }: Pick<RenderedResume, "missingFonts" | "warnings">) {
	if (missingFonts.length > 0)
		throw new Error(`Fonts could not be loaded: ${missingFonts.join(", ")}. Retry the export.`, {
			cause: "pdf-text-loss",
		});
	if (
		warnings.some(
			(warning) =>
				warning.includes('was rendered as "?"') || warning.includes("character(s) of source text did not render"),
		)
	)
		throw new Error(
			"Some PDF text could not be rendered. Choose a font containing these characters, then retry the export.",
			{ cause: "pdf-text-loss" },
		);
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

/** Whole sections Forme lost while splitting a column, rather than ordinary off-page fragments. */
function unplacedSections(layout: RenderWithLayoutResult["layout"]): string[] {
	const placed = new Set(
		extractPageMap(layout)
			.nodes.filter((node) => node.kind === "section")
			.map((node) => node.key),
	);
	const missing = new Set<string>();
	const visit = (element: ElementInfo) => {
		const source = element.sourceLocation?.file;
		if (source?.startsWith(NODE_SOURCE_PREFIX) && (offPage(element.y) || offPage(element.height))) {
			const key = source.slice(NODE_SOURCE_PREFIX.length);
			if (parseResumeNodeKey(key)?.kind === "section" && !placed.has(key)) missing.add(key);
		}
		element.children.forEach(visit);
	};
	for (const page of layout.pages) page.elements.forEach(visit);
	return [...missing];
}

const isFixed = (element: ElementInfo): boolean =>
	element.sourceLocation?.file === FIXED_SOURCE || element.children.some(isFixed);

/** List items whose marker sits on an earlier page than their first line (see `LIST_ROLE`). */
function listMarkersLeftBehind(layout: RenderWithLayoutResult["layout"]): number[] {
	const markerPage = new Map<number, number>();
	const contentPage = new Map<number, number>();
	layout.pages.forEach((page, pageIndex) => {
		const visit = (element: ElementInfo) => {
			const source = element.sourceLocation;
			const pages =
				source?.column === LIST_ROLE.marker ? markerPage : source?.column === LIST_ROLE.content ? contentPage : null;
			// Forme leaves some fragments of a splitting box at y ±Number.MAX_VALUE; they aren't on this page.
			if (source && pages && !pages.has(source.line) && !offPage(element.y)) pages.set(source.line, pageIndex);
			element.children.forEach(visit);
		};
		page.elements.forEach(visit);
	});
	return [...markerPage].flatMap(([line, page]) => ((contentPage.get(line) ?? page) > page ? [line - 1] : []));
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
			resolveSectionTitle: input.resolveSectionTitle,
		}),
		input.readImage,
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
): Promise<RenderedResume> {
	const data = (element.props as { data?: ResumeData }).data;
	const fontRequests = data
		? resolvePdfFonts(
				data.metadata.typography,
				data.metadata.page.locale as Locale,
				resumeContentContainsCJK(data),
				resumeContentScripts(data),
			).fonts
		: [];
	const [{ fonts, warnings: fontWarnings, missing }] = await Promise.all([loadFonts(fontRequests), loadIcons()]);

	const tree = renderHostTree(element);
	const { images, warnings: imageWarnings } = await loadImages(imageSources(tree), readImage);

	const breakBeforeListItems = new Set<number>();
	const breakBeforeSections = new Set<string>();
	const layOutOnce = async (keepNestedRowsWhole: boolean) => {
		const convert = (freeFormHeights?: (number | undefined)[]) =>
			toFormeDocument(tree, {
				images,
				keepNestedRowsWhole,
				breakBeforeListItems,
				breakBeforeSections,
				freeFormHeights,
			});
		// Forme rewrites the font entries it's given (bytes to base64), so each render gets its own.
		const render = ({ document }: ConvertedDocument) =>
			engine.renderSerializedDocWithLayout({ ...document, fonts: fonts.map((font) => ({ ...font })) });
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

	// A marker left on the page its first line leaves: that item starts the next page instead. Breaks move what
	// follows, so a few passes settle it; an item that already starts a page is never broken again.
	const layOut = async (keepNestedRowsWhole: boolean) => {
		for (let pass = 0; ; pass++) {
			const laidOut = await layOutOnce(keepNestedRowsWhole);
			const leftBehind = listMarkersLeftBehind(laidOut.result.layout).filter((item) => !breakBeforeListItems.has(item));
			if (leftBehind.length === 0 || pass === 3) return laidOut;
			for (const item of leftBehind) breakBeforeListItems.add(item);
		}
	};

	let { result, warnings } = await layOut(false);
	if (misplacesABox(result)) ({ result, warnings } = await layOut(true));
	const missingSections = unplacedSections(result.layout);
	if (missingSections.length > 0) {
		// A section that disappeared gets an explicit next-page start; never discard its content to make it fit.
		for (const key of missingSections) breakBeforeSections.add(key);
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
