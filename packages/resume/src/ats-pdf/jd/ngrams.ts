import { canonicalize, SKILL_SURFACE_FORMS } from "./aliases";
import { JD_LEADING_GENERIC_WORDS, JD_SOLO_GENERIC_WORDS, JD_STOPWORDS } from "./stopwords";

/** Windows this wide are scanned, but only a known skill form is kept at the longer lengths. */
export const MAX_NGRAM_LENGTH = 4;

/** Beyond two words, a phrase from a posting is too specific for any resume to match verbatim. */
const MAX_FREE_PHRASE_LENGTH = 2;

/**
 * The candidate terms in a run of text.
 *
 * Deliberately short. A posting's "hands-on Kubernetes and Terraform in production" is a sentence,
 * not a search term: no resume matches it, so reporting it as missing would be advice the reader
 * cannot act on. What survives is one- and two-word phrases with no filler in them, plus the
 * multi-word names the alias list already knows are single skills.
 */
export function buildNgrams(
	tokens: readonly string[],
	{
		maxLength = MAX_NGRAM_LENGTH,
		isSkill = isKnownSkillForm,
		isRepeated = () => false,
		isName = () => false,
	}: {
		maxLength?: number;
		isSkill?: (phrase: string) => boolean;
		/** The posting writes this pair more than once: a name ("help desk"), not a verb and its object. */
		isRepeated?: (phrase: string) => boolean;
		/** The posting writes this word as a name, capitalised mid-sentence ("managing Workday"). */
		isName?: (word: string) => boolean;
	} = {},
): string[] {
	const found: { phrase: string; start: number; end: number; skill: boolean }[] = [];
	const tails = new Set<number>();

	for (let size = 1; size <= maxLength; size += 1) {
		for (let start = 0; start + size <= tokens.length; start += 1) {
			const window = tokens.slice(start, start + size);
			const phrase = window.join(" ");

			if (isSkill(phrase)) {
				found.push({ phrase, start, end: start + size, skill: true });
				continue;
			}

			if (size > MAX_FREE_PHRASE_LENGTH) continue;
			if (window.some(isNoise)) continue;
			// A verb or qualifier is dropped alone or leading a phrase ("drive hiring"), and an ordinary word after it goes
			// too, so no fragment is left ("desk" of "help desk"); a name after it stays ("managing Workday"). A pair the
			// posting repeats is a name, not a verb and its object: "help desk", "early childhood", "building codes".
			if (JD_LEADING_GENERIC_WORDS.has(window[0] ?? "")) {
				if (size === 2 && isRepeated(phrase)) found.push({ phrase, start, end: start + size, skill: false });
				else if (size === 2 && !isName(window[1] ?? "")) tails.add(start + 1);
				continue;
			}
			// Generic nouns are dropped alone only: "big data" stays whole, and "data" on its own is ranked under it.
			if (size === 1 && JD_SOLO_GENERIC_WORDS.has(phrase)) continue;

			found.push({ phrase, start, end: start + size, skill: false });
		}
	}

	// Multi-word skill names claim their words: "pci dss compliance" yields "pci dss", never "dss compliance".
	const spans = found.filter((entry) => entry.skill && entry.end - entry.start > 1);
	const straddles = (entry: (typeof found)[number]) =>
		spans.some(
			(span) => entry.start < span.end && entry.end > span.start && (entry.start < span.start || entry.end > span.end),
		);

	return found
		.filter((entry) => entry.skill || (entry.end - entry.start === 1 ? !tails.has(entry.start) : !straddles(entry)))
		.map((entry) => entry.phrase);
}

/** A curated skill name keeps its filler: "profit and loss" is one term, not three. */
export function isKnownSkillForm(phrase: string): boolean {
	return SKILL_SURFACE_FORMS.has(phrase) || SKILL_SURFACE_FORMS.has(canonicalize(phrase));
}

/** A word that is never a term on its own. */
export function isGenericWord(token: string): boolean {
	return isNoise(token) || JD_LEADING_GENERIC_WORDS.has(token) || JD_SOLO_GENERIC_WORDS.has(token);
}

function isNoise(token: string): boolean {
	// A lone number or amount ("12+", "99.99%", "14m", "€150k") is noise; a number in a name ("soc2", "s3", "3d") is not.
	if (/^[$€£¥₹~]?\d+([.,]\d+)*(\+|%|k|m|bn|x)?$/i.test(token)) return true;
	if (token.length < 2) return true;
	// Contractions ("we're", "you'll") are prose, never a term.
	if (/['’]/.test(token)) return true;
	return JD_STOPWORDS.has(token);
}
