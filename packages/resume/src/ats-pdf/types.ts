import type { PdfRuleCode } from "./catalog";
import type { CustomSectionType } from "@reactive-resume/schema/resume/data";

// ---------------------------------------------------------------------------
// Layer 1 — RawExtraction: what a PDF reader hands us, unmassaged.
//
// Everything here is plain serializable JSON so the same payload can be produced
// by pdf.js in a browser today and by a server-side adapter later.
// ---------------------------------------------------------------------------

/** [a, b, c, d, e, f] — the PDF text matrix; e/f are the device-space origin. */
type TextTransform = readonly [number, number, number, number, number, number];

export type RawTextItem = {
	/** The string exactly as the reader produced it (normalization disabled). */
	str: string;
	transform: TextTransform;
	width: number;
	height: number;
	/** Reader-internal font reference; keys into {@link RawExtraction.fonts}. */
	fontRef: string;
	hasEol: boolean;
};

/**
 * Font facts read from the font object itself, never from `TextContent.styles`,
 * which reports a synthesised CSS family rather than the embedded font.
 */
export type RawFont = {
	ref: string;
	/** Real PostScript name, e.g. `ABCDEE+Calibri`. Null when the reader could not resolve one. */
	name: string | null;
	isType3: boolean;
	/** The reader could not build a usable font from the file's font program. */
	isInvalid: boolean;
	/** The font program itself is absent, so glyphs render from a substitute. */
	missingFile: boolean;
	isMonospace: boolean | null;
	isSerif: boolean | null;
	vertical: boolean | null;
};

export type RawLinkAnnotation = {
	page: number;
	url: string | null;
	/** [x1, y1, x2, y2] in PDF user space (origin bottom-left). */
	rect: readonly [number, number, number, number];
};

/**
 * Per-page content-stream facts. Null on a page whose operator pass was skipped
 * or timed out — every check that reads it must skip rather than guess.
 */
export type PageOperatorSummary = {
	/** Fraction of the page box covered by images and image masks, clamped to [0, 1]. */
	imageAreaRatio: number;
	imageCount: number;
	pathOpCount: number;
	/** Text drawn with rendering mode 3 (invisible) — the OCR-layer / keyword-stuffing signal. */
	invisibleTextItems: number;
	/** Text filled with pure white, which reads as hidden to a human but not to a parser. */
	whiteFillTextItems: number;
};

type RawMetadata = {
	producer: string | null;
	creator: string | null;
	title: string | null;
	author: string | null;
	language: string | null;
	pdfVersion: string | null;
	isEncrypted: boolean;
	isXfa: boolean;
	/** A PDF Portfolio / collection: the visible page is a cover, the real files are attachments. */
	isCollection: boolean;
	isTagged: boolean;
	hasAcroForm: boolean;
};

export type RawExtraction = {
	version: 1;
	file: {
		name: string;
		sizeBytes: number;
		/** The file really begins with `%PDF-`. */
		magicBytesOk: boolean;
	};
	pageCount: number;
	/** True when only the first N pages were harvested. */
	truncated: boolean;
	pages: readonly RawPage[];
	fonts: readonly RawFont[];
	links: readonly RawLinkAnnotation[];
	metadata: RawMetadata;
	/** False when the operator pass was skipped entirely (budget, error, adapter without support). */
	operatorsAvailable: boolean;
};

export type RawPage = {
	pageNumber: number;
	width: number;
	height: number;
	rotation: number;
	items: readonly RawTextItem[];
	operators: PageOperatorSummary | null;
};

// ---------------------------------------------------------------------------
// Layer 2 — ExtractedDocument: geometry derived purely from the raw extraction.
// Coordinates are normalized to a top-left origin, in points.
// ---------------------------------------------------------------------------

type BoundingBox = { x: number; y: number; width: number; height: number };

export type TextSpan = BoundingBox & {
	text: string;
	fontRef: string;
	fontSize: number;
	/** Index of the source item in the page's stream order. */
	streamIndex: number;
};

export type TextLine = BoundingBox & {
	page: number;
	text: string;
	spans: readonly TextSpan[];
	/** Modal font size across the line's spans. */
	fontSize: number;
	/** Font ref carrying the most characters on this line. */
	fontRef: string | null;
	/** Mean stream index of the line's spans — used to score reading-order inversion. */
	meanStreamIndex: number;
};

