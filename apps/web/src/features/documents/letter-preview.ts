import { stripHtml } from "@reactive-resume/utils/string";

/** How many opening lines a thumbnail shows; enough to tell letters apart, few enough to stay a page miniature. */
export const LETTER_PREVIEW_LINES = 3;

/**
 * The opening lines of a letter's body as the page reads them: paragraph and line breaks become lines, markup is
 * stripped, blank lines dropped. Bounded, since a thumbnail only needs the start of the letter.
 */
export function letterBodyLines(content: string | null | undefined, max = LETTER_PREVIEW_LINES): string[] {
	if (!content) return [];
	const text = stripHtml(content.replace(/<\/(?:p|div|li|h[1-6])>|<br\s*\/?>/gi, "\n").replace(/\r/g, ""));
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.slice(0, max);
}

/** A custom greeting, or null when the letter uses its document language's default. */
export function letterGreeting(greeting: string | null | undefined): string | null {
	return greeting?.trim() || null;
}
