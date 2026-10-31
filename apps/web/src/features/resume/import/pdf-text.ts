import { parsePdfResume } from "@reactive-resume/import/pdf-lines";
import { buildExtractedDocument } from "@reactive-resume/resume/ats-pdf";
import { extractPdf } from "@/features/ats-checker/extract-client";

export { documentToLines } from "@reactive-resume/import/pdf-lines";

export async function readPdfResume(file: File) {
	const doc = buildExtractedDocument(await extractPdf(file, { operatorBudgetMs: 0 }));
	return doc.lines.length ? parsePdfResume(doc) : null;
}
