import type { OperatorListLike } from "./analyze/operators";
import type { PageOperatorSummary, RawExtraction, RawFont, RawLinkAnnotation, RawPage, RawTextItem } from "./types";
import { summarizePageOperators } from "./analyze/operators";

// ---------------------------------------------------------------------------
// Structural views of the reader API.
//
// Nothing here names pdf.js. The browser glue passes a real PDFDocumentProxy;
// a Node or MCP adapter can pass anything with the same shape, and every layer
// above this file only ever sees the plain JSON that comes out.
// ---------------------------------------------------------------------------

type PdfTextItemLike = {
	str?: unknown;
	transform?: unknown;
	width?: unknown;
	height?: unknown;
	fontName?: unknown;
	hasEOL?: unknown;
};

type PdfTextContentLike = { items?: unknown };

type PdfCommonObjsLike = {
	has?: (id: string) => boolean;
	get: (id: string) => unknown;
};

type PdfAnnotationLike = {
	subtype?: unknown;
	url?: unknown;
	unsafeUrl?: unknown;
	rect?: unknown;
};

export type PdfPageLike = {
	pageNumber?: unknown;
	rotate?: unknown;
	/** [x0, y0, x1, y1] in unrotated PDF user space. */
	view?: unknown;
	commonObjs: PdfCommonObjsLike;
	getTextContent: (options: { disableNormalization: boolean; includeMarkedContent: boolean }) => Promise<unknown>;
	getAnnotations: (options?: { intent: string }) => Promise<unknown>;
	getOperatorList: () => Promise<unknown>;
	cleanup?: () => void;
};

export type PdfDocumentLike = {
	numPages: number;
	getPage: (pageNumber: number) => Promise<PdfPageLike>;
	getMetadata: () => Promise<unknown>;
	getMarkInfo?: () => Promise<unknown>;
};

export type HarvestProgress = {
	phase: "text" | "operators";
	page: number;
	pageCount: number;
};

export type HarvestOptions = {
	file: { name: string; sizeBytes: number; magicBytesOk: boolean };
	/** Pages beyond this are not harvested; the report says so rather than pretending. */
	maxPages?: number;
	/** Set to 0 to skip the operator pass entirely; dependent checks then report as skipped. */
	operatorBudgetMs?: number;
	operatorBudgetPerPageMs?: number;
	onProgress?: (progress: HarvestProgress) => void;
	signal?: { aborted: boolean };
};

export const HARVEST_DEFAULTS = {
	maxPages: 30,
	operatorBudgetMs: 30_000,
	operatorBudgetPerPageMs: 10_000,
} as const;

class HarvestAbortedError extends Error {
	constructor() {
		super("PDF analysis was cancelled.");
		this.name = "HarvestAbortedError";
	}
}

// ---------------------------------------------------------------------------

const asString = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

const asBoolean = (value: unknown): boolean => value === true;

const asNullableBoolean = (value: unknown): boolean | null => (typeof value === "boolean" ? value : null);

function asNumberTuple6(value: unknown): RawTextItem["transform"] | null {
	if (!Array.isArray(value) || value.length < 6) return null;

	const [a, b, c, d, e, f] = value;
	if (![a, b, c, d, e, f].every((entry) => typeof entry === "number" && Number.isFinite(entry))) return null;

	return [a, b, c, d, e, f] as RawTextItem["transform"];
}

function toRawTextItem(value: unknown): RawTextItem | null {
	if (typeof value !== "object" || value === null) return null;

	const item = value as PdfTextItemLike;
	if (typeof item.str !== "string") return null;

	const transform = asNumberTuple6(item.transform);
	if (!transform) return null;

	return {
		str: item.str,
		transform,
		width: typeof item.width === "number" ? item.width : 0,
		height: typeof item.height === "number" ? item.height : 0,
		fontRef: typeof item.fontName === "string" ? item.fontName : "",
		hasEol: asBoolean(item.hasEOL),
	};
}

