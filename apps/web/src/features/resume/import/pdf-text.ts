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
		// Very long files are read only in part; the review then says so.
		partial: raw.truncated,
	};
}

export async function readPdfResume(file: File) {
	const raw = await extractPdf(file, { operatorBudgetMs: 0 });
	if (raw.truncated) throw new ImportError(t`Couldn't read the whole PDF. Split it into smaller files and try again.`);
	const doc = buildExtractedDocument(raw);
	return doc.lines.length ? parsePdfResume(doc) : null;
}
