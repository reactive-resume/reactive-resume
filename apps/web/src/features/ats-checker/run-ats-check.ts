import type { ExtractProgress } from "./extract-client";
import type { PdfAtsReport } from "@reactive-resume/resume/ats-pdf";
import { extractPdf } from "./extract-client";

export type AtsCheckResult = {
	report: PdfAtsReport;
	/** Extracted text in reading order. Kept for the optional AI tier; never sent anywhere on its own. */
	fullText: string;
};

export type RunAtsCheckOptions = {
	jobDescription?: string;
	onProgress?: (progress: ExtractProgress) => void;
	signal?: AbortSignal;
};

/**
 * The whole deterministic check, end to end, in the browser.
 *
 * The engine is imported lazily alongside PDF.js so neither lands in the initial bundle: a visitor
 * who never uploads a file never downloads either.
 */
export async function runAtsCheck(file: File, options: RunAtsCheckOptions = {}): Promise<AtsCheckResult> {
	const engine = import("@reactive-resume/resume/ats-pdf");
	// Awaited below; this only keeps a failed chunk load from surfacing as unhandled when extraction throws first.
	engine.catch(() => {});
	const raw = await extractPdf(file, {
		...(options.onProgress ? { onProgress: options.onProgress } : {}),
		...(options.signal ? { signal: options.signal } : {}),
	});

	const { analyzePdfResume, buildExtractedDocument } = await engine;

	const report = analyzePdfResume(
		raw,
		options.jobDescription?.trim() ? { jobDescription: options.jobDescription } : {},
	);

	return { report, fullText: buildExtractedDocument(raw).fullText };
}

/** Wraps a rendered PDF blob so the builder's deep check runs through exactly the same path. */
export function blobToPdfFile(blob: Blob, name: string): File {
	return new File([blob], name.endsWith(".pdf") ? name : `${name}.pdf`, { type: "application/pdf" });
}
