/** Most recruiters read 180 to 320 words; the bar runs to 400 (L4), longer letters pin to its end. */
export const LETTER_LENGTH = { min: 180, max: 320, scale: 400 } as const;

export type LetterLength = "empty" | "short" | "comfortable" | "long";

// ponytail: counts whitespace-separated words, so text without spaces (Chinese, Japanese) counts low.
export function countWords(html: string): number {
	const text = html
		.replace(/<[^>]*>/g, " ")
		.replace(/&nbsp;|&#160;/g, " ")
		.trim();
	return text ? text.split(/\s+/).length : 0;
}

export function letterLength(words: number): LetterLength {
	if (words === 0) return "empty";
	if (words < LETTER_LENGTH.min) return "short";
	return words <= LETTER_LENGTH.max ? "comfortable" : "long";
}
