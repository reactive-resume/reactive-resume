import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { t } from "@lingui/core/macro";
import { parseJSONResume } from "@reactive-resume/import/json-resume";
import { parseReactiveResumeJSON } from "@reactive-resume/import/reactive-resume-json";
import { parseReactiveResumeV4JSON } from "@reactive-resume/import/reactive-resume-v4-json";
import { convertLegacyStylesheet, needsLegacyStyleConversion } from "@reactive-resume/pdf/semantic-legacy";
import { forEachDatedEntry, hasUnreadableDateText } from "@reactive-resume/schema/resume/dates";
import { stripHtml } from "@reactive-resume/utils/string";
import { client } from "@/libs/orpc/client";

/** What a file holds, read from its bytes and shape rather than its extension or type. */
export type ImportKind =
	| "pdf"
	| "docx"
	| "linkedin"
	| "reactive-resume-json"
	| "reactive-resume-v4-json"
	| "json-resume-json"
	| "cover-letter-json";

type ResumeJsonKind = "reactive-resume-json" | "reactive-resume-v4-json" | "json-resume-json";

/** An import failure worded for the person importing. */
export class ImportError extends Error {}

// Exports from before Semantic CSS carry legacy style rules, which nothing renders any more: they come in converted.
const withLegacyStylesConverted = (data: ResumeData): ResumeData =>
	needsLegacyStyleConversion(data.metadata)
		? { ...data, metadata: { ...data.metadata, stylesheet: convertLegacyStylesheet(data) } }
		: data;

export function detectJsonImportKind(parsed: unknown): ImportKind | null {
	if (!parsed || typeof parsed !== "object") return null;
	const data = parsed as Record<string, unknown>;
	// Account archives retain document metadata around the importable resume content.
	if (data.data && typeof data.data === "object" && !("sections" in data) && !("metadata" in data)) {
		return detectJsonImportKind(data.data);
	}

	// A saved cover letter exported from Reactive Resume.
	if (data.format === "reactive-resume-cover-letter") return "cover-letter-json";

	// JSON Resume standard: top-level `basics`, without Reactive Resume's `sections`/`metadata`.
	if ("basics" in data && !("sections" in data) && !("metadata" in data)) return "json-resume-json";

	// Reactive Resume exports carry `sections` + `metadata`. V4 stores layout as nested arrays, while the current
	// schema stores a layout object. Both versions can have `metadata.page`, so that key alone cannot distinguish them.
	if ("sections" in data || "metadata" in data) {
		const metadata = data.metadata as Record<string, unknown> | undefined;
		if (metadata && Array.isArray(metadata.layout)) return "reactive-resume-v4-json";
		if (metadata && !("page" in metadata)) return "reactive-resume-v4-json";
		return "reactive-resume-json";
	}

	return null;
}

