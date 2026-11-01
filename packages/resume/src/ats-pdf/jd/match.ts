import type { JdMatchReport, JdTermMatch } from "../types";
import { canonicalize, surfaceFormsOf } from "./aliases";
import { buildNgrams, isGenericWord, isKnownSkillForm, MAX_NGRAM_LENGTH } from "./ngrams";
import { normalizeForMatching } from "./normalize";
import { stemFreeText } from "./stem";
import { splitIntoRuns, tokenize } from "./tokenize";

/** Terms drawn from a requirements section count for more than terms from the company blurb. */
const REQUIREMENTS_BOOST = 1.5;
/** A name the curated skill list recognises is the kind of term recruiters actually search on. */
const KNOWN_SKILL_BOOST = 2;
/** Each additional word makes a phrase more specific, and slightly more worth matching. */
const PHRASE_BONUS_PER_WORD = 0.4;
const REQUIREMENTS_HEADING =
	/\b(?:requirement|qualification|must[- ]have|nice[- ]to[- ]have|what you(?:'| a|)ll (?:need|bring|do)|about you|we(?:'| a|)re looking for|your (?:profile|background)|you (?:have|bring)|minimum|preferred)\b/;

const DEFAULT_MAX_TERMS = 35;

/**
 * Stuffing is rare, and the bar for calling it is deliberately high.
 *
 * A specialist's resume repeats its own field far more often than a posting does — a Unity
 * developer writes "Unity" in every role, and the posting writes it once. Ratio to the posting
 * alone therefore accuses honest resumes, so a term must also account for a real share of
 * everything the document says before it is named here.
 */
const STUFFING_MIN_COUNT = 8;
const STUFFING_MULTIPLIER = 5;
const STUFFING_MIN_DENSITY = 0.015;

export type JdMatchOptions = {
	jobDescription: string;
	resumeText: string;
	/** From the operator pass: the file draws text a reader cannot see. */
	documentHasHiddenText?: boolean;
	maxTerms?: number;
	/** The employer, when known (a linked application). Its name is never a term to add to a resume. */
	company?: string | undefined;
	/** Where the job is, when known. A city is never a term to add either. */
	location?: string | undefined;
	/** The job's title, when known. "Product Designer" names the job, not a skill to add to a resume. */
	role?: string | undefined;
};

type JdTerm = { term: string; count: number; inRequirements: boolean; words: number; isSkill: boolean };

/**
 * Lines about pay and perks describe what the job offers, not what it asks for: "30 days holiday" and "+ equity" are
 * not skills, and a line naming one of these is left out whole.
 */
const OFFER_LINE =
	/\b(?:salary|salaries|compensation|equity|bonus(?:es)?|holidays?|vacation|pto|paid time off|relocation|pension|401\s?\(?k\)?|perks?|stipend|parental leave|per (?:year|annum|month|hour)|days? (?:of )?(?:annual )?leave)\b/;