export type ColumnGutter = {
	/** Left edge of the empty vertical band, in points from the page's left edge. */
	x: number;
	width: number;
	/** Fraction of the text-bearing height the band stays empty for, in [0, 1]. */
	coverage: number;
	/**
	 * How evenly the two sides are populated, in [0, 0.5]: the lighter side's share of the spans
	 * that sit wholly on one side or the other. Near 0.5 means a genuine two-column page; near 0
	 * means one wide column with a stub beside it.
	 */
	splitRatio: number;
};

export type PageGeometry = {
	pageNumber: number;
	width: number;
	height: number;
	lines: readonly TextLine[];
	/**
	 * Share of adjacent line pairs whose stream order disagrees with geometric order,
	 * in [0, 1]. A single-column page threads at ~0.
	 */
	inversionRatio: number;
	gutter: ColumnGutter | null;
	margins: { top: number; right: number; bottom: number; left: number };
	/** Fraction of the page box covered by line boxes. */
	textAreaRatio: number;
};

export type ExtractedDocument = {
	pages: readonly PageGeometry[];
	/** All lines across all pages, in geometric reading order. */
	lines: readonly TextLine[];
	/** Geometric-order text, one line per line, pages separated by a blank line. */
	fullText: string;
	charCount: number;
	wordCount: number;
	/** Modal body font size in points, or null when nothing was measurable. */
	modalFontSize: number | null;
	/** The font most of the body is set in. A heading in a different font is a weight change. */
	modalFontRef: string | null;
	distinctFontRefs: number;
};

// ---------------------------------------------------------------------------
// Layer 3 — ResumeSemantics: resume meaning read off the extracted geometry.
// ---------------------------------------------------------------------------

export type DetectedHeading = {
	text: string;
	normalized: string;
	sectionType: CustomSectionType | null;
	page: number;
	/** Index into {@link ExtractedDocument.lines}. */
	lineIndex: number;
	fontSize: number;
	/** The heading stands out from body text by size, case, or weight. */
	distinguished: boolean;
};

export type ContactEntities = {
	emails: readonly string[];
	phones: readonly string[];
	/** URLs found in the text itself. */
	textUrls: readonly string[];
	/** URLs found in link annotations. */
	annotationUrls: readonly string[];
	/** Best-guess candidate name line, from the top of page 1. */
	nameLine: string | null;
	locationLine: string | null;
	/** True when an address looks split across text items mid-token (a garble signal). */
	emailLooksSplit: boolean;
	/** Links whose visible text names a different destination than the annotation actually targets. */
	linkMismatches: readonly { shown: string; target: string }[];
};

export type DateToken = {
	raw: string;
	page: number;
	lineIndex: number;
	kind: "range" | "single";
	/** False when the token looks like a date but no recognised format matched it. */
	parsed: boolean;
	/** The range ends in a "Present"-style token. */
	ongoing: boolean;
	startYear: number | null;
	endYear: number | null;
	reversed: boolean;
	future: boolean;
	/** Coarse shape label, used to spot a resume mixing several date formats. */
	shape: "mon-year" | "numeric" | "year";
};

export type TextQuality = {
	tokenCount: number;
	/** U+FFFD share of all characters. */
	replacementRatio: number;
	/** Private-use-area (U+E000–U+F8FF) share of all characters. */
	puaRatio: number;
	ligatureCount: number;
	/** Share of alphabetic tokens with no vowel — only meaningful once English is detected. */
	vowellessRatio: number;
	/** Share of tokens present in the embedded common-word lexicon. */
	lexiconHitRatio: number;
	/** The document reads as English, so lexicon-based signals may be trusted. */
	isEnglish: boolean;
	/** Share of alphabetic tokens longer than 24 characters — lost word spacing. */
	runOnTokenRatio: number;
	/** Share of text items that carry exactly one character — lost character spacing. */
	singleCharItemRatio: number;
};

