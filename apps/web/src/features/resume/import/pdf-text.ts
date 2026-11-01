import { t } from "@lingui/core/macro";
import { parsePdfResume } from "@reactive-resume/import/pdf-lines";
import { buildExtractedDocument } from "@reactive-resume/resume/ats-pdf";
import { ImportError } from "./error";
import { extractPdf } from "@/features/ats-checker/extract-client";

export { documentToLines } from "@reactive-resume/import/pdf-lines";

export async function readPdfResume(file: File) {
	const raw = await extractPdf(file, { operatorBudgetMs: 0 });
	if (raw.truncated) throw new ImportError(t`Couldn't read the whole PDF. Split it into smaller files and try again.`);
	const doc = buildExtractedDocument(raw);
	return doc.lines.length ? parsePdfResume(doc) : null;
}
