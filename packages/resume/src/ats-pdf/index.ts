import type { PdfRuleCode } from "./catalog";
import type {
	PdfAtsReport,
	PdfCheck,
	PdfCheckContext,
	PdfCheckResult,
	PdfFinding,
	PdfSeverity,
	RawExtraction,
} from "./types";
import { buildResumeSemantics } from "./analyze/semantics";
import { pdfRuleCategory, pdfRuleSeverity } from "./catalog";
import { buildExtractedDocument } from "./extract";
import { matchJobDescription } from "./jd/match";
import { locateEvidence } from "./locate";
import { PDF_CHECKS } from "./rules";
import { scoreChecks } from "./score";

export type AnalyzePdfOptions = {
	/** Injected so a report is reproducible: the same bytes and the same clock give the same report. */
	now?: Date;
	/** When present, keyword coverage is computed and reported alongside — never inside — the score. */
	jobDescription?: string;
};

const SEVERITY_ORDER: Readonly<Record<PdfSeverity, number>> = { blocker: 0, warning: 1, tip: 2 };

const CATEGORY_ORDER = ["parseability", "layout", "sections", "contact", "dates", "content"] as const;

function compareFindings(a: PdfFinding, b: PdfFinding): number {
	const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
	if (bySeverity !== 0) return bySeverity;

	const byCategory = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
	if (byCategory !== 0) return byCategory;

	return a.code.localeCompare(b.code);
}

/**
 * Runs one check, and treats a thrown error as "could not run" rather than letting it take the
 * report down. Real files are stranger than any fixture, and a report missing one row is worth
 * far more to the person holding the file than no report at all.
 */
function runCheck(check: PdfCheck, context: PdfCheckContext): PdfCheckResult {
	const base = {
		code: check.code,
		category: pdfRuleCategory(check.code),
		severity: pdfRuleSeverity(check.code),
	} as const;

	let outcome: ReturnType<PdfCheck["run"]>;
	try {
		outcome = check.run(context);
	} catch {
		return { ...base, status: "skip", skipReason: "insufficient-data", findings: [] };
	}

	if (outcome.status === "pass") return { ...base, status: "pass", findings: [] };
	if (outcome.status === "skip") return { ...base, status: "skip", skipReason: outcome.reason, findings: [] };

	return { ...base, status: "fail", findings: outcome.findings };
}

function hiddenTextPresent(raw: RawExtraction): boolean {
	if (!raw.operatorsAvailable) return false;

	return raw.pages.some(
		(page) => (page.operators?.invisibleTextItems ?? 0) > 0 || (page.operators?.whiteFillTextItems ?? 0) > 0,
	);
}

/**
 * Turns a raw PDF extraction into an ATS report.
 *
 * What this measures is whether software can recover the facts on the page. It does not predict
 * whether an application will be rejected, and nothing in the report should be read as if it
 * could — no tool has that information.
 */
export function analyzePdfResume(raw: RawExtraction, options: AnalyzePdfOptions = {}): PdfAtsReport {
	const now = options.now ?? new Date();

	const doc = buildExtractedDocument(raw);
	const semantics = buildResumeSemantics(raw, doc, { now });

	const context: PdfCheckContext = { raw, doc, semantics, now };
	const checks = PDF_CHECKS.map((check) => runCheck(check, context));

	const allFindings = checks
		.flatMap((result) => result.findings)
		.map((finding) => {
			const evidence = locateEvidence(doc, finding.evidence);
			return evidence ? { ...finding, evidence } : finding;
		})
		.sort(compareFindings);
	const breakdown = scoreChecks(checks);

	const counts: Record<PdfSeverity, number> = { blocker: 0, warning: 0, tip: 0 };
	for (const result of checks) {
		if (result.status === "fail") counts[result.severity] += 1;
	}

	const jobDescription = options.jobDescription?.trim();

	return {
		version: 1,
		score: breakdown.score,
		cappedBy: breakdown.cappedBy,
		categories: breakdown.categories,
		checks,
		findings: allFindings.filter((finding) => finding.severity !== "tip"),
		tips: allFindings.filter((finding) => finding.severity === "tip"),
		counts,
		applicableChecks: breakdown.applicableChecks,
		passedChecks: breakdown.passedChecks,
		skippedChecks: breakdown.skippedChecks,
		jd: jobDescription
			? matchJobDescription({
					jobDescription,
					resumeText: doc.fullText,
					documentHasHiddenText: hiddenTextPresent(raw),
				})
			: null,
		file: raw.file,
		document: {
			pageCount: raw.pageCount,
			truncated: raw.truncated,
			wordCount: doc.wordCount,
			operatorsAvailable: raw.operatorsAvailable,
		},
	};
}

export type { HarvestOptions, HarvestProgress, PdfDocumentLike, PdfPageLike } from "./harvest";
export type {
	ContactEntities,
	DetectedHeading,
	ExtractedDocument,
	JdMatchReport,
	JdTermMatch,
	PdfAtsReport,
	PdfCategory,
	PdfCategoryScore,
	PdfCheckResult,
	PdfEvidence,
	PdfFinding,
	PdfFindingParams,
	PdfSeverity,
	PdfSkipReason,
	RawExtraction,
	RawPage,
	RawTextItem,
	ResumeSemantics,
	TextLine,
} from "./types";
export type { PdfRuleCode };
export { buildResumeSemantics } from "./analyze/semantics";
export { PDF_ATS_RULE_CODES } from "./catalog";
export { buildExtractedDocument } from "./extract";
export { HARVEST_DEFAULTS, harvestPdfDocument } from "./harvest";
export { surfaceFormsOf } from "./jd/aliases";
export { matchJobDescription } from "./jd/match";
export { PDF_OPS } from "./pdf-ops";
