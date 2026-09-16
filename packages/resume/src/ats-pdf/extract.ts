import type {
	ColumnGutter,
	ExtractedDocument,
	PageGeometry,
	RawExtraction,
	RawPage,
	TextLine,
	TextSpan,
} from "./types";

/** Vertical slack when deciding two spans share a line, as a share of the modal font size. */
const LINE_TOLERANCE_RATIO = 0.35;
const MIN_LINE_TOLERANCE_PT = 2;

/** Horizontal gap, as a share of font size, above which two spans need a space between them. */
const SPACE_GAP_RATIO = 0.25;

/** Horizontal gap, as a share of font size, above which two spans sit in different columns. */
const COLUMN_GAP_RATIO = 2.5;
const MIN_COLUMN_GAP_PT = 20;

const HISTOGRAM_BIN_PT = 2;
const ROW_BIN_PT = 6;
const MIN_GUTTER_WIDTH_PT = 14;
/** Order statistic used for margins, so one stray run cannot define the page's edge. */
const MARGIN_PERCENTILE = 0.05;
/** A gutter has to sit somewhere near the middle; a wide right margin is not a column break. */
const GUTTER_SEARCH_MIN = 0.2;
const GUTTER_SEARCH_MAX = 0.8;

function fontSizeOf(item: RawPage["items"][number]): number {
	if (item.height > 0) return item.height;

	const [, b, , d] = item.transform;
	const derived = Math.hypot(b, d);
	return derived > 0 ? derived : 0;
}

function buildSpans(page: RawPage): TextSpan[] {
	const spans: TextSpan[] = [];

	page.items.forEach((item, streamIndex) => {
		if (item.str.trim().length === 0) return;

		const fontSize = fontSizeOf(item);
		const [, , , , e, f] = item.transform;

		// PDF user space puts the origin bottom-left and `f` on the baseline; every consumer above
		// this file works in top-left points, so the flip happens once, here.
		const y = page.height - f - fontSize;

		spans.push({
			text: item.str,
			x: e,
			y,
			width: item.width,
			height: fontSize,
			fontRef: item.fontRef,
			fontSize,
			streamIndex,
		});
	});

	return spans;
}

function modalOf(values: readonly number[]): number | null {
	if (values.length === 0) return null;

	const counts = new Map<number, number>();
	for (const value of values) {
		// Bucket to a quarter point so 9.98 and 10.02 count as the same size.
		const key = Math.round(value * 4) / 4;
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}

	let best: number | null = null;
	let bestCount = -1;

	for (const [value, count] of [...counts.entries()].sort((a, b) => a[0] - b[0])) {
		if (count > bestCount) {
			best = value;
			bestCount = count;
		}
	}

	return best;
}

/**
 * Groups spans into lines by baseline proximity.
 *
 * Deliberately order-independent: spans are sorted by geometry with a text tiebreak, never by
 * their position in the content stream, so the same file yields the same lines however the
 * stream happened to be written. Stream order is measured separately, as inversion.
 */
function clusterLines(spans: readonly TextSpan[], pageNumber: number, tolerance: number): TextLine[] {
	const sorted = [...spans].sort((a, b) => a.y - b.y || a.x - b.x || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));

	const groups: TextSpan[][] = [];
	let current: TextSpan[] = [];
	let anchor = Number.NaN;

	for (const span of sorted) {
		if (current.length === 0 || Math.abs(span.y - anchor) <= tolerance) {
			if (current.length === 0) anchor = span.y;
			current.push(span);
			continue;
		}

		groups.push(current);
		current = [span];
		anchor = span.y;
	}

	if (current.length > 0) groups.push(current);

	return groups.map((group) => toLine(group, pageNumber));
}

function toLine(group: readonly TextSpan[], pageNumber: number): TextLine {
	const ordered = [...group].sort((a, b) => a.x - b.x || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));

	let text = "";
	let previous: TextSpan | null = null;

	for (const span of ordered) {
		if (previous) {
			const gap = span.x - (previous.x + previous.width);
			const threshold = SPACE_GAP_RATIO * Math.max(previous.fontSize, span.fontSize, 1);
			const needsSpace = gap > threshold && !/\s$/.test(text) && !/^\s/.test(span.text);
			if (needsSpace) text += " ";
		}

		text += span.text;
		previous = span;
	}

	const x = Math.min(...ordered.map((span) => span.x));
	const right = Math.max(...ordered.map((span) => span.x + span.width));
	const y = Math.min(...ordered.map((span) => span.y));
	const bottom = Math.max(...ordered.map((span) => span.y + span.height));

	const meanStreamIndex = ordered.reduce((total, span) => total + span.streamIndex, 0) / ordered.length;

	return {
		page: pageNumber,
		text,
		spans: ordered,
		x,
		y,
		width: right - x,
		height: bottom - y,
		fontSize: modalOf(ordered.map((span) => span.fontSize)) ?? 0,
		fontRef: dominantFontRef(ordered),
		meanStreamIndex,
	};
}

