import type { ExtractedDocument } from "@reactive-resume/resume/ats-pdf";

/**
 * Turns a PDF into the plain lines `parseResumeText` reads.
 *
 * The extraction itself is the ATS checker's — same worker configuration, same size and password
 * guards, same font-relative line clustering and column-gutter detection. Only the joining differs:
 * the ATS text is prose, while the importer splits header rows on runs of two or more spaces, so a
 * tabbed "Company    Role    Location" has to survive as three fields rather than one phrase.
 */

/** Horizontal gap, relative to font size, above which two spans are separate header fields. */
const FIELD_GAP_RATIO = 1.5;
/** Narrower gaps are still a word break; matches the ratio the ATS extractor joins prose with. */
const SPACE_GAP_RATIO = 0.25;

/** The evidence the ATS layout rules require before calling a page two-column. */
const GUTTER_COVERAGE = 0.85;
const GUTTER_SPLIT_RATIO = 0.25;

type PageGeometry = ExtractedDocument["pages"][number];
type TextSpan = PageGeometry["lines"][number]["spans"][number];

function joinSpans(spans: readonly TextSpan[]): string {
	let text = "";
	let previous: TextSpan | null = null;

	for (const span of spans) {
		if (previous) {
			const gap = span.x - (previous.x + previous.width);
			const fontSize = Math.max(previous.fontSize, span.fontSize, 1);

			if (gap > FIELD_GAP_RATIO * fontSize) text += "  ";
			else if (gap > SPACE_GAP_RATIO * fontSize && !/\s$/.test(text) && !/^\s/.test(span.text)) text += " ";
		}

		text += span.text;
		previous = span;
	}

	return text.trim();
}

/** Mid-point of a convincing gutter, or null on a page that reads as one column. */
function columnSplitX(page: PageGeometry): number | null {
	const gutter = page.gutter;
	if (!gutter || gutter.coverage < GUTTER_COVERAGE || gutter.splitRatio < GUTTER_SPLIT_RATIO) return null;

	return gutter.x + gutter.width / 2;
}

/**
 * Lines grouped by baseline alone interleave a sidebar with the body, which drops a whole work
 * history into the skills section. On a two-column page each column is read out in full instead.
 */
function pageToLines(page: PageGeometry): string[] {
	const splitX = columnSplitX(page);
	if (splitX === null) return page.lines.map((line) => joinSpans(line.spans));

	const left: string[] = [];
	const right: string[] = [];

	for (const line of page.lines) {
		const leftSpans = line.spans.filter((span) => span.x + span.width / 2 < splitX);
		if (leftSpans.length > 0) left.push(joinSpans(leftSpans));

		const rightSpans = line.spans.filter((span) => span.x + span.width / 2 >= splitX);
		if (rightSpans.length > 0) right.push(joinSpans(rightSpans));
	}

	return [...left, ...right];
}

export function documentToLines(doc: ExtractedDocument): string[] {
	return doc.pages.flatMap(pageToLines).filter((line) => line.length > 0);
}
