import { GlobalWorkerOptions, getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { parseJSONResume } from "@reactive-resume/import/json-resume";
import { parseLinkedInExport } from "@reactive-resume/import/linkedin";
import { documentToLines, parsePdfResume } from "@reactive-resume/import/pdf-lines";
import { parseReactiveResumeJSON } from "@reactive-resume/import/reactive-resume-json";
import { parseReactiveResumeV4JSON } from "@reactive-resume/import/reactive-resume-v4-json";
import { reviewImport, withLeftoverSection, withLinkTargets } from "@reactive-resume/import/review";
import { convertLegacyStylesheet, needsLegacyStyleConversion } from "@reactive-resume/pdf/semantic-legacy";
import { buildExtractedDocument, harvestPdfDocument } from "@reactive-resume/resume/ats-pdf";
import { resumeDataSchema } from "@reactive-resume/schema/resume/data";

GlobalWorkerOptions.workerSrc = new URL("pdf.worker.mjs", import.meta.url).href;
const LIMIT = 10 * 1024 * 1024;
const EMPTY_PAGE_OPS = new Set([OPS.save, OPS.restore, OPS.transform, OPS.beginText, OPS.endText]);

/** Only bundled code sees these bytes; PDF scripts, links and imported HTML are never executed. */
export async function readLocalFile(input, progress = () => {}) {
	if (
		typeof input.name !== "string" ||
		typeof input.base64 !== "string" ||
		input.base64.length > Math.ceil(LIMIT / 3) * 4
	)
		throw new Error("too-large");
	const bytes = Uint8Array.from(atob(input.base64), (character) => character.charCodeAt(0));
	if (!bytes.length || bytes.length > LIMIT) throw new Error("too-large");
	const ext = input.name.split(".").at(-1)?.toLowerCase();
	let data;
	let pages = null;
	if (new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-") {
		const sizeBytes = bytes.byteLength;
		const loading = getDocument({
			data: bytes,
			isEvalSupported: false,
			useSystemFonts: false,
			useWorkerFetch: false,
			cMapUrl: new URL("cmaps/", import.meta.url).href,
			cMapPacked: true,
			standardFontDataUrl: new URL("standard_fonts/", import.meta.url).href,
			wasmUrl: new URL("wasm/", import.meta.url).href,
		});
		try {
			const pdf = await loading.promise;
			const raw = await harvestPdfDocument(pdf, {
				file: { name: input.name, sizeBytes, magicBytesOk: true },
				operatorBudgetMs: 0,
			});
			if (raw.truncated || raw.textReadFailed || raw.annotationReadFailed) throw new Error("partial");
			const document = buildExtractedDocument(raw);
			if (!document.lines.length) throw new Error("scanned");
			for (const page of raw.pages) {
				if (page.items.some((item) => item.str.trim())) continue;
				const source = await pdf.getPage(page.pageNumber);
				try {
					const operators = await source.getOperatorList();
					// Unknown/drawing operators cannot prove a textless page is blank; never silently discard it.
					if (!operators.fnArray.every((operator) => EMPTY_PAGE_OPS.has(operator))) throw new Error("partial");
				} catch {
					throw new Error("partial");
				} finally {
					source.cleanup();
				}
			}
			progress(1);
			data = withLinkTargets(
				parsePdfResume(document),
				raw.links.flatMap((link) => (link.url ? [link.url] : [])),
			);
			progress(2);
			data = withLeftoverSection(data, reviewImport(data, documentToLines(document)).notImported, input.moreTitle);
			pages = raw.pageCount;
		} finally {
			await loading.destroy();
		}
	} else if (ext === "pdf" || input.format === "Pdf") {
		throw new Error("unreadable");
	} else if (ext === "zip" || input.format === "LinkedIn") {
		data = parseLinkedInExport(bytes);
	} else {
		const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		let json = JSON.parse(text);
		if (json?.data && !("sections" in json) && !("metadata" in json)) json = json.data;
		if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("wrong-type");
		const normalized = JSON.stringify(json);
		if ("sections" in json || "metadata" in json) {
			if (Array.isArray(json.metadata?.layout) || (json.metadata && !("page" in json.metadata)))
				data = parseReactiveResumeV4JSON(normalized);
			else {
				data = parseReactiveResumeJSON(normalized);
				if (needsLegacyStyleConversion(data.metadata)) data.metadata.stylesheet = convertLegacyStylesheet(data);
			}
		} else if ("basics" in json) data = parseJSONResume(normalized);
		else throw new Error("wrong-type");
	}
	return { data: resumeDataSchema.parse(data), pages };
}

window.addEventListener("message", (event) => {
	const port = event.ports[0];
	// Android supplies the channel only to our exact asset origin; native messages have no web sender origin.
	if (!port || event.data !== "reader") return;
	port.onmessage = async (message) => {
		try {
			const result = await readLocalFile(JSON.parse(message.data), (stage) =>
				port.postMessage(JSON.stringify({ stage })),
			);
			port.postMessage(JSON.stringify(result));
		} catch (error) {
			const name = error instanceof Error ? error.name : "";
			const code = name === "PasswordException" ? "password" : error instanceof Error ? error.message : "unreadable";
			// No raw parser errors or document content cross into logs/UI.
			port.postMessage(
				JSON.stringify({
					error: ["password", "scanned", "partial", "too-large", "wrong-type"].includes(code) ? code : "unreadable",
				}),
			);
		} finally {
			port.close();
		}
	};
	port.start();
});
