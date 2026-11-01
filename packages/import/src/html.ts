import { escapeHtml } from "@reactive-resume/utils/string";
/**
 * Converts a plain-text summary and optional highlights array into an escaped HTML description.
 * Summary becomes a <p> tag, highlights become a <ul> list.
 */
export function toHtmlDescription(summary?: string, highlights?: string[]): string {
	return (summary ? `<p>${escapeHtml(summary)}</p>` : "") + arrayToHtmlList(highlights ?? []);
}

/**
 * Converts an array of plain-text strings into an escaped HTML unordered list.
 */
export function arrayToHtmlList(items: string[]): string {
	if (items.length === 0) return "";
	return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

// Glyph markers need no space; punctuation markers do, so "-based" remains prose.
export const BULLET_PATTERN = /^\s*(?:[•◦‣·]\s*|[-–—*]\s+)/;

/** Preserves prose and contiguous bullet lists, including a single bullet. */
export function toHtmlBlocks(lines: string[]): string {
	const blocks: string[] = [];
	let bullets: string[] = [];
	const flush = () => {
		if (bullets.length) blocks.push(arrayToHtmlList(bullets));
		bullets = [];
	};
	for (const line of lines.map((value) => value.trim()).filter(Boolean)) {
		if (BULLET_PATTERN.test(line)) {
			bullets.push(line.replace(BULLET_PATTERN, ""));
		} else {
			flush();
			blocks.push(`<p>${escapeHtml(line)}</p>`);
		}
	}
	flush();
	return blocks.join("");
}

/** LinkedIn's historical rule treats predominantly bulleted descriptions as a list. */
export function toHtml(lines: string[]): string {
	const cleaned = lines.map((line) => line.trim()).filter(Boolean);
	const bulleted = cleaned.filter((line) => BULLET_PATTERN.test(line));
	if (bulleted.length >= 2 && bulleted.length * 2 >= cleaned.length) {
		return arrayToHtmlList(cleaned.map((line) => line.replace(BULLET_PATTERN, "")));
	}
	return cleaned.map((line) => `<p>${escapeHtml(line.replace(BULLET_PATTERN, ""))}</p>`).join(""); // nosemgrep
}