/** A heading that opens the offer's part of a posting; its lines are skipped until a heading about the work. */
const OFFER_HEADING =
	/^(?:what we offer|what you(?:'| wi)ll get$|benefits|perks|compensation|our offer|why (?:join|work)|what'?s in it for you|the package|pay and benefits|salary)\b/;
const WORK_HEADING =
	/^(?:about (?:the role|you|the team|the job)|the role|responsibilities|required skills|what you(?:'| wi)ll (?:do|need|bring|get to do)|requirements|qualifications|who you are|your profile|must[- ]haves?|nice[- ]to[- ]haves?)\b/;
const BULLET = /^[\s•▪◦‣·*-]+/;

/** The posting's lines that say what the job asks for: offer lines and offer sections are dropped. */
function workLines(posting: string): string[] {
	const lines: string[] = [];
	let inOffer = false;

	for (const line of posting.split(/\r?\n/)) {
		const bare = line.replace(BULLET, "").trim();
		if (!bare) continue;

		const text = normalizeForMatching(bare);
		const heading = !BULLET.test(line) && text.split(/\s+/).length <= 6 && !/[.!?]$/.test(text);
		if (heading && OFFER_HEADING.test(text)) {
			inOffer = true;
			continue;
		}
		if (heading && (WORK_HEADING.test(text) || REQUIREMENTS_HEADING.test(text))) inOffer = false;
		if (
			inOffer ||
			(OFFER_LINE.test(text) &&
				!/\b(?:experience|expertise|skills?|knowledge|proficien|research|analysis|manage|build|develop|design|responsib|require)/.test(
					text,
				))
		)
			continue;

		lines.push(line);
	}

	return lines;
}

const NAME = String.raw`[A-Z][\w'’&.-]*(?:\s+(?:&\s+)?[A-Z][\w'’&.-]*){0,3}`;
/** "Fieldnote is hiring…", "Parcel & Co. is looking…": the subject of these is the employer. */
const EMPLOYER_SENTENCE = new RegExp(
	String.raw`(?:^|\n|[.!?]\s+)(${NAME})\s+(?:is|are)\s+(?:hiring|looking|recruiting)\b`,
	"g",
);

/**
 * A header part reads as a name: one to four capitalised words, no list commas, and no word a skill. "Figma, Sketch,
 * SQL" after a title's dash is a list of tools, not an employer.
 */
function readsAsName(text: string): boolean {
	const name = text.trim();
	if (!name || name.includes(",")) return false;
	const words = name.split(/\s+/);
	if (words.length > 4 || !words.every((word) => word === "&" || /^[A-Z0-9][\w'’&.-]*$/.test(word))) return false;
	return !tokenize(normalizeForMatching(name)).some(isKnownSkillForm);
}

/** "Parcel & Co.", "Acme Corp", "Northwind Labs": the name says it is a company. */
const COMPANY_SUFFIX =
	/\s(?:&\s*Co\.?|Co\.?|Inc\.?|Ltd\.?|LLC|LLP|PLC|plc|Corp\.?|Corporation|GmbH|AG|S\.?A\.?|B\.?V\.?|Labs|Technologies|Limited)$/;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Names a pasted posting gives the employer and the place, without an application to say so: the subject of "X is
 * hiring", a heading's "Role at Company (City)", or a "Company · City · Full-time" line near the top.
 *
 * A title's tail after a dash or bar is as often the team or field ("Staff Engineer — Observability") as the
 * employer, so it counts only with a second sign: a company suffix, or the posting naming it as the employer
 * elsewhere ("X is hiring", "at X"). "Join X" isn't one: "join Search, a team of eight". Only a part that reads as a
 * name counts, so a guess never hides a skill.
 */
function guessEmployerAndPlace(posting: string): string[] {
	const subjects = [...posting.matchAll(EMPLOYER_SENTENCE)].map((match) => (match[1] ?? "").trim());
	const namedAsEmployer = (name: string) =>
		COMPANY_SUFFIX.test(name) ||
		subjects.includes(name) ||
		new RegExp(String.raw`\b[Aa]t\s+${escapeRegExp(name)}(?![\w'’-])`).test(posting);
	const names = [...subjects];

	for (const line of posting
		.split(/\r?\n/)
		.filter((entry) => entry.trim())
		.slice(0, 3)) {
		const atTail = line.split(/\s+(?:at|@)\s+/);
		const header = atTail.length > 1 ? atTail : line.split(/\s+[—–|]\s+|\s+-\s+/);
		if (header.length > 1) {
			const tail = header.at(-1) ?? "";
			const name = tail.replace(/\(.*?\)/g, "").trim();
			if (atTail.length > 1 || namedAsEmployer(name)) names.push(name);
			// "(Lisbon)", "(Berlin, hybrid)" after a title: the place.
			for (const match of tail.matchAll(/\(([^)]*)\)/g)) names.push(...(match[1] ?? "").split(/[,/]/));
		}
		// "Fieldnote · Lisbon · Full-time": a job's details line, company first.
		const parts = line.split(/\s+·\s+/);
		if (
			parts.length > 1 &&
			!/\b(?:engineer|developer|designer|manager|director|analyst|lead|senior|staff)\b/i.test(parts[0] ?? "")
		)
			names.push(parts[0] ?? "", (parts[1] ?? "").replace(/\(.*?\)/g, ""));
	}

	return names.filter(readsAsName);
}

/**
 * The employer's name and the place, as whole phrases no term may contain or overlap: "Data Systems" hides "data
 * systems", never "data modeling".
 *
 * ponytail: a later bare "Northwind" for "Northwind Labs" still counts; matching name prefixes needs a way to tell
 * them from ordinary words ("Data" of "Data Systems").
 */
function excludedPhrases(posting: string, options: JdMatchOptions): string[][] {
	// The title with and without its level: "Senior Product Designer" is also "Product Designer".
	const role = options.role?.replace(/\(.*?\)/g, "").trim() ?? "";
	const unleveled = role.replace(/^(?:senior|sr\.?|junior|jr\.?|lead|staff|principal|associate|head of)\s+/i, "");
	const sources = [
		options.company ?? "",
		...(options.location ?? "").split(/[,()/·|]/),
		...guessEmployerAndPlace(posting),
		role,
		...(unleveled !== role ? [unleveled] : []),
	];
	const phrases: string[][] = [];

	for (const source of sources) {
		const tokens = tokenize(normalizeForMatching(source));
		if (tokens.length === 0 || (source !== options.company && isKnownSkillForm(tokens.join(" ")))) continue;
		// A one-word title ("Designer") still leaves the word free for longer terms elsewhere.
		if ((source === role || source === unleveled) && tokens.length < 2) continue;
		// A one-word place such as "Remote" or "hybrid" is already noise, and hiding it would split "hybrid cloud".
		if (tokens.length === 1 && isGenericWord(tokens[0] ?? "")) continue;
		phrases.push(tokens);
	}

	return phrases;
}

/** The parts of a run left once every excluded phrase is cut out of it. */
function cutPhrases(tokens: readonly string[], phrases: readonly string[][]): string[][] {
	const pieces: string[][] = [];
	let current: string[] = [];

	for (let index = 0; index < tokens.length;) {
		const hit = phrases.find((phrase) => phrase.every((token, offset) => tokens[index + offset] === token));
		if (hit) {
			if (current.length > 0) pieces.push(current);
			current = [];
			index += hit.length;
			continue;
		}
		current.push(tokens[index] ?? "");
		index += 1;
	}
	if (current.length > 0) pieces.push(current);

	return pieces;
}

/**
 * Skills whose name is also an everyday word count only when the posting writes them as a name: "Go or Java" is the
 * language, "payment rails" and "next steps" are not Rails or Next.js. A capitalised use away from the start of a
 * sentence, or an unambiguous spelling ("Next.js", "Ruby on Rails"), settles it.
 */
const EVERYDAY_WORD_SKILLS: Readonly<Record<string, RegExp>> = {
	next: /next\.?js/i,
	rails: /ruby|\bror\b/i,
	go: /golang/i,
	safe: /scaled agile/i,
	rest: /restful|rest api|\bREST\b/,
	shell: /\bbash\b|shell script/i,
	lambda: /aws lambda/i,
	spark: /apache spark|pyspark/i,
};

/** The word's spellings in the posting that carry a capital ("Workday", "PagerDuty", "AWS"), with what comes before. */
function* capitalisedUses(posting: string, word: string) {
	const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	for (const match of posting.matchAll(new RegExp(String.raw`(?<![\p{L}\p{N}])${escaped}(?![\p{L}\p{N}])`, "giu")))
		if (match[0] !== match[0].toLowerCase()) yield { match, before: posting.slice(0, match.index).trimEnd() };
}

/**
 * A capital away from the start of a line or sentence: the posting writes the word as a name ("managing Workday").
 * With `inProse`, only in a line with a lower-case word of four letters or more, since a Title Case heading
 * capitalises every word but its short connectors ("Senior Engineer at Fieldnote").
 */
function writesCapitalisedMidSentence(posting: string, word: string, inProse = false): boolean {
	for (const { match, before } of capitalisedUses(posting, word)) {
		if (!before || /[.!?:\n•*-]$/.test(before)) continue;
		const line = posting.slice(posting.lastIndexOf("\n", match.index) + 1).split("\n", 1)[0] ?? "";
		if (!inProse || /(?:^|\s)\p{Ll}{4}/u.test(line)) return true;
	}
	return false;
}

/**
 * Whether an everyday-word skill is written as the skill: capitalised away from the start of a line or sentence, or
 * at the start standing alone as an item ("- Go and Kubernetes", "Go, Java or Rust"), not "Next steps".
 */
function writesAsName(posting: string, word: string): boolean {
	const forms = new Set([word.charAt(0).toUpperCase() + word.slice(1), word.toUpperCase()]);
	for (const { match, before } of capitalisedUses(posting, word)) {
		if (!forms.has(match[0])) continue;
		if (before && !/[.!?:\n•*-]$/.test(before)) return true;
		if (/^\s*(?:[,/&(]|(?:and|or)\b|\r?\n|$)/.test(posting.slice(match.index + match[0].length))) return true;
	}
	return false;
}

function skillJudge(posting: string) {
	const settled = new Map<string, boolean>();

	return (phrase: string) => {
		if (!isKnownSkillForm(phrase)) return false;
		const spelling = EVERYDAY_WORD_SKILLS[phrase];
		if (!spelling) return true;

		let named = settled.get(phrase);
		if (named === undefined) {
			named = spelling.test(posting) || writesAsName(posting, phrase);
			settled.set(phrase, named);
		}
		return named;
	};
}

function collectJdTerms(options: JdMatchOptions): Map<string, JdTerm> {
	const posting = options.jobDescription;
	const excluded = excludedPhrases(posting, options);
	const isSkill = skillJudge(posting);
	const runs = workLines(posting).flatMap((line) => splitIntoRuns(normalizeForMatching(line)));
	const piecesOf = runs.map((run) => cutPhrases(tokenize(run), excluded));
	const pairs = new Map<string, number>();
	for (const piece of piecesOf.flat())
		for (let index = 0; index + 1 < piece.length; index += 1) {
			const pair = `${piece[index]} ${piece[index + 1]}`;
			pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
		}
	const isRepeated = (phrase: string) => (pairs.get(phrase) ?? 0) > 1;
	const names = new Map<string, boolean>();
	const isName = (word: string) => {
		let named = names.get(word);
		if (named === undefined) names.set(word, (named = writesCapitalisedMidSentence(posting, word, true)));
		return named;
	};
	const terms = new Map<string, JdTerm>();

	let inRequirements = false;

	for (const [index, run] of runs.entries()) {
		// A heading flips the section on; it does not itself contribute terms worth counting.
		if (REQUIREMENTS_HEADING.test(run)) inRequirements = true;

		for (const ngram of (piecesOf[index] ?? []).flatMap((piece) =>
			buildNgrams(piece, { isSkill, isRepeated, isName }),
		)) {
			const term = canonicalize(ngram);
			const existing = terms.get(term);

			if (existing) {
				existing.count += 1;
				existing.inRequirements ||= inRequirements;
				continue;
			}

			terms.set(term, {
				term,
				count: 1,
				inRequirements,
				words: ngram.split(" ").length,
				isSkill: isSkill(ngram),
			});
		}
	}

	return terms;
}

/** Counts every 1- to 4-word phrase in the resume, under both its own spelling and its stem. */
function countResumeNgrams(resumeText: string): Map<string, number> {
	const counts = new Map<string, number>();

	/** Counts each window of `tokens`; with `only`, just the windows that include one of those positions. */
	const count = (tokens: readonly string[], only?: ReadonlySet<number>) => {
		for (let size = 1; size <= MAX_NGRAM_LENGTH; size += 1) {
			for (let start = 0; start + size <= tokens.length; start += 1) {
				if (only && !Array.from({ length: size }, (_, offset) => start + offset).some((index) => only.has(index)))
					continue;
				const window = tokens.slice(start, start + size);
				const raw = window.join(" ");
				const stemmed = window.map(stemFreeText).join(" ");

				counts.set(raw, (counts.get(raw) ?? 0) + 1);
				if (stemmed !== raw) counts.set(stemmed, (counts.get(stemmed) ?? 0) + 1);
			}
		}
	};

	for (const run of splitIntoRuns(normalizeForMatching(resumeText))) {
		const tokens = tokenize(run);
		count(tokens);
		// "checkout-flow accessibility" also says "checkout flow": a posting's "checkout flows" is there. Only the
		// phrases the split adds are counted, so the other words aren't counted twice.
		const split: string[] = [];
		const parts = new Set<number>();
		for (const token of tokens) {
			if (!/\p{L}-\p{L}/u.test(token)) {
				split.push(token);
				continue;
			}
			for (const part of token.split("-").filter(Boolean)) {
				parts.add(split.length);
				split.push(part);
			}
		}
		if (parts.size > 0) count(split, parts);
	}

	return counts;
}

function resumeCountFor(term: string, counts: ReadonlyMap<string, number>): number {
	let best = 0;

	for (const surface of surfaceFormsOf(term)) {
		best = Math.max(best, counts.get(surface) ?? 0);
	}

	const stemmed = term.split(" ").map(stemFreeText).join(" ");
	return Math.max(best, counts.get(stemmed) ?? 0);
}

const weigh = (entry: JdTerm) =>
	entry.count *
	(1 + PHRASE_BONUS_PER_WORD * (entry.words - 1)) *
	(entry.inRequirements ? REQUIREMENTS_BOOST : 1) *
	(entry.isSkill ? KNOWN_SKILL_BOOST : 1);

/**
 * Keeps the highest-weighted terms, dropping any phrase already fully represented by one that
 * outranks it — reporting "react", "react hooks" and "react hooks experience" as three separate
 * gaps would triple-count one missing skill.
 */
function selectTerms(entries: readonly JdTerm[], maxTerms: number): JdTerm[] {
	const ranked = [...entries].sort((a, b) => weigh(b) - weigh(a) || a.term.localeCompare(b.term));
	const selected: JdTerm[] = [];

	for (const entry of ranked) {
		if (selected.length >= maxTerms) break;

		const phrase = (term: string) => term.replace(/-/g, " ");
		const subsumed = selected.some(
			(chosen) =>
				(` ${phrase(chosen.term)} `.includes(` ${phrase(entry.term)} `) ||
					` ${phrase(entry.term)} `.includes(` ${phrase(chosen.term)} `)) &&
				(entry.count <= chosen.count || (chosen.isSkill && !entry.isSkill)),
		);
		if (subsumed) continue;

		selected.push(entry);
	}

	return selected;
}

/**
 * Deterministic keyword coverage between a posting and a resume.
 *
 * This is reported as coverage — "24 of 31 terms" — and never folded into the parse score. The
 * two measure different things: one is whether software can read the file, the other is whether
 * this particular posting's vocabulary appears in it.
 */
export function matchJobDescription(options: JdMatchOptions): JdMatchReport {
	const jdTerms = collectJdTerms(options);
	const selected = selectTerms([...jdTerms.values()], options.maxTerms ?? DEFAULT_MAX_TERMS);

	const resumeCounts = countResumeNgrams(options.resumeText);
	const resumeTokenCount = splitIntoRuns(normalizeForMatching(options.resumeText)).reduce(
		(total, run) => total + tokenize(run).length,
		0,
	);

	const terms: JdTermMatch[] = selected.map((entry) => ({
		term: entry.term,
		jdCount: entry.count,
		resumeCount: resumeCountFor(entry.term, resumeCounts),
		weight: Math.round(weigh(entry) * 1000) / 1000,
		...(entry.isSkill ? { skill: true } : {}),
	}));

	const matched = terms.filter((term) => term.resumeCount > 0);
	const totalWeight = terms.reduce((total, term) => total + term.weight, 0);
	const matchedWeight = matched.reduce((total, term) => total + term.weight, 0);

	return {
		terms,
		matchedTerms: matched.map((term) => term.term),
		missingTerms: terms.filter((term) => term.resumeCount === 0).map((term) => term.term),
		totalTerms: terms.length,
		matchedCount: matched.length,
		weightedCoverage: totalWeight === 0 ? 0 : matchedWeight / totalWeight,
		stuffedTerms: terms
			.filter(
				(term) =>
					term.resumeCount >= STUFFING_MIN_COUNT &&
					term.resumeCount >= term.jdCount * STUFFING_MULTIPLIER &&
					resumeTokenCount > 0 &&
					term.resumeCount / resumeTokenCount >= STUFFING_MIN_DENSITY,
			)
			.map((term) => term.term),
		documentHasHiddenText: options.documentHasHiddenText ?? false,
	};
}