function toLinkAnnotations(value: unknown, pageNumber: number): RawLinkAnnotation[] {
	if (!Array.isArray(value)) return [];

	const links: RawLinkAnnotation[] = [];

	for (const entry of value) {
		if (typeof entry !== "object" || entry === null) continue;

		const annotation = entry as PdfAnnotationLike;
		if (annotation.subtype !== "Link") continue;

		const url = asString(annotation.url) ?? asString(annotation.unsafeUrl);
		const rect = Array.isArray(annotation.rect) ? annotation.rect : [];
		const [x1, y1, x2, y2] = rect;

		links.push({
			page: pageNumber,
			url,
			rect: [
				typeof x1 === "number" ? x1 : 0,
				typeof y1 === "number" ? y1 : 0,
				typeof x2 === "number" ? x2 : 0,
				typeof y2 === "number" ? y2 : 0,
			],
		});
	}

	return links;
}

/**
 * Reads font truth from the font object itself. `TextContent.styles[].fontFamily` reports a
 * synthesised CSS family ("sans-serif") rather than the embedded font, so it is never consulted.
 *
 * Every field is optional-tolerant: an adapter that cannot supply one leaves it null and the
 * checks that need it skip instead of firing on a guess.
 */
function toRawFont(ref: string, value: unknown): RawFont {
	if (typeof value !== "object" || value === null) {
		return {
			ref,
			name: null,
			isType3: false,
			isInvalid: false,
			missingFile: false,
			isMonospace: null,
			isSerif: null,
			vertical: null,
		};
	}

	const font = value as Record<string, unknown>;

	return {
		ref,
		name: asString(font.name),
		isType3: asBoolean(font.isType3Font),
		isInvalid: asBoolean(font.isInvalidPDFjsFont),
		missingFile: asBoolean(font.missingFile),
		isMonospace: asNullableBoolean(font.isMonospace),
		isSerif: asNullableBoolean(font.isSerifFont),
		vertical: asNullableBoolean(font.vertical),
	};
}

function toOperatorList(value: unknown): OperatorListLike | null {
	if (typeof value !== "object" || value === null) return null;

	const list = value as { fnArray?: unknown; argsArray?: unknown };
	const fnArray = list.fnArray;
	const argsArray = list.argsArray;

	if (!fnArray || typeof (fnArray as ArrayLike<number>).length !== "number") return null;
	if (!argsArray || typeof (argsArray as ArrayLike<unknown>).length !== "number") return null;

	return { fnArray: fnArray as ArrayLike<number>, argsArray: argsArray as ArrayLike<unknown> };
}

function pageBox(page: PdfPageLike): { width: number; height: number } {
	const view = Array.isArray(page.view) ? page.view : [];
	const [x0, y0, x1, y1] = view;

	if ([x0, y0, x1, y1].every((entry) => typeof entry === "number" && Number.isFinite(entry))) {
		return { width: Math.abs((x1 as number) - (x0 as number)), height: Math.abs((y1 as number) - (y0 as number)) };
	}

	// A4 in points — a last resort so ratios stay finite rather than dividing by zero.
	return { width: 595.28, height: 841.89 };
}

function readMetadata(raw: unknown): RawExtraction["metadata"] {
	const container = typeof raw === "object" && raw !== null ? (raw as { info?: unknown }) : {};
	const info =
		typeof container.info === "object" && container.info !== null ? (container.info as Record<string, unknown>) : {};

	return {
		producer: asString(info.Producer),
		creator: asString(info.Creator),
		title: asString(info.Title),
		author: asString(info.Author),
		language: asString(info.Language),
		pdfVersion: asString(info.PDFFormatVersion),
		isEncrypted: asString(info.EncryptFilterName) !== null,
		isXfa: asBoolean(info.IsXFAPresent),
		isCollection: asBoolean(info.IsCollectionPresent),
		isTagged: false,
		hasAcroForm: asBoolean(info.IsAcroFormPresent),
	};
}

