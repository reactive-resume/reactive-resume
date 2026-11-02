import type { PdfAtsReport } from "./types";

export type PdfVerdict = "clean" | "mostly" | "hard";

/**
 * The headline for a report, agreeing with what's listed under it: "reads cleanly" only with nothing to fix and a
 * high score, "hard to read" below 50. The tone colours the score ring: accent, warn, then danger.
 */
export function pdfVerdict(report: Pick<PdfAtsReport, "score" | "findings">): {
	verdict: PdfVerdict;
	tone: "accent" | "warn" | "danger";
} {
	if (report.score >= 80 && report.findings.length === 0) return { verdict: "clean", tone: "accent" };
	if (report.score >= 50) return { verdict: "mostly", tone: report.score >= 80 ? "accent" : "warn" };
	return { verdict: "hard", tone: "danger" };
}
