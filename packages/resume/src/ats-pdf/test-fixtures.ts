import type { PageOperatorSummary, RawExtraction, RawFont, RawLinkAnnotation, RawPage, RawTextItem } from "./types";

/**
 * Builders for raw extractions, used by the engine's tests.
 *
 * A fixture describes lines in reading order with a top-left origin, which is how a person thinks
 * about a page; the builder flips them into the bottom-left PDF space the real reader emits, so
 * the tests exercise the same coordinate conversion production does.
 */

const A4 = { width: 595.28, height: 841.89 } as const;

export type FixtureLine = {
	text: string;
	/** Left edge in points. */
	x?: number;
	/** Distance from the top of the page in points. */
	y?: number;
	size?: number;
	page?: number;
	/** Split the line into one item per character, as a badly letter-spaced export would. */
	perCharacter?: boolean;
	fontRef?: string;
};

type FixturePageOptions = {
	rotation?: number;
	operators?: Partial<PageOperatorSummary> | null;
	width?: number;
	height?: number;
};

export type FixtureOptions = {
	lines?: readonly (string | FixtureLine)[];
	pageCount?: number;
	pages?: Readonly<Record<number, FixturePageOptions>>;
	fonts?: readonly Partial<RawFont>[];
	links?: readonly Partial<RawLinkAnnotation>[];
	metadata?: Partial<RawExtraction["metadata"]>;
	file?: Partial<RawExtraction["file"]>;
	operatorsAvailable?: boolean;
	truncated?: boolean;
	/** Emit items in a deliberately different order than they read; used for inversion tests. */
	streamOrder?: (lines: readonly FixtureLine[]) => readonly FixtureLine[];
};

const DEFAULT_SIZE = 10;
const DEFAULT_X = 56;
const FIRST_LINE_Y = 60;
const LINE_STEP = 14;

const CHARACTER_WIDTH_RATIO = 0.5;

function toFixtureLine(line: string | FixtureLine, index: number): FixtureLine {
	const base = typeof line === "string" ? { text: line } : line;
	return {
		x: DEFAULT_X,
		y: FIRST_LINE_Y + index * LINE_STEP,
		size: DEFAULT_SIZE,
		page: 1,
		fontRef: "g_d0_f1",
		...base,
	};
}

function toItems(line: FixtureLine, pageHeight: number): RawTextItem[] {
	const size = line.size ?? DEFAULT_SIZE;
	const x = line.x ?? DEFAULT_X;
	const y = line.y ?? FIRST_LINE_Y;
	const baseline = pageHeight - y - size;
	const charWidth = size * CHARACTER_WIDTH_RATIO;

	const item = (text: string, offset: number): RawTextItem => ({
		str: text,
		transform: [size, 0, 0, size, x + offset, baseline],
		width: text.length * charWidth,
		height: size,
		fontRef: line.fontRef ?? "g_d0_f1",
		hasEol: false,
	});

	if (!line.perCharacter) return [item(line.text, 0)];

	return [...line.text].map((character, index) => item(character, index * charWidth));
}

const defaultOperators = (): PageOperatorSummary => ({
	imageAreaRatio: 0,
	imageCount: 0,
	pathOpCount: 0,
	invisibleTextItems: 0,
	whiteFillTextItems: 0,
});

export function makeRawExtraction(options: FixtureOptions = {}): RawExtraction {
	const lines = (options.lines ?? []).map(toFixtureLine);
	const ordered = options.streamOrder ? options.streamOrder(lines) : lines;

	const pageNumbers = new Set<number>([1, ...lines.map((line) => line.page ?? 1)]);
	const pageCount = options.pageCount ?? Math.max(...pageNumbers);

	const pages: RawPage[] = [];

	for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
		const pageOptions = options.pages?.[pageNumber] ?? {};
		const width = pageOptions.width ?? A4.width;
		const height = pageOptions.height ?? A4.height;

		const items = ordered.filter((line) => (line.page ?? 1) === pageNumber).flatMap((line) => toItems(line, height));

		pages.push({
			pageNumber,
			width,
			height,
			rotation: pageOptions.rotation ?? 0,
			items,
			operators: pageOptions.operators === null ? null : { ...defaultOperators(), ...pageOptions.operators },
		});
	}

	return {
		version: 1,
		file: { name: "resume.pdf", sizeBytes: 180_000, magicBytesOk: true, ...options.file },
		pageCount,
		truncated: options.truncated ?? false,
		pages,
		fonts: (options.fonts ?? [{}]).map((font, index) => ({
			ref: `g_d0_f${index + 1}`,
			name: "AAAAAA+Inter",
			isType3: false,
			isInvalid: false,
			missingFile: false,
			isMonospace: false,
			isSerif: false,
			vertical: false,
			...font,
		})),
		links: (options.links ?? []).map((link) => ({ page: 1, url: null, rect: [0, 0, 0, 0], ...link })),
		metadata: {
			producer: "Reactive Resume",
			creator: "Reactive Resume",
			title: null,
			author: null,
			language: "en-GB",
			pdfVersion: "1.7",
			isEncrypted: false,
			isXfa: false,
			isCollection: false,
			isTagged: true,
			hasAcroForm: false,
			...options.metadata,
		},
		operatorsAvailable: options.operatorsAvailable ?? true,
	};
}

