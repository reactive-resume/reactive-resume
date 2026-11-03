import { stripHtml } from "@reactive-resume/utils/string";

/** How many opening lines a thumbnail shows; enough to tell letters apart, few enough to stay a page miniature. */
const LETTER_PREVIEW_LINES = 3;

/**
 * Stored letter HTML can carry entities (`R&amp;D`, `&nbsp;`). `stripHtml` removes tags but leaves them, so decode the
 * text the reader would see. Covers the named and numeric entities the sanitized rich-text surface emits; anything
 * unknown stays as written rather than becoming a replacement character.
 */
const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: "\u00a0",
	copy: "©",
	reg: "®",
	trade: "™",
	hellip: "…",
	mdash: "—",
	ndash: "–",
	lsquo: "‘",
	rsquo: "’",
	ldquo: "“",
	rdquo: "”",
	bull: "•",
	middot: "·",
	deg: "°",
	plusmn: "±",
	times: "×",
	divide: "÷",
	frac12: "½",
};

function decodeEntities(text: string): string {
	if (!text.includes("&")) return text;
	return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
		if (code.startsWith("#")) {
			const point =
				code[1]?.toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
			try {
				return String.fromCodePoint(point);
			} catch {
				return entity;
			}
		}
		return NAMED_ENTITIES[code.toLowerCase()] ?? entity;
	});
}

/**
 * The opening lines of a letter's body as the page reads them: paragraph and line breaks become lines, markup is
 * stripped, entities decoded, blank lines dropped. Bounded, since a thumbnail only needs the start of the letter.
 */
export function letterBodyLines(content: string | null | undefined, max = LETTER_PREVIEW_LINES): string[] {
	if (!content) return [];
	const text = decodeEntities(
		stripHtml(content.replace(/<\/(?:p|div|li|h[1-6])>|<br\s*\/?>/gi, "\n").replace(/\r/g, "")),
	).replace(/\u00a0/g, " ");
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
