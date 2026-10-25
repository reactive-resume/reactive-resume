import { GlobalWorkerOptions, PDFWorker } from "pdfjs-dist/legacy/build/pdf.mjs";

GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();

let shared: PDFWorker | undefined;

/**
 * The one pdf.js worker every preview page and thumbnail reads its PDF in. Without it pdf.js starts a worker per
 * document, which re-parses its 1 MB script first: two per preview update, one per template thumbnail. Documents
 * opened with it don't destroy it when they're destroyed.
 */
export function getPdfWorker() {
	if (!shared || shared.destroyed) shared = new PDFWorker();
	return shared;
}

export { AnnotationMode, getDocument, RenderingCancelledException } from "pdfjs-dist/legacy/build/pdf.mjs";
