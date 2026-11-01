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

const RELS_PATH = "word/_rels/document.xml.rels";

/**
 * The header and footer parts the body's sections use, from their `headerReference`/`footerReference` ids and the
 * document's relationships: a header left in the file but used by no section isn't part of what prints.
 */
function referencedParts(body: string, rels: string | undefined) {
	if (rels === undefined) return null;
	const ids = new Set(
		[...body.matchAll(/<w:(?:header|footer)Reference\b[^<>]*\br:id="([^"]+)"/g)].map((match) => match[1]),
	);
	const targets = new Set<string>();
	for (const [relationship] of rels.matchAll(/<Relationship\b[^<>]*>/g)) {
		const id = /\bId="([^"]+)"/.exec(relationship)?.[1];
		const target = /\bTarget="([^"]+)"/.exec(relationship)?.[1];
		if (id && target && ids.has(id)) targets.add(`word/${target.replace(/^\.?\//, "")}`);
	}
	return targets;
}

function readParts(data: Uint8Array) {
	let entries: Record<string, Uint8Array>;
	try {
		entries = unzipEntries(
			data,
			(name) => name === DOCUMENT_XML_PATH || name === RELS_PATH || HEADER_FOOTER_PATH.test(name),
			MAX_PART_BYTES,
			MAX_TOTAL_BYTES,
		);
	} catch (error) {
		if (error instanceof ZipEntryTooLargeError) throw new Error("DOCX document content is too large.");
		throw new Error("Invalid DOCX archive.");
	}
	const bodyBytes = entries[DOCUMENT_XML_PATH];
	if (!bodyBytes) throw new Error("DOCX document content not found.");
	const decoder = new TextDecoder();
	const body = decoder.decode(bodyBytes);
	const relsBytes = entries[RELS_PATH];
	// Without the relationships part, every header and footer is read, as before.
	const used = referencedParts(body, relsBytes ? decoder.decode(relsBytes) : undefined);
	const part = (kind: "header" | "footer") =>
		Object.keys(entries)
			.filter((name) => HEADER_FOOTER_PATH.exec(name)?.[1] === kind && (!used || used.has(name)))
			.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
			.map((name) => decoder.decode(entries[name]));
	return { body, headers: part("header"), footers: part("footer") };
}

/**
 * `xml` without each `<tag …>…</tag>` element that `drop` picks. A self-closing tag (a deleted paragraph mark,
 * `<w:del …/>`) stays. One pass of `indexOf`, so a part with many unclosed tags still costs linear time.
 */
function dropElements(xml: string, tag: string, drop: (element: string) => boolean = () => true) {
	const open = `<${tag}`;
	const close = `</${tag}>`;
	let out = "";
	let at = 0;
	for (;;) {
		let start = xml.indexOf(open, at);
		// `<w:del` must not match `<w:delText`, nor `<w:r` match `<w:rPr`.
		while (start !== -1 && !/[\s/>]/.test(xml[start + open.length] ?? "")) start = xml.indexOf(open, start + 1);
		if (start === -1) break;
		const tagEnd = xml.indexOf(">", start);
		if (tagEnd === -1) break;
		if (xml[tagEnd - 1] === "/") {
			out += xml.slice(at, tagEnd + 1);
			at = tagEnd + 1;
			continue;
		}
		const end = xml.indexOf(close, tagEnd);
		if (end === -1) break;
		const element = xml.slice(start, end + close.length);
		out += xml.slice(at, start) + (drop(element) ? "" : element);
		at = end + close.length;
	}
	return out + xml.slice(at);
}

const HIDDEN_RUN = /<w:vanish\b(?![^<>]*w:val="(?:0|false|off)")[^<>]*\/>/;

/** What prints: tracked deletions and hidden runs taken out. */
const visibleXml = (xml: string) =>
	dropElements(dropElements(dropElements(xml, "w:del"), "w:delText"), "w:r", (run) => HIDDEN_RUN.test(run));

/** The visible text of one OOXML part: paragraphs on their own lines, tabs and line breaks kept. */
function partText(xml: string) {
	// ponytail: minimal OOXML text extraction (deletions and hidden runs dropped); add a DOCX parser if fields matter.
	return decodeEntities(
		// `[^<>]` keeps each match from scanning past the next tag, so malformed markup costs linear time.
		visibleXml(xml)
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
