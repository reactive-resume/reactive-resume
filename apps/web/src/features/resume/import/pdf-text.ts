import { t } from "@lingui/core/macro";
import { documentToLines, parsePdfResume } from "@reactive-resume/import/pdf-lines";
import { buildExtractedDocument } from "@reactive-resume/resume/ats-pdf";
import { ImportError } from "./error";
import { extractPdf } from "@/features/ats-checker/extract-client";

export { documentToLines };

/** A PDF's text lines and the addresses behind its links, to check an import against. */
export async function readPdfSource(file: File) {
	const raw = await extractPdf(file, { operatorBudgetMs: 0 });
	const doc = buildExtractedDocument(raw);
	return {
		lines: documentToLines(doc),
		links: (doc.links ?? []).flatMap((link) => (link.url ? [link.url] : [])),
		partial: raw.truncated || raw.textReadFailed === true || raw.annotationReadFailed === true,
	};
}

export async function readPdfResume(file: File) {
	const raw = await extractPdf(file, { operatorBudgetMs: 0 });
	if (raw.truncated || raw.textReadFailed || raw.annotationReadFailed)
		throw new ImportError(
			t`Couldn't read the whole PDF. Check that all pages have readable text, or try a smaller file.`,
		);
	const doc = buildExtractedDocument(raw);
	return doc.lines.length ? parsePdfResume(doc) : null;
}
