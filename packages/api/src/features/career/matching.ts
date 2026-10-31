/** Details conservative text matching could not establish. */
type Unknown = "salary" | "office";

// ponytail: a small English stop list; preferences in other languages simply keep more of their words significant.
const STOP_WORDS = new Set(["an", "and", "at", "for", "from", "in", "of", "on", "or", "the", "to", "with", "within"]);

// Conservative English detection: a number alone, a budget or a remote API never establishes pay or workplace.
const PAY_CONTEXT = String.raw`(?:salary|base pay|compensation|pay)`;
const PAY_NUMBER = String.raw`\d[\d,]*(?:\.\d+)?(?:[ \t]\d{3})*`;
const PAY_CURRENCY = String.raw`(?:EUR|USD|GBP|CHF|SEK|NOK|DKK|PLN|CAD|AUD|INR|JPY)`;
const PAY_AMOUNT = String.raw`(?:[€$£¥₹]\s*${PAY_NUMBER}(?:k\b)?(?![\p{L}\p{N}])|${PAY_CURRENCY}\s*${PAY_NUMBER}(?![\p{L}\p{N}])|${PAY_NUMBER}(?:\s*(?:[-–—]|to|and)\s*${PAY_NUMBER})?\s*(?:${PAY_CURRENCY}\b|[€$£¥₹])|${PAY_NUMBER}k\b(?!\s+matching\b))`;
const PAY_LINK = String.raw`(?:(?:range|for|this|the|position|role|is|of|from|between|up|to|starts|at|ranges|approximately|about)[\s:]+){0,8}`;
const PAY_PERIOD = String.raw`(?:per (?:year|month|hour)|a (?:year|month|hour)|annually)`;
const SALARY = new RegExp(
	String.raw`\b${PAY_CONTEXT}\s*:?\s*${PAY_LINK}${PAY_AMOUNT}|${PAY_AMOUNT}\s*(?:${PAY_PERIOD}\s+)?${PAY_CONTEXT}\b|(?:^|[.!?\n]\s*)${PAY_AMOUNT}(?:\s*[-–—]\s*${PAY_AMOUNT})?\s+${PAY_PERIOD}\b|\b\d{2,3}k\s+base\b`,
	"iu",
);
const OFFICE =
	/(?:(?:^|[.!?\n]\s*)(?:location|workplace type):\s*(?:remote|hybrid|on-?site)\b)|\bthis is an? (?:remote|hybrid|on-?site) (?:role|position|job)\b|(?:^|[.!?\n]\s*)(?:(?:fully|100%)\s+remote(?:\s+team)?|remote(?=\s*(?:[.!?\n(]|$))|remote\s+(?:work|role|position|job)|hybrid(?:\s+(?:work|role|working|arrangement|position))?|(?:on-?site|in-person)\s+(?:work|role|working|position))\b(?!\s+(?:tools?|software|products?|solutions?|platforms?|APIs?))|\b(?:you|we|employees|our team|this role|this position|the role|the position)\s+(?:(?:will|can|may)\s+)?(?:(?:work|works|working|is|are)\s+)(?:(?:fully|100%)\s+)?(?:remote(?:ly)?|hybrid|on-?site|in-person)\b(?!\s+(?:tools?|software|products?|solutions?|platforms?|APIs?))|\b[0-5]\s+days?[^.!?\n]{0,20}(?:office|on-?site)\b/i;

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
	const text = [posting.role, posting.location, posting.description].join("\n");
	const significant = preferences.targetRoles.flatMap(words).filter((word) => !STOP_WORDS.has(word));
	const present = new Set(words(text));
	return {
		matches: [
			...matchOpportunity(posting.role, preferences.targetRoles).matches,
			...matchOpportunity(text, preferences.locations).matches,
		],
		keywordOverlap: [...new Set(significant.filter((word) => present.has(word)))],
		unknowns: matchOpportunity(text, []).unknowns,
	};
}