/** The font that sets the most characters on a line, so a stray glyph cannot claim the line. */
function dominantFontRef(spans: readonly TextSpan[]): string | null {
	const weights = new Map<string, number>();

	for (const span of spans) {
		if (!span.fontRef) continue;
		weights.set(span.fontRef, (weights.get(span.fontRef) ?? 0) + span.text.length);
	}

	let best: string | null = null;
	let bestWeight = 0;

	for (const [ref, weight] of [...weights.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
		if (weight > bestWeight) {
			best = ref;
			bestWeight = weight;
		}
	}

	return best;
}

/**
 * Share of adjacent line pairs whose stream order runs backwards against reading order.
 *
 * Single-column text threads at roughly zero. A two-column page whose columns are stored one
 * after the other alternates on every pair and lands near 0.5, which is precisely the file
 * whose extracted text comes out interleaved.
 */
function inversionRatioOf(lines: readonly TextLine[]): number {
	if (lines.length < 2) return 0;

	let inversions = 0;
	for (let index = 1; index < lines.length; index += 1) {
		const previous = lines[index - 1];
		const line = lines[index];
		if (!previous || !line) continue;
		if (line.meanStreamIndex < previous.meanStreamIndex) inversions += 1;
	}

	return inversions / (lines.length - 1);
}

/**
 * Looks for a full-height empty vertical band near the middle of the page.
 *
 * Built from spans rather than lines on purpose: baseline clustering merges spans that sit at
 * the same height in *different* columns into one line, whose box would span the gutter and
 * hide the very thing being looked for.
 */
function findGutter(spans: readonly TextSpan[], page: RawPage): ColumnGutter | null {
	if (spans.length < 12 || page.width <= 0 || page.height <= 0) return null;

	const binCount = Math.max(1, Math.ceil(page.width / HISTOGRAM_BIN_PT));
	const occupied = new Array<boolean>(binCount).fill(false);

	for (const span of spans) {
		const from = Math.max(0, Math.floor(span.x / HISTOGRAM_BIN_PT));
		const to = Math.min(binCount - 1, Math.floor((span.x + span.width) / HISTOGRAM_BIN_PT));
		for (let bin = from; bin <= to; bin += 1) occupied[bin] = true;
	}

	const textLeft = Math.min(...spans.map((span) => span.x));
	const textRight = Math.max(...spans.map((span) => span.x + span.width));
	const textWidth = textRight - textLeft;
	if (textWidth <= 0) return null;

	const searchFrom = Math.floor((textLeft + textWidth * GUTTER_SEARCH_MIN) / HISTOGRAM_BIN_PT);
	const searchTo = Math.ceil((textLeft + textWidth * GUTTER_SEARCH_MAX) / HISTOGRAM_BIN_PT);

	let best: { start: number; end: number } | null = null;
	let runStart: number | null = null;

	for (let bin = Math.max(0, searchFrom); bin <= Math.min(binCount - 1, searchTo); bin += 1) {
		if (!occupied[bin]) {
			runStart ??= bin;
			continue;
		}

		if (runStart !== null) {
			if (!best || bin - runStart > best.end - best.start) best = { start: runStart, end: bin };
			runStart = null;
		}
	}

	if (runStart !== null) {
		const end = Math.min(binCount, searchTo + 1);
		if (!best || end - runStart > best.end - best.start) best = { start: runStart, end };
	}

	if (!best) return null;

	const x = best.start * HISTOGRAM_BIN_PT;
	const width = (best.end - best.start) * HISTOGRAM_BIN_PT;
	if (width < MIN_GUTTER_WIDTH_PT) return null;

	const bandLeft = x;
	const bandRight = x + width;

	const rowCount = Math.max(1, Math.ceil(page.height / ROW_BIN_PT));
	const rowHasText = new Array<boolean>(rowCount).fill(false);
	const rowCrossesBand = new Array<boolean>(rowCount).fill(false);

	let leftSpans = 0;
	let rightSpans = 0;

	for (const span of spans) {
		const from = Math.max(0, Math.floor(span.y / ROW_BIN_PT));
		const to = Math.min(rowCount - 1, Math.floor((span.y + span.height) / ROW_BIN_PT));
		const crosses = span.x < bandRight && span.x + span.width > bandLeft;

		for (let row = from; row <= to; row += 1) {
			rowHasText[row] = true;
			if (crosses) rowCrossesBand[row] = true;
		}

		if (span.x + span.width <= bandLeft) leftSpans += 1;
		else if (span.x >= bandRight) rightSpans += 1;
	}

	const textRows = rowHasText.filter(Boolean).length;
	if (textRows === 0) return null;

	const crossedRows = rowCrossesBand.filter(Boolean).length;
	const coverage = 1 - crossedRows / textRows;

	const sided = leftSpans + rightSpans;
	const splitRatio = sided === 0 ? 0 : Math.min(leftSpans, rightSpans) / sided;

	return { x, width, coverage, splitRatio };
}

/**
 * Splits a clustered line at column-sized gaps between its spans.
 *
 * Baseline clustering joins every span that shares a baseline however far apart the spans sit,
 * which is what a heading set in its own narrow column looks like beside the section's first
 * content line ("Profiles GitHub"). The pieces are still analysed as one line everywhere else;
 * this view exists for consumers that need the column-separated parts.
 */
export function columnSegments(line: TextLine): TextLine[] {
	const [first, ...rest] = line.spans;
	if (!first || rest.length === 0) return [line];

	const groups: TextSpan[][] = [[first]];
	let previous = first;
	for (const span of rest) {
		const gap = span.x - (previous.x + previous.width);
		const threshold = Math.max(MIN_COLUMN_GAP_PT, COLUMN_GAP_RATIO * Math.max(previous.fontSize, span.fontSize, 1));

		if (gap > threshold) groups.push([span]);
		else groups[groups.length - 1]?.push(span);
		previous = span;
	}

	if (groups.length === 1) return [line];

	return groups.map((group) => toLine(group, line.page));
}

/**
 * Robust order statistic. Margins are measured at the 5th and 95th percentile rather than at the
 * extremes because a single right-aligned run whose reported width overshoots by a few points
 * would otherwise report a two-point margin on a page that plainly has sixteen.
 */
function percentile(values: readonly number[], fraction: number): number {
	if (values.length === 0) return 0;

	const sorted = [...values].sort((a, b) => a - b);
	const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)));
	return sorted[index] ?? 0;
}