/**
 * A resume that should pass essentially everything: single column, conventional headings,
 * complete contact block, dated roles, quantified bullets.
 */
export const healthyResumeLines: readonly (string | FixtureLine)[] = [
	{ text: "Ada Lovelace", size: 20 },
	"ada@example.com · +44 20 7946 0100 · London, UK",
	"https://github.com/adalovelace",
	{ text: "SUMMARY", size: 12, fontRef: "g_d0_f2" },
	"Analytical engineer who builds calculation systems and leads small teams.",
	"Ten years designing programmes for mechanical computers and their operators.",
	{ text: "EXPERIENCE", size: 12, fontRef: "g_d0_f2" },
	"Principal Engineer | Analytical Engines, London",
	"Jan 2020 - Present",
	"• Delivered a note-taking programme that cut calculation time by 40%.",
	"• Led a team of 6 engineers through a migration to punched-card storage.",
	"• Reduced operator error rates from 12% to under 3% across 400 runs.",
	"• Published 5 papers describing the engine's programming model.",
	"Senior Engineer | Difference Works, London",
	"Mar 2015 - Dec 2019",
	"• Built the first working prototype of the tabulating unit.",
	"• Trained 30 operators and wrote the reference manual they still use.",
	{ text: "EDUCATION", size: 12, fontRef: "g_d0_f2" },
	"University of London | Mathematics",
	"Sep 2011 - Jun 2015",
	{ text: "SKILLS", size: 12, fontRef: "g_d0_f2" },
	"Algorithms, numerical analysis, technical writing, mentoring, JavaScript",
	"Punched-card systems, mechanical computation, statistics, technical review",
	{ text: "PROJECTS", size: 12 },
	"Note G | Bernoulli number programme",
	"Sep 2018 - Mar 2019",
	"• Wrote the first published algorithm intended for a machine to execute.",
	"• Documented 8 subroutines and the operand table each of them depends on.",
	{ text: "PUBLICATIONS", size: 12 },
	"Sketch of the Analytical Engine, with notes by the translator, 1843",
	"Observations on the tabulating unit and its operating characteristics, 1841",
	{ text: "AWARDS", size: 12 },
	"Royal Society commendation for contributions to mechanical computation, 2019",
];

export function healthyResume(overrides: FixtureOptions = {}): RawExtraction {
	return makeRawExtraction({ lines: healthyResumeLines, ...overrides });
}

/**
 * A two-column resume whose content stream stores the left column in full before the right.
 *
 * This is the shape that actually extracts out of order, and the one both layout blockers are
 * written against: a clear gutter *and* a stream that threads against reading order.
 */
export function twoColumnResume(overrides: FixtureOptions = {}): RawExtraction {
	const left = [
		"Ada Lovelace",
		"Principal Engineer, London",
		"EXPERIENCE",
		"Analytical Engines | London",
		"Jan 2020 - Present",
		"• Delivered the note-taking programme.",
		"• Led six engineers through migration.",
		"Difference Works | London",
		"Mar 2015 - Dec 2019",
		"• Built the tabulating prototype.",
		"EDUCATION",
		"University of London",
		"Sep 2011 - Jun 2015",
	];

	const right = [
		"CONTACT",
		"ada@example.com",
		"+44 20 7946 0100",
		"SKILLS",
		"Algorithms",
		"Numerical analysis",
		"Technical writing",
		"Mentoring",
		"LANGUAGES",
		"English, French",
		"AWARDS",
		"Royal Society, 2019",
		"INTERESTS",
	];

	const lines: FixtureLine[] = [
		...left.map((text, index) => ({ text, x: 56, y: 60 + index * 22, size: 10 })),
		// Offset so the two columns never share a baseline; real two-column layouts rarely do.
		...right.map((text, index) => ({ text, x: 340, y: 71 + index * 22, size: 10 })),
	];

	return makeRawExtraction({ lines, ...overrides });
}

/** A scan: near-total image coverage with no text layer behind it. */
export function scannedResume(overrides: FixtureOptions = {}): RawExtraction {
	return makeRawExtraction({
		lines: [],
		pages: { 1: { operators: { imageAreaRatio: 0.97, imageCount: 1 } } },
		metadata: { isTagged: false, language: null },
		...overrides,
	});
}
