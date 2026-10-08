/** What a posting doesn't say, named as a missing fact rather than a problem. */
type Unknown = "salary" | "office";

// ponytail: a small English stop list; preferences in other languages simply keep more of their words significant.
const STOP_WORDS = new Set(["an", "and", "at", "for", "from", "in", "of", "on", "or", "the", "to", "with", "within"]);

// ponytail: shape-based, so "10,000 users" reads as pay; good enough to stop "Salary not listed" showing wrongly.
const SALARY = /[€$£¥₹]|\b(?:EUR|USD|GBP|CHF|SEK|NOK|DKK|PLN|CAD|AUD|INR|JPY)\b|\b\d{2,3}(?:[.,\s]?\d{3}|\s?k)\b/i;
const OFFICE = /\b(?:remote|hybrid|office|on-?site|in-person)\b/i;

/** Lower-cased words, with a trailing plural "s" dropped so "customers" finds "customer". */
const words = (text: string) =>
	text
		.toLocaleLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter((word) => word.length > 1)
		.map((word) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word));

/**
 * Matches a posting against the user's preference phrases in their own words: a phrase matches when every one of its
 * significant words appears in the posting. Also names the facts the posting leaves out.
 */
export function matchOpportunity(text: string, phrases: string[]) {
	const present = new Set(words(text));
	const matches = [
		...new Set(
			phrases.filter((phrase) => {
				const significant = words(phrase).filter((word) => !STOP_WORDS.has(word));
				return significant.length > 0 && significant.every((word) => present.has(word));
			}),
		),
	];
	const unknowns: Unknown[] = [];
	if (!SALARY.test(text)) unknowns.push("salary");
	if (!OFFICE.test(text)) unknowns.push("office");
	return { matches, unknowns };
}

type Posting = { role: string; location: string; snippet: string; description: string };

/**
 * How a found role reads against Preferences. ponytail: target roles match the title and locations the whole posting;
 * free-text priorities would split into noisy fragments, so they aren't matched.
 */
export function matchPosting(posting: Posting, preferences: { targetRoles: string[]; locations: string[] }) {
	const text = [posting.role, posting.location, posting.snippet, posting.description].join("\n");
	return {
		matches: [
			...matchOpportunity(posting.role, preferences.targetRoles).matches,
			...matchOpportunity(text, preferences.locations).matches,
		],
		unknowns: matchOpportunity(text, []).unknowns,
	};
}
