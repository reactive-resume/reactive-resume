import { slugify } from "./slug";

export function generateFilename(prefix: string, extension?: string) {
	const name = slugify(prefix);
	return `${name}${extension ? `.${extension}` : ""}`;
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
