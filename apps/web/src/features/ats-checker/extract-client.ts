import type { HarvestProgress, RawExtraction } from "@reactive-resume/resume/ats-pdf";

/**
 * The only file in the app that talks to PDF.js for the ATS checker.
 *
 * Everything downstream works on the plain JSON this produces, which is what lets the analysis
 * itself live in a universal package, and what would let a server or MCP adapter reuse all of it
 * without a browser.
 *
 * The file never leaves the browser. It is read into an ArrayBuffer, handed to PDF.js, and the
 * bytes are dropped when this function returns.
 */

/** Refused before PDF.js is even loaded: nothing good happens after this size in a browser tab. */
const MAX_UPLOAD_BYTES = 25_000_000;

export type ExtractProgress = HarvestProgress | { phase: "loading"; page: 0; pageCount: 0 };

export type ExtractOptions = {
	onProgress?: (progress: ExtractProgress) => void;
	signal?: AbortSignal;
	/** Set to 0 to skip the operator pass; a caller that only wants the text layer has no use for it. */
	operatorBudgetMs?: number;
};

export class PdfPasswordRequiredError extends Error {
	constructor() {
		super("This PDF is password protected.");
		this.name = "PdfPasswordRequiredError";
	}
}

export class PdfTooLargeError extends Error {
	constructor(readonly sizeBytes: number) {
		super("This PDF is too large to check in the browser.");
		this.name = "PdfTooLargeError";
	}
}

export class PdfUnreadableError extends Error {
	constructor(cause?: unknown) {
		super("This file could not be read as a PDF.");
		this.name = "PdfUnreadableError";
		this.cause = cause;
	}
}

const PDF_MAGIC_BYTES = [0x25, 0x50, 0x44, 0x46] as const; // "%PDF"

/** Sniffs the format from the bytes rather than trusting the extension or the reported MIME type. */
async function hasPdfMagicBytes(file: Blob): Promise<boolean> {
	const header = new Uint8Array(await file.slice(0, PDF_MAGIC_BYTES.length).arrayBuffer());
	return PDF_MAGIC_BYTES.every((byte, index) => header[index] === byte);
}

function isPasswordException(error: unknown): boolean {
	return typeof error === "object" && error !== null && "name" in error && error.name === "PasswordException";
}

export async function extractPdf(file: File, options: ExtractOptions = {}): Promise<RawExtraction> {
	if (file.size > MAX_UPLOAD_BYTES) throw new PdfTooLargeError(file.size);

	const magicBytesOk = await hasPdfMagicBytes(file);
	if (!magicBytesOk) throw new PdfUnreadableError();

	options.onProgress?.({ phase: "loading", page: 0, pageCount: 0 });

	// PDF.js and the engine load only once there's a file. PDF.js comes through the preview's module so every
	// document shares its one worker instead of starting (and parsing) a new one per check.
	const [{ getDocument, getPdfWorker }, { HARVEST_DEFAULTS, harvestPdfDocument }] = await Promise.all([
		import("@/features/resume/preview/pdfjs"),
		import("@reactive-resume/resume/ats-pdf"),
	]);

	const data = new Uint8Array(await file.arrayBuffer());

	// fontExtraProperties keeps the real font objects reachable through commonObjs, which is the
	// only honest source for Type 3 / invalid / non-embedded font facts.
	const loadingTask = getDocument({ data, fontExtraProperties: true, worker: getPdfWorker() });

	try {
		const document = await loadingTask.promise;

		return await harvestPdfDocument(document, {
			file: { name: file.name, sizeBytes: file.size, magicBytesOk },
			maxPages: HARVEST_DEFAULTS.maxPages,
			...(options.operatorBudgetMs === undefined ? {} : { operatorBudgetMs: options.operatorBudgetMs }),
			...(options.onProgress ? { onProgress: options.onProgress } : {}),
			...(options.signal ? { signal: options.signal } : {}),
		});
	} catch (error) {
		if (isPasswordException(error)) throw new PdfPasswordRequiredError();
		throw error;
	} finally {
		void loadingTask.destroy();
	}
}