/** Sniffs the format from magic bytes and JSON shape: several resume formats share the .json extension. */
export async function detectImportKind(file: File): Promise<ImportKind | null> {
	const name = file.name.toLowerCase();
	const mime = file.type;

	const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
	const isPdf = header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46; // "%PDF"
	const isZip = header[0] === 0x50 && header[1] === 0x4b && header[2] === 0x03 && header[3] === 0x04; // "PK\x03\x04"

	if (isPdf || mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
	if (mime === "application/msword" || name.endsWith(".doc")) {
		throw new ImportError(t`Legacy Word files aren't supported. Open the file in Word and save it as .docx first.`);
	}

	// Word documents are also ZIPs, so a bare "PK" header is ambiguous. LinkedIn's export is
	// only ever named with a .zip extension, so check that first and let it win the tie.
	if (name.endsWith(".zip") || mime === "application/zip") {
		const { unzipSync } = await import("fflate");
		let accountArchive = false;
		try {
			// Only the entry names matter: the filter never selects anything, so nothing is inflated.
			unzipSync(new Uint8Array(await file.arrayBuffer()), {
				filter: (entry) => {
					if (entry.name === "account.json") accountArchive = true;
					return false;
				},
			});
		} catch {
			// The LinkedIn reader reports malformed archives when the file is read.
		}
		if (accountArchive) {
			throw new ImportError(
				t`Extract this account archive, then import a JSON file from its resumes or letters folder.`,
			);
		}
		return "linkedin";
	}

	if (
		isZip ||
		mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
		name.endsWith(".docx")
	) {
		return "docx";
	}

	// JSON by type, extension or its first character: downloads and drag-outs can arrive without either.
	const start = new TextDecoder().decode(await file.slice(0, 64).arrayBuffer()).trimStart();
	if (mime === "application/json" || name.endsWith(".json") || start.startsWith("{")) {
		try {
			return detectJsonImportKind(JSON.parse(await file.text()));
		} catch {
			return null;
		}
	}

	return null;
}

export function parseResumeJson(text: string, kind: ResumeJsonKind): ResumeData {
	const parsed = JSON.parse(text);
	const data = parsed?.data && !parsed.sections && !parsed.metadata ? JSON.stringify(parsed.data) : text;
	if (kind === "reactive-resume-json") return withLegacyStylesConverted(parseReactiveResumeJSON(data));
	if (kind === "reactive-resume-v4-json") return parseReactiveResumeV4JSON(data);
	return parseJSONResume(data);
}

function fileToBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		// Drop the data URL prefix ("data:application/pdf;base64,").
		reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
		reader.onerror = reject;
		reader.readAsDataURL(file);
	});
}

/**
 * Reads a resume from a file. PDFs go to the AI provider when one is set up and are read in the browser
 * otherwise; Word needs a provider; LinkedIn exports and JSON never leave the browser. `onRead` reports the
 * end of the first step (the file's text is in hand) with a short note.
 */
export async function readResumeFile(
	file: File,
	kind: Exclude<ImportKind, "cover-letter-json">,
	options: { aiAvailable: boolean; onRead?: (note: string) => void },
): Promise<ResumeData> {
	if (kind === "reactive-resume-json" || kind === "reactive-resume-v4-json" || kind === "json-resume-json") {
		const text = await file.text();
		options.onRead?.(t`JSON read`);
		return parseResumeJson(text, kind);
	}

	if (kind === "linkedin") {
		const { parseLinkedInExport } = await import("@reactive-resume/import/linkedin");
		const bytes = new Uint8Array(await file.arrayBuffer());
		options.onRead?.(t`export opened`);
		return parseLinkedInExport(bytes);
	}

	if (kind === "docx") {
		if (!options.aiAvailable) {
			throw new ImportError(
				t`Reading Word files needs an AI provider. Set one up in Settings, or import a PDF or JSON file instead.`,
			);
		}
		const base64 = await fileToBase64(file);
		options.onRead?.(t`file read`);
		const mediaType =
			file.type === "application/msword"
				? ("application/msword" as const)
				: ("application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const);
		return client.ai.parseDocx({ mediaType, file: { name: file.name, data: base64 } });
	}

	if (options.aiAvailable) {
		const base64 = await fileToBase64(file);
		options.onRead?.(t`file read`);
		return client.ai.parsePdf({ file: { name: file.name, data: base64 } });
	}

	const [{ extractPdfLines }, { parseResumeText }] = await Promise.all([
		import("./pdf-text"),
		import("@reactive-resume/import/plain-text"),
	]);
	const lines = await extractPdfLines(file);
	if (lines.length === 0) {
		throw new ImportError(
			t`This PDF is a scanned image. There's no text to read. Try the Word version, or start blank and paste sections in.`,
		);
	}
	options.onRead?.(t`text layer found`);
	return parseResumeText(lines.join("\n"));
}

/** What an import found: sections with content, their entries, and dates flagged for a look. */
export function summarizeImport(data: ResumeData) {
	const sections = [...Object.values(data.sections), ...data.customSections].filter(
		(section) => section.items.length > 0,
	);
	let flagged = 0;
	forEachDatedEntry(data, (entry) => {
		if (hasUnreadableDateText(entry.dates)) flagged++;
	});

	return {
		sections: sections.length + (stripHtml(data.summary.content) ? 1 : 0),
		entries: sections.reduce((total, section) => total + section.items.length, 0),
		flagged,
	};
}
