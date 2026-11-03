import { slugify } from "./string";

function getReadableTimestamp(now: Date) {
	const y = now.getFullYear();
	const m = String(now.getMonth() + 1).padStart(2, "0");
	const d = String(now.getDate()).padStart(2, "0");
	const h = String(now.getHours()).padStart(2, "0");
	const min = String(now.getMinutes()).padStart(2, "0");

	return `${y}${m}${d}_${h}${min}`;
}

export function generateFilename(prefix: string, extension?: string) {
	const now = new Date();
	const name = slugify(prefix);
	const timestamp = getReadableTimestamp(now);

	return `${name}_${timestamp}${extension ? `.${extension}` : ""}`;
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

	setTimeout(() => URL.revokeObjectURL(url), 500);
}

export async function downloadFromUrl(url: string, filename: string) {
	const response = await fetch(url);
	const blob = await response.blob();

	downloadWithAnchor(blob, filename);
}

/**
 * The filename a reviewer's download gets: `23071A0501-RAHUL-KUMAR.pdf`.
 *
 * Roll number first, because a reviewer saves a whole section in one sitting and the folder then
 * sorts itself into the order the college's own lists use. `generateFilename` above is the
 * student's form — fifty students saving "My Resume" is fine on fifty machines, and useless in
 * one reviewer's Downloads folder.
 */
export function reviewerPdfName(rollNumber: string | null | undefined, name: string | null | undefined) {
	const clean = (value: string) =>
		value
			.normalize("NFKD")
			.replace(/[^\w\s-]/g, "")
			.trim()
			.replace(/\s+/g, "-")
			.toUpperCase();
	const parts = [rollNumber, name]
		.filter((part): part is string => !!part?.trim())
		.map(clean)
		.filter(Boolean);
	return `${parts.join("-") || "RESUME"}.pdf`;
}
