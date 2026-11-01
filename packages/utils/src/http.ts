import { sanitizeFileName } from "./file";

/** Whether an `If-None-Match` header names this ETag, by weak comparison (RFC 9110 §13.1.2). */
export function matchesIfNoneMatch(header: string | null | undefined, etag: string): boolean {
	const target = etag.replace(/^W\//, "");
	return (
		header?.split(",").some((candidate) => {
			const tag = candidate.trim();
			return tag === "*" || tag.replace(/^W\//, "") === target;
		}) ?? false
	);
}

const RFC_5987_ATTR_CHARACTERS = /^[A-Za-z0-9!#$&+.^_`|~-]$/;

/** Percent-encodes a UTF-8 value with the characters RFC 5987 allows unescaped. */
function encodeRfc5987(value: string) {
	let encoded = "";
	for (const byte of new TextEncoder().encode(value)) {
		const character = String.fromCharCode(byte);
		encoded += RFC_5987_ATTR_CHARACTERS.test(character)
			? character
			: `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
	}
	return encoded;
}

/** An ASCII stand-in with Latin accents folded and other scripts left out; the UTF-8 name carries them. */
function asciiFileName(filename: string) {
	const stemEnd = filename.lastIndexOf(".");
	const stem = stemEnd > 0 ? filename.slice(0, stemEnd) : filename;
	const extension = stemEnd > 0 ? filename.slice(stemEnd) : "";
	const asciiStem = sanitizeFileName(stem.normalize("NFKD"))
		.replace(/\p{M}/gu, "")
		.replace(/[^\x20-\x7e]/g, "")
		.replace(/^[-_. ]+|[-_. ]+$/g, "");
	const asciiExtension = extension.replace(/[^\x20-\x7e]/g, "");
	return `${asciiStem || "document"}${asciiExtension}`;
}

/** Keep names within the common 255-byte file-system limit and UTF-8 headers below proxy buffer limits. */
function boundedFileName(filename: string) {
	const extension = filename.match(/\.[a-z0-9]{1,10}$/i)?.[0] ?? "";
	const encoder = new TextEncoder();
	let bytes = extension.length;
	let stem = "";
	for (const character of filename.slice(0, filename.length - extension.length)) {
		bytes += encoder.encode(character).length;
		if (bytes > 255) break;
		stem += character;
	}
	return `${stem}${extension}`;
}

/**
 * A `Content-Disposition` value that legacy clients read from `filename` and modern clients read from the
 * RFC 5987 `filename*`. It drops control characters, separators, quotes and backslashes first, so a stored
 * name can never add a header.
 */
export function contentDisposition(filename: string, disposition: "inline" | "attachment" = "attachment") {
	const safe = boundedFileName(sanitizeFileName(filename) || "document");
	const fallback = asciiFileName(safe);
	const value = `${disposition}; filename="${fallback}"`;
	return fallback === safe ? value : `${value}; filename*=UTF-8''${encodeRfc5987(safe)}`;
}