async function withTimeout<T>(work: Promise<T>, budgetMs: number): Promise<T | null> {
	if (budgetMs <= 0) return null;

	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<null>((resolve) => {
		timer = setTimeout(() => resolve(null), budgetMs);
	});

	try {
		return await Promise.race([work, timeout]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

/**
 * Two passes per page: text and annotations always, operators only while the budget holds.
 *
 * The operator pass is where the expensive facts live (image coverage, invisible text, real
 * font objects), and it is also the pass that can hang on a pathological file. When it is cut
 * short, `operators` stays null and the report says which checks it could not run.
 */
export async function harvestPdfDocument(document: PdfDocumentLike, options: HarvestOptions): Promise<RawExtraction> {
	const maxPages = options.maxPages ?? HARVEST_DEFAULTS.maxPages;
	const totalBudgetMs = options.operatorBudgetMs ?? HARVEST_DEFAULTS.operatorBudgetMs;
	const perPageBudgetMs = options.operatorBudgetPerPageMs ?? HARVEST_DEFAULTS.operatorBudgetPerPageMs;

	const pageCount = Math.max(0, document.numPages);
	const harvestedPageCount = Math.min(pageCount, maxPages);

	const throwIfAborted = () => {
		if (options.signal?.aborted) throw new HarvestAbortedError();
	};

	const [metadataRaw, markInfoRaw] = await Promise.all([
		document.getMetadata().catch(() => null),
		document.getMarkInfo?.().catch(() => null) ?? Promise.resolve(null),
	]);

	const metadata = readMetadata(metadataRaw);
	const markInfo =
		typeof markInfoRaw === "object" && markInfoRaw !== null ? (markInfoRaw as { Marked?: unknown }) : null;
	metadata.isTagged = asBoolean(markInfo?.Marked);

	const pages: RawPage[] = [];
	const links: RawLinkAnnotation[] = [];
	const fontRefs = new Set<string>();
	const fonts = new Map<string, RawFont>();

	const operatorStartedAt = Date.now();
	let operatorsAttempted = false;
	let operatorsSucceeded = false;
	let textReadFailed = false;

	for (let pageNumber = 1; pageNumber <= harvestedPageCount; pageNumber += 1) {
		throwIfAborted();
		options.onProgress?.({ phase: "text", page: pageNumber, pageCount: harvestedPageCount });

		const page = await document.getPage(pageNumber);
		const box = pageBox(page);

		const [textContent, annotations] = await Promise.all([
			page.getTextContent({ disableNormalization: true, includeMarkedContent: false }).catch(() => null),
			page.getAnnotations({ intent: "display" }).catch(() => null),
		]);

		const rawItems = (textContent as PdfTextContentLike | null)?.items;
		if (!Array.isArray(rawItems)) textReadFailed = true;
		const items: RawTextItem[] = [];

		if (Array.isArray(rawItems)) {
			for (const entry of rawItems) {
				const item = toRawTextItem(entry);
				if (!item) continue;
				items.push(item);
				if (item.fontRef) fontRefs.add(item.fontRef);
			}
		}

		links.push(...toLinkAnnotations(annotations, pageNumber));

		let operators: PageOperatorSummary | null = null;
		const elapsed = Date.now() - operatorStartedAt;
		const remaining = Math.min(perPageBudgetMs, totalBudgetMs - elapsed);

		if (remaining > 0) {
			operatorsAttempted = true;
			options.onProgress?.({ phase: "operators", page: pageNumber, pageCount: harvestedPageCount });

			const operatorList = await withTimeout(
				page.getOperatorList().catch(() => null),
				remaining,
			);
			const parsed = toOperatorList(operatorList);
			if (parsed) {
				operators = summarizePageOperators(parsed, box);
				operatorsSucceeded = true;
			}
		}

		// commonObjs is only populated once the page's operator list has been built, so fonts are
		// read here rather than up front, and only for refs this page actually used.
		for (const ref of fontRefs) {
			if (fonts.has(ref)) continue;
			const resolved = readCommonObject(page.commonObjs, ref);
			if (resolved !== undefined) fonts.set(ref, toRawFont(ref, resolved));
		}

		pages.push({
			pageNumber,
			width: box.width,
			height: box.height,
			rotation: typeof page.rotate === "number" ? page.rotate : 0,
			items,
			operators,
		});

		page.cleanup?.();
	}

	return {
		version: 1,
		file: options.file,
		pageCount,
		truncated: pageCount > harvestedPageCount,
		textReadFailed,
		pages,
		fonts: [...fonts.values()],
		links,
		metadata,
		operatorsAvailable: operatorsAttempted && operatorsSucceeded,
	};
}

/** `commonObjs.get` throws for unresolved ids, so an unguarded read would take the whole run down. */
function readCommonObject(commonObjs: PdfCommonObjsLike, ref: string): unknown {
	try {
		if (commonObjs.has && !commonObjs.has(ref)) return undefined;
		return commonObjs.get(ref);
	} catch {
		return undefined;
	}
}
