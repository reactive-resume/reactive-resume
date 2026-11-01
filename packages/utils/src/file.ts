import { slugify } from "./slug";

export function generateFilename(prefix: string, extension?: string) {
	const name = slugify(prefix);
	return `${name}${extension ? `.${extension}` : ""}`;
}

export type FileNameTarget = "resume" | "cover-letter";

export type FileNameSource = {
	name: string;
	slug?: string | null;
	data: { basics: { name: string } };
};

// Control characters can break headers, and the rest are rejected by Windows and macOS.
// oxlint-disable-next-line no-control-regex -- matching the control ranges is the point.
const UNSAFE_FILE_NAME_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069<>:"/\\|?*]/g;
const FILE_NAME_EDGES = /^[.\s]+|[.\s]+$/g;

/** A file name without path separators, control characters, or characters file systems reject. */
export const sanitizeFileName = (value: string) =>
	value.replace(UNSAFE_FILE_NAME_CHARACTERS, "").replace(FILE_NAME_EDGES, "");

/**
 * "First-Last-Resume" (or "First-Last-Cover-Letter"): recruiters see this name. Without a name on the
 * document it falls back to the document's name.
 */
export function getDefaultFileName(source: FileNameSource, target: FileNameTarget = "resume") {
	const words = (text: string) => sanitizeFileName(text).split(/\s+/).filter(Boolean);
	const person = words(source.data.basics.name);
	const suffix = target === "cover-letter" ? ["Cover", "Letter"] : ["Resume"];
	if (person.length > 0) return [...person, ...suffix].join("-");
	const name = words(source.name);
	const fallback = [
		...(name.length > 0 ? name : words(source.slug ?? "")),
		...(target === "cover-letter" ? suffix : []),
	];
	return fallback.join("-") || "Resume";
}

export function downloadWithAnchor(blob: Blob, filename: string) {
	const a = document.createElement("a");
	const url = URL.createObjectURL(blob);

	a.href = url;
	a.rel = "noopener";
	a.download = filename;

	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);

	setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** "12 kB" or "3.4 MB" (decimal units), never less than 1 kB. */
export function formatFileSize(bytes: number, locale: string): string {
	const inMegabytes = bytes >= 1_000_000;
	return new Intl.NumberFormat(locale, {
		style: "unit",
		unit: inMegabytes ? "megabyte" : "kilobyte",
		maximumFractionDigits: inMegabytes ? 1 : 0,
	}).format(inMegabytes ? bytes / 1_000_000 : Math.max(1, Math.round(bytes / 1000)));
}