function buildPage(page: RawPage, tolerance: number): PageGeometry {
	const spans = buildSpans(page);
	const lines = clusterLines(spans, page.pageNumber, tolerance);

	const margins =
		spans.length === 0
			? { top: 0, right: 0, bottom: 0, left: 0 }
			: {
					top: percentile(
						spans.map((span) => span.y),
						MARGIN_PERCENTILE,
					),
					left: percentile(
						spans.map((span) => span.x),
						MARGIN_PERCENTILE,
					),
					right:
						page.width -
						percentile(
							spans.map((span) => span.x + span.width),
							1 - MARGIN_PERCENTILE,
						),
					bottom:
						page.height -
						percentile(
							spans.map((span) => span.y + span.height),
							1 - MARGIN_PERCENTILE,
						),
				};

	const pageArea = page.width * page.height;
	const lineArea = lines.reduce((total, line) => total + Math.max(0, line.width) * Math.max(0, line.height), 0);

	return {
		pageNumber: page.pageNumber,
		width: page.width,
		height: page.height,
		lines,
		inversionRatio: inversionRatioOf(lines),
		gutter: findGutter(spans, page),
		margins,
		textAreaRatio: pageArea > 0 ? Math.min(1, lineArea / pageArea) : 0,
	};
}

/**
 * Derives page geometry from a raw extraction. Pure: the same bytes always produce the same
 * document, whatever order the reader happened to emit text items in.
 */
export function buildExtractedDocument(raw: RawExtraction): ExtractedDocument {
	const allFontSizes = raw.pages.flatMap((page) => page.items.filter((item) => item.str.trim()).map(fontSizeOf));
	const modalFontSize = modalOf(allFontSizes.filter((size) => size > 0));
	const tolerance = Math.max(MIN_LINE_TOLERANCE_PT, LINE_TOLERANCE_RATIO * (modalFontSize ?? MIN_LINE_TOLERANCE_PT));

	const pages = raw.pages.map((page) => buildPage(page, tolerance));
	const lines = pages.flatMap((page) => page.lines);

	const fullText = pages.map((page) => page.lines.map((line) => line.text).join("\n")).join("\n\n");
	const words = fullText.split(/\s+/).filter(Boolean);

	const fontRefs = new Set<string>();
	const fontWeights = new Map<string, number>();

	for (const page of raw.pages) {
		for (const item of page.items) {
			if (!item.fontRef) continue;
			fontRefs.add(item.fontRef);
			fontWeights.set(item.fontRef, (fontWeights.get(item.fontRef) ?? 0) + item.str.trim().length);
		}
	}

	const modalFontRef =
		[...fontWeights.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;

	return {
		pages,
		lines,
		fullText,
		charCount: fullText.length,
		wordCount: words.length,
		modalFontSize,
		modalFontRef,
		distinctFontRefs: fontRefs.size,
	};
}