export type ResumeSemantics = {
	headings: readonly DetectedHeading[];
	/** Section types the headings identified, deduplicated. */
	sectionTypes: readonly CustomSectionType[];
	contact: ContactEntities;
	dates: readonly DateToken[];
	quality: TextQuality;
	bulletLineCount: number;
	/** Lines that look like `Company — Location` or `Title, Company`. */
	roleLikeLineCount: number;
	allCapsLineCount: number;
	quantifiedBulletCount: number;
	actionVerbBulletCount: number;
	firstPersonCount: number;
	longBulletCount: number;
	/** Ranges that look like dates but matched no recognised format. */
	unparseableRanges: readonly string[];
	/** Numeric dates such as 03/04/2022, which read differently by region. */
	ambiguousNumericDates: readonly string[];
	/** Gaps of more than a year between the end of one dated role and the start of the next. */
	employmentGapYears: readonly { from: number; to: number }[];
	/** Bullet openings that repeat verbatim across the document. */
	repeatedBulletOpenings: readonly string[];
	/** Lines repeated in the same margin zone on every page. */
	repeatedRunningHeads: readonly string[];
};

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export type PdfCategory = "parseability" | "layout" | "sections" | "contact" | "dates" | "content";

export type PdfSeverity = "blocker" | "warning" | "tip";

export type PdfFindingParams = Readonly<Record<string, string | number>>;

export type PdfEvidence = {
	/** Verbatim text from the file that demonstrates the finding. */
	snippet?: string;
	page?: number;
	box?: BoundingBox;
};

export type PdfFinding = {
	code: PdfRuleCode;
	severity: PdfSeverity;
	category: PdfCategory;
	params?: PdfFindingParams;
	evidence?: PdfEvidence;
};

/**
 * Tri-state so the report can state a truthful denominator: a check that could
 * not run (no operator pass, no text at all, non-English document) is neither a
 * pass nor a failure.
 */
export type PdfCheckOutcome =
	| { status: "pass" }
	| { status: "skip"; reason: PdfSkipReason }
	| { status: "fail"; findings: readonly PdfFinding[] };

export type PdfSkipReason =
	| "no-text"
	| "no-operators"
	| "not-english"
	| "not-applicable"
	| "encrypted"
	| "insufficient-data";

export type PdfCheckContext = {
	raw: RawExtraction;
	doc: ExtractedDocument;
	semantics: ResumeSemantics;
	now: Date;
};

export type PdfCheck = {
	code: PdfRuleCode;
	run: (context: PdfCheckContext) => PdfCheckOutcome;
};

export type PdfCheckResult = {
	code: PdfRuleCode;
	category: PdfCategory;
	severity: PdfSeverity;
	status: "pass" | "skip" | "fail";
	skipReason?: PdfSkipReason;
	findings: readonly PdfFinding[];
};

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export type PdfCategoryScore = {
	category: Exclude<PdfCategory, "content">;
	/** 0–100 integer. */
	score: number;
	/** Contribution to the overall score, in percent. */
	weight: number;
	applicableChecks: number;
	passedChecks: number;
	skippedChecks: number;
};

export type JdTermMatch = {
	term: string;
	jdCount: number;
	resumeCount: number;
	weight: number;
};

export type JdMatchReport = {
	/** Terms extracted from the job description, most important first. */
	terms: readonly JdTermMatch[];
	matchedTerms: readonly string[];
	missingTerms: readonly string[];
	totalTerms: number;
	matchedCount: number;
	/** Weighted coverage in [0, 1]. Never folded into the parse score. */
	weightedCoverage: number;
	/** Terms repeated far more often than the posting itself uses them. */
	stuffedTerms: readonly string[];
	/**
	 * The file draws text a reader cannot see, so a match here may be against hidden text.
	 * Which specific term matched invisibly is not knowable from an operator summary, and this
	 * report does not pretend otherwise.
	 */
	documentHasHiddenText: boolean;
};

export type PdfAtsReport = {
	version: 1;
	/** 0–100 integer. Blockers cap it; nothing rounds up past a cap. */
	score: number;
	/** Rule codes whose caps bound the overall score, most severe first. */
	cappedBy: readonly PdfRuleCode[];
	categories: readonly PdfCategoryScore[];
	checks: readonly PdfCheckResult[];
	findings: readonly PdfFinding[];
	/** Unscored content advice, kept out of every score. */
	tips: readonly PdfFinding[];
	counts: Readonly<Record<PdfSeverity, number>>;
	applicableChecks: number;
	passedChecks: number;
	skippedChecks: number;
	jd: JdMatchReport | null;
	file: RawExtraction["file"];
	document: {
		pageCount: number;
		truncated: boolean;
		wordCount: number;
		operatorsAvailable: boolean;
	};
};
