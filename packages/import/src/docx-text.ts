import { unzipEntries, ZipEntryTooLargeError } from "./zip";

const DOCUMENT_XML_PATH = "word/document.xml";
// Word templates often put the name and contact details in the page header; the footer can hold them too.
const HEADER_FOOTER_PATH = /^word\/(header|footer)\d*\.xml$/;
const MAX_PART_BYTES = 20 * 1024 * 1024;
// Headers and footers match a pattern, so a small file could hold many large ones: cap what they inflate to together.
const MAX_TOTAL_BYTES = 40 * 1024 * 1024;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text: string) {
	return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
		if (!name.startsWith("#")) return ENTITIES[name.toLowerCase()] ?? entity;
		const code = /^#x/i.test(name) ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
		return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : entity;
	});
}

function readParts(data: Uint8Array) {
	let entries: Record<string, Uint8Array>;
	try {
		entries = unzipEntries(
			data,
			(name) => name === DOCUMENT_XML_PATH || HEADER_FOOTER_PATH.test(name),
			MAX_PART_BYTES,
			MAX_TOTAL_BYTES,
		);
	} catch (error) {
		if (error instanceof ZipEntryTooLargeError) throw new Error("DOCX document content is too large.");
		throw new Error("Invalid DOCX archive.");
	}
	const body = entries[DOCUMENT_XML_PATH];
	if (!body) throw new Error("DOCX document content not found.");
	const decoder = new TextDecoder();
	const part = (kind: "header" | "footer") =>
		Object.keys(entries)
			.filter((name) => HEADER_FOOTER_PATH.exec(name)?.[1] === kind)
			.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
			.map((name) => decoder.decode(entries[name]));
	return { body: decoder.decode(body), headers: part("header"), footers: part("footer") };
}

/** The visible text of one OOXML part: paragraphs on their own lines, tabs and line breaks kept. */
function partText(xml: string) {
	// ponytail: minimal OOXML text extraction; add a DOCX parser dependency if tracked changes matter.
	return decodeEntities(
		// `[^<>]` keeps each match from scanning past the next tag, so malformed markup costs linear time.
		xml
			.replace(/<w:tab\b[^<>]*\/>/g, "\t")
			.replace(/<w:br\b[^<>]*\/>/g, "\n")
			.replace(/<\/w:p>/g, "\n")
			.replace(/<[^<>]*>/g, ""),
	)
		.replace(/\r/g, "")
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/**
 * A Word file's text: its page headers first (often the name and contact details), then the body, then footers. A
 * header repeated for the first page or even pages is read once. Throws when the file has no text.
 */
export function extractDocxText(data: Uint8Array): string {
	const { body, headers, footers } = readParts(data);
	const parts = [...headers, body, ...footers].map(partText).filter(Boolean);
	const text = [...new Set(parts)].join("\n\n");
	if (!text) throw new Error("DOCX document content is empty.");
	return text;
}
