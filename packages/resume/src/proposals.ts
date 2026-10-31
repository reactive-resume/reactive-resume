import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { syncResumeDates, upgradeResumeDates } from "@reactive-resume/schema/resume/dates";
import { parseResumeDataForWrite } from "@reactive-resume/schema/resume/write";
import { escapeHtml, fnv1a } from "@reactive-resume/utils/string";

/**
 * Suggested edits to a document's text, shared by Check, the assistant and Improve. A proposal replaces one passage
 * (a whole `<p>` or `<li>` block) of a rich-text field and is never applied until accepted.
 */

/** A field that holds rich text: the summary's content, an entry's description, or a letter's body. */
export type ProposalTarget = {
	sectionId: string;
	itemId?: string | undefined;
	roleId?: string | undefined;
	field: string;
};

type ProposalSource = "check" | "assistant" | "improve";

/** What a claim the document doesn't back is about. The model names the first six; "term" is a word the server found nowhere in the document. */
export const UNSUPPORTED_CLAIM_KINDS = ["employer", "title", "date", "figure", "skill", "responsibility"] as const;

/** A claim in an edit's new text that nothing checked backs. Shown for review; never saved as a fact. */
export type UnsupportedClaim = { kind: (typeof UNSUPPORTED_CLAIM_KINDS)[number] | "term"; text: string };

/**
 * What the assistant cited for an edit or a posting requirement. A citation is the model's pointer, never proof: the
 * reviewer checks it. A fact is kept by id only, so its text shows only while it's still in Knowledge.
 */
export type ProposalEvidence = { kind: "passage"; location: string; text: string } | { kind: "fact"; id: string };

/** How the assistant read one posting requirement, for a set of edits. */
export type RequirementCoverage = {
	text: string;
	/** An edit addresses it; the assistant cites existing support; it found none; or it wasn't assessed. */
	status: "edited" | "cited" | "missing" | "unassessed";
	evidence: ProposalEvidence[];
	/** Citations that matched nothing the assistant could read. */
	unresolved?: number | undefined;
};

export type Proposal = {
	id: string;
	target: ProposalTarget;
	/** Where it lands, for people: "Experience · Studio Kettle · bullet 1". */
	location: string;
	/** The passage as it is now: a whole `<p>` or `<li>` block, exactly as stored in the field. */
	before: string;
	/** The block to put in its place. An addition keeps `before` and adds the new block after it. */
	after: string;
	/** One line on why. */
	why: string;
	status: "pending" | "accepted" | "rejected";
	source: ProposalSource;
	/** The posting requirement the edit addresses, when tailoring to a job. */
	requirement?: string | undefined;
	/** What the assistant cited for the edit, unverified. */
	evidence?: ProposalEvidence[] | undefined;
	/** Citations that matched nothing the assistant could read. */
	unresolved?: number | undefined;
	/** What the new text says that nothing checked backs: the model's own list plus what the server found. */
	unsupported?: UnsupportedClaim[] | undefined;
	/** The user rewrote the new text before deciding. */
	edited?: boolean | undefined;
	/** Atomic structured changes; before/after remain readable for older clients. */
	snapshot?: { before: string; after: string } | undefined;
};

// A number with what makes it a claim: a currency before it, a unit symbol after it, or the word it counts. "40 people"
// and "$40" are different claims; a bare "40" is its own.
const NUMBER = /([$€£¥₹])?(\d+(?:[.,]\d+)*)(?:\s?([%+]|[kmbx]\b)|\s+(\p{L}{3,}))?/giu;
const YEAR = /^(?:19|20)\d{2}$/;
const singular = (word: string) => {
	const lower = word.toLowerCase().replace(/['’]s$/, "");
	return lower.length > 3 && lower.endsWith("s") ? lower.slice(0, -1) : lower;
};

function numbersIn(text: string) {
	return Array.from(text.matchAll(NUMBER), ([match, currency = "", digits = "", symbol, word]) => {
		const number = digits.replace(/,/g, "");
		// A year is a date whatever follows it.
		if (YEAR.test(number)) return { key: number, text: number, date: true };
		const unit = symbol ? symbol.toLowerCase() : word ? ` ${singular(word)}` : "";
		return { key: `${currency}${number}${unit}`, text: match.trim(), date: false };
	});
}

function wordsIn(text: string) {
	const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
	return Array.from(segmenter.segment(text)).flatMap(({ segment, isWordLike }) =>
		isWordLike && !/^\d/.test(segment) && segment.length > 1 ? [segment] : [],
	);
}

// Claims are compared clause by clause: a full stop (not a decimal point), comma (not a digit separator), semicolon or
// line ends one.
const clausesOf = (text: string) => text.split(/[;!?\n]+|\.(?!\d)|,(?!\d)/).filter((clause) => clause.trim());
// Short subjects matter regardless of case; exclude common short grammar and verbs rather than guessing names.
const SHORT_GLUE = new Set([
	"an",
	"and",
	"as",
	"at",
	"be",
	"by",
	"for",
	"in",
	"is",
	"it",
	"of",
	"on",
	"or",
	"the",
	"to",
	"we",
	"was",
	"our",
	"you",
	"cut",
	"led",
	"ran",
	"use",
]);
const isSubject = (word: string) => !SHORT_GLUE.has(word.toLowerCase());
const contentWords = (text: string) =>
	new Set(wordsIn(text).flatMap((word) => (isSubject(word) ? [singular(word)] : [])));

/**
 * What an edit's new text says that the document can't be shown to back, found without trusting the model.
 *
 * A clause with numbers is backed only when one clause of the edited entry (or role) has all of them, units and years
 * included, and every substantive word it uses (including short names such as aws, gcp, SQL or QA):
 * "Reduced delivery delays 40% in 2020" isn't
 * backed by "Reduced costs 40% in 2020" and "Reduced delivery delays 10% in 2023", so its numbers are flagged rather
 * than reassigned. A reworded claim may be flagged too; the user confirms it. Words that appear nowhere in the
 * document, or in the facts it cites, are flagged too. These are cautious checks, not proof either way.
 */
export function unverifiedClaims(text: string, known: { entry: string; document: string }): UnsupportedClaim[] {
	const sources = clausesOf(known.entry).map((clause) => ({
		numbers: new Set(numbersIn(clause).map((number) => number.key)),
		words: contentWords(clause),
	}));
	const words = new Set(wordsIn(known.document).map(singular));
	const claims = new Map<string, UnsupportedClaim>();
	for (const clause of clausesOf(text)) {
		const numbers = numbersIn(clause);
		if (numbers.length === 0) continue;
		const about = [...contentWords(clause)];
		const backed = sources.some(
			(source) =>
				numbers.every((number) => source.numbers.has(number.key)) && about.every((word) => source.words.has(word)),
		);
		if (backed) continue;
		for (const number of numbers)
			if (!claims.has(number.key)) claims.set(number.key, { kind: number.date ? "date" : "figure", text: number.text });
	}
	for (const word of wordsIn(text)) {
		const key = singular(word);
		if (!words.has(key) && !claims.has(key)) claims.set(key, { kind: "term", text: word });
	}
	return [...claims.values()];
}

/**
 * The proposal with the user's own wording in place of the new text. Flags whose words the user removed go; the rest
 * stay, because editing one word doesn't confirm the others.
 */
export function withEditedText<P extends Pick<Proposal, "before" | "after" | "unsupported">>(
	proposal: P,
	text: string,
): P & { edited: true } {
	const addition =
		proposal.before !== "" &&
		proposal.after.length > proposal.before.length &&
		proposal.after.startsWith(proposal.before);
	const added = addition ? proposal.after.slice(proposal.before.length) : proposal.after;
	const leaf = new RegExp(LEAF_BLOCK.source, "i").exec(added)?.[0] ?? added;
	const block = added.replace(leaf, () => replaceBlockText(leaf, text));
	const written = blockText(block).toLowerCase();
	return {
		...proposal,
		after: addition ? `${proposal.before}${block}` : block,
		unsupported: proposal.unsupported?.filter((claim) => written.includes(claim.text.toLowerCase())),
		edited: true,
	};
}

/** Out of date is not stored: it's whenever the passage is no longer in the field. */
export type ProposalState = Proposal["status"] | "stale";

/** The section id a letter's body goes by, so letters share the proposal shape. */
export const LETTER_SECTION_ID = "letter";

type Entry = { id: string } & Record<string, unknown>;

function stableJson(value: unknown): string {
	return JSON.stringify(value, (_key, item: unknown) =>
		item && typeof item === "object" && !Array.isArray(item)
			? Object.fromEntries(Object.entries(item).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)))
			: item,
	);
}

function normalizedSnapshot(value: string, data: ResumeData) {
	try {
		const snapshot = JSON.parse(value);
		return resumeStructureSnapshot({
			...data,
			basics: snapshot.basics,
			summary: snapshot.summary,
			sections: snapshot.sections,
			customSections: snapshot.customSections,
			metadata: { ...data.metadata, layout: snapshot.layout },
		});
	} catch {
		return value;
	}
}

/** Content/layout only: proposal history must not duplicate pictures, styles or private metadata. */
export function resumeStructureSnapshot(data: ResumeData): string {
	// JSONB key order and read/save date upgrades must not make unchanged content stale.
	const content = JSON.parse(
		JSON.stringify({
			basics: data.basics,
			summary: data.summary,
			sections: data.sections,
			customSections: data.customSections,
			metadata: { page: data.metadata.page, layout: data.metadata.layout },
		}),
	) as ResumeData;
	upgradeResumeDates(content);
	syncResumeDates(content);
	return stableJson({
		basics: content.basics,
		summary: content.summary,
		sections: content.sections,
		customSections: content.customSections,
		layout: content.metadata.layout,
	});
}

function findEntry(data: ResumeData, { sectionId, itemId, roleId }: ProposalTarget): Entry | undefined {
	const builtin = (data.sections as Record<string, { items: Entry[] } | undefined>)[sectionId];
	const items = builtin?.items ?? data.customSections.find((section) => section.id === sectionId)?.items;
	const entry = (items as Entry[] | undefined)?.find((entry) => entry.id === itemId);
	return roleId
		? Array.isArray(entry?.roles)
			? (entry.roles as Entry[]).find((role) => role.id === roleId)
			: undefined
		: entry;
}

export function readTarget(data: ResumeData, target: ProposalTarget): string | undefined {
	if (!target.itemId)
		return target.sectionId === "summary" && target.field === "content" ? data.summary.content : undefined;

	const value = findEntry(data, target)?.[target.field];
	return typeof value === "string" ? value : undefined;
}

// An entry's text, one line per field or bullet, without ids, links or other roles, whose digits aren't claims.
const entryLines = (value: unknown, key = ""): string[] => {
	if (typeof value === "string") {
		if (key === "id" || key === "url") return [];
		const blocks = splitBlocks(value);
		return blocks.length > 0 ? blocks.map((block) => block.text) : [blockText(value)];
	}
	if (Array.isArray(value)) return key === "roles" ? [] : value.flatMap((item) => entryLines(item));
	if (value && typeof value === "object")
		return Object.entries(value).flatMap(([name, item]) => entryLines(item, name));
	return [];
};

/**
 * What the edited entry says, one line per field or bullet: its own dates and fields, and for a role only that role.
 * An edit's figures are checked against it.
 */
export function entryText(data: ResumeData, target: ProposalTarget): string {
	if (!target.itemId) return target.sectionId === "summary" ? entryLines(data.summary.content).join("\n") : "";
	const { roleId, ...entry } = target;
	return [...entryLines(findEntry(data, entry)), ...(roleId ? entryLines(findEntry(data, target)) : [])].join("\n");
}

export function writeTarget(draft: ResumeData, target: ProposalTarget, value: string) {
	if (!target.itemId) {
		if (target.sectionId === "summary" && target.field === "content") draft.summary.content = value;
		return;
	}

	const entry = findEntry(draft, target);
	if (entry) entry[target.field] = value;
}

/**
 * Acceptance decisions travel with draft history, separately from authored document data. `false` takes an edit back.
 * Applying records the wording the user reviewed (the edit's `after`), or `snapshot:<id>` for a structural proposal.
 * Structural IDs name immutable server-generated snapshots; a different proposal always gets a new ID.
 * The receipt binds to that version of the edit,
 * whatever the field becomes through other edits at the same place, refinement or undo and redo. `true` (older apps,
 * API clients) applies without naming a version.
 */
export type ProposalApplications = Readonly<Record<string, boolean | string>>;
export type ProposalSnapshot<T> = { data: T; applications: ProposalApplications };

/** Longest reviewed wording a decision may carry. */
export const MAX_REVIEWED_WORDING = 20_000;

/** Structural summaries can exceed the receipt bound; their immutable identity needs no copy of the summary. */
export const appliedApplications = (
	applied: readonly Pick<Proposal, "id" | "after" | "snapshot">[],
): ProposalApplications =>
	Object.fromEntries(
		applied.map((proposal) => [proposal.id, proposal.snapshot ? `snapshot:${proposal.id}` : proposal.after]),
	);

/** Recovery data is untrusted; only own decisions are restored. */
export function readProposalApplications(value: unknown): ProposalApplications {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return Object.fromEntries(
		Object.entries(value).filter(
			([id, applied]) =>
				id.length > 0 &&
				id.length <= 128 &&
				(typeof applied === "boolean" || (typeof applied === "string" && applied.length <= MAX_REVIEWED_WORDING)),
		),
	);
}

/** Keep decisions made while a save was in flight; acknowledge only the submitted values. */
export const acknowledgeProposalApplications = (
	pending: ProposalApplications,
	submitted: ProposalApplications,
): ProposalApplications =>
	Object.fromEntries(Object.entries(pending).filter(([id, applied]) => submitted[id] !== applied));

export const queueProposalApplications = (
	previous: ProposalApplications,
	next: ProposalApplications,
	pending: ProposalApplications,
): ProposalApplications => ({
	...pending,
	...Object.fromEntries(Object.entries(next).filter(([id, applied]) => previous[id] !== applied)),
});

/** IDs absent from an older checkpoint were explicitly undone; normal edits never call this. */
export const restoreProposalApplications = (
	current: ProposalApplications,
	snapshot: ProposalApplications,
): ProposalApplications => ({
	...Object.fromEntries(Object.keys(current).map((id) => [id, false])),
	...snapshot,
});

export function proposalStatus(proposal: Proposal, applications: ProposalApplications = {}): Proposal["status"] {
	if (proposal.status === "rejected") return "rejected";
	const applied = applications[proposal.id];
	return applied === undefined ? proposal.status : applied === false ? "pending" : "accepted";
}

// TipTap serializes text-node quotes literally. Canonicalize only quotes in text, retaining source offsets and
// keeping escaped markup distinct from real tags. Other structure still has to match exactly.
function quoteNormalized(html: string) {
	let text = "";
	const offsets: number[] = [];
	let inTag = false;
	let attributeQuote: string | undefined;
	for (let index = 0; index < html.length; index++) {
		const char = html[index] ?? "";
		if (!inTag && char === "<") inTag = true;
		else if (inTag) {
			if (attributeQuote) {
				if (char === attributeQuote) attributeQuote = undefined;
			} else if (char === '"' || char === "'") attributeQuote = char;
			else if (char === ">") inTag = false;
		}
		const entity =
			!inTag && char === "&" ? /^&(?:apos|quot|#0*(?:34|39)|#x0*(?:22|27));/i.exec(html.slice(index))?.[0] : undefined;
		offsets.push(index);
		text += entity ? decodeEntities(entity) : char;
		if (entity) index += entity.length - 1;
	}
	offsets.push(html.length);
	return { text, offsets };
}

function passageRange(value: string | undefined, before: string): { start: number; end: number } | undefined {
	if (value === undefined) return undefined;
	if (!before) return value === "" ? { start: 0, end: 0 } : undefined;
	const actual = quoteNormalized(value);
	const expected = quoteNormalized(before).text;
	const start = actual.text.indexOf(expected);
	if (start < 0 || actual.text.indexOf(expected, start + 1) >= 0) return undefined;
	return { start: actual.offsets[start] ?? 0, end: actual.offsets[start + expected.length] ?? value.length };
}

/** A pending proposal requires one unambiguous original passage; equivalent text-node quotes are allowed. */
export const canApplyTo = (value: string | undefined, { before }: Pick<Proposal, "before">) =>
	passageRange(value, before) !== undefined;
export const canApply = (data: ResumeData, proposal: Proposal) =>
	proposal.snapshot
		? resumeStructureSnapshot(data) === normalizedSnapshot(proposal.snapshot.before, data)
		: canApplyTo(readTarget(data, proposal.target), proposal);

/**
 * Whether the resume holds the proposal exactly as proposed: a structural change's whole proposed structure, or a
 * passage edit's new text once. Receipts that don't name the wording they applied (`true`, older apps) need this.
 */
export const holdsProposal = (data: ResumeData, proposal: Pick<Proposal, "after" | "target" | "snapshot">) =>
	proposal.snapshot
		? resumeStructureSnapshot(data) === normalizedSnapshot(proposal.snapshot.after, data)
		: canApplyTo(readTarget(data, proposal.target), { before: proposal.after });

/** Recorded acceptance survives refinements and normalization. Text is placement evidence, never acceptance proof. */
export function getStateIn(
	value: string | undefined,
	proposal: Proposal,
	applications: ProposalApplications = {},
): ProposalState {
	const status = proposalStatus(proposal, applications);
	if (status !== "pending") return status;
	return applyTo(value, proposal) !== undefined ? "pending" : "stale";
}
export function getProposalState(
	data: ResumeData,
	proposal: Proposal,
	applications: ProposalApplications = {},
): ProposalState {
	if (!proposal.snapshot) return getStateIn(readTarget(data, proposal.target), proposal, applications);
	const status = proposalStatus(proposal, applications);
	if (status !== "pending") return status;
	const current = resumeStructureSnapshot(data);
	return current === normalizedSnapshot(proposal.snapshot.before, data) &&
		current !== normalizedSnapshot(proposal.snapshot.after, data)
		? "pending"
		: "stale";
}

/** The text with `after` in place of the unique original passage, or undefined when it cannot be placed. */
export function applyTo(value: string | undefined, proposal: Pick<Proposal, "before" | "after">) {
	if (value === undefined || proposal.before === proposal.after) return undefined;
	const range = passageRange(value, proposal.before);
	if (!range) return undefined;
	// For additions, preserve the live anchor's serialization instead of putting model-era HTML back.
	const after = proposal.after.startsWith(proposal.before)
		? value.slice(range.start, range.end) + proposal.after.slice(proposal.before.length)
		: proposal.after;
	const next = value.slice(0, range.start) + after + value.slice(range.end);
	return next === value ? undefined : next;
}

export function applyProposal(draft: ResumeData, proposal: Proposal): boolean {
	if (proposal.snapshot) {
		if (
			proposal.target.sectionId !== "resume" ||
			proposal.target.field !== "data" ||
			resumeStructureSnapshot(draft) !== normalizedSnapshot(proposal.snapshot.before, draft)
		)
			return false;
		try {
			const snapshot = JSON.parse(proposal.snapshot.after);
			const next = parseResumeDataForWrite({
				...draft,
				basics: snapshot.basics,
				summary: snapshot.summary,
				sections: snapshot.sections,
				customSections: snapshot.customSections,
				metadata: { ...draft.metadata, layout: snapshot.layout },
			});
			if (resumeStructureSnapshot(next) === resumeStructureSnapshot(draft)) return false;
			Object.assign(draft, {
				basics: next.basics,
				summary: next.summary,
				sections: next.sections,
				customSections: next.customSections,
				metadata: next.metadata,
			});
			return true;
		} catch {
			return false;
		}
	}
	const next = applyTo(readTarget(draft, proposal.target), proposal);
	if (next === undefined) return false;
	writeTarget(draft, proposal.target, next);
	return true;
}

export type ProposalApplicationResult = { applied: Proposal[]; stale: Proposal[] };
const isAddition = ({ before, after, snapshot }: Proposal) =>
	!snapshot && after.startsWith(before) && after.length > before.length;

/** Additions first (backwards at a shared anchor, yielding proposal order), then rewrites. Record only real writes. */
export function applyProposals(
	proposals: readonly Proposal[],
	read: (target: ProposalTarget) => string | undefined,
	write: (target: ProposalTarget, value: string) => void,
	applications: ProposalApplications = {},
): ProposalApplicationResult {
	return applyDecisions(
		proposals,
		(proposal) => {
			if (proposal.snapshot) return false;
			const next = applyTo(read(proposal.target), proposal);
			if (next === undefined) return false;
			write(proposal.target, next);
			return true;
		},
		applications,
	);
}

/** Resume snapshots and passage edits use the same ordering and successful-write receipts. */
export function applyResumeProposals(
	draft: ResumeData,
	proposals: readonly Proposal[],
	applications: ProposalApplications = {},
): ProposalApplicationResult {
	return applyDecisions(proposals, (proposal) => applyProposal(draft, proposal), applications);
}

function applyDecisions(
	proposals: readonly Proposal[],
	apply: (proposal: Proposal) => boolean,
	applications: ProposalApplications,
): ProposalApplicationResult {
	const unique = [...new Map(proposals.map((proposal) => [proposal.id, proposal])).values()];
	const applied = new Set<string>();
	const stale = new Set<string>();
	const ordered = [...unique.filter(isAddition).reverse(), ...unique.filter((proposal) => !isAddition(proposal))];
	for (const proposal of ordered) {
		if (applied.has(proposal.id) || proposalStatus(proposal, applications) !== "pending") continue;
		if (apply(proposal)) applied.add(proposal.id);
		else stale.add(proposal.id);
	}
	return {
		applied: unique.filter((proposal) => applied.has(proposal.id)),
		stale: unique.filter((proposal) => stale.has(proposal.id)),
	};
}

export const proposalText = (proposal: Pick<Proposal, "before" | "after" | "snapshot">, side: "before" | "after") =>
	proposal.snapshot ? proposal[side] : blockText(proposal[side]);

const BLOCK = /^(<(p|li)(?:\s[^>]*)?>)([\s\S]*)(<\/\2>)$/i;

/** A block's opening tag, contents and closing tag; `undefined` for anything else. */
export function splitBlock(html: string) {
	const match = BLOCK.exec(html);
	return match ? { open: match[1] ?? "", inner: match[3] ?? "", close: match[4] ?? "" } : undefined;
}

/**
 * The block with its text replaced by plain text (a model's rewrite), keeping the tag and its attributes. An empty
 * field's "block" becomes a paragraph.
 */
export function replaceBlockText(block: string, text: string): string {
	const html = escapeHtml(text.trim().replace(/\s+/g, " "));
	const parts = splitBlock(block);
	if (parts) return `${parts.open}${html}${parts.close}`;
	return block === "" ? `<p>${html}</p>` : html;
}

/**
 * An addition after a passage, as a replacement: the passage (with its list item's end, for a bullet) stays, and a
 * new block of the same kind follows it, so a new bullet lands as its own list item.
 */
export function additionAfter(value: string, passageHtml: string, text: string) {
	if (!canApplyTo(value, { before: passageHtml })) return undefined;
	const index = value.indexOf(passageHtml);
	if (index < 0) return undefined;

	const block = replaceBlockText(passageHtml, text);
	const closing = /^\s*<\/li>/i.exec(value.slice(index + passageHtml.length));
	if (!closing) return { before: passageHtml, after: `${passageHtml}${block}` };

	const before = `${passageHtml}${closing[0]}`;
	return { before, after: `${before}<li>${block}</li>` };
}

// A paragraph or list item with no paragraph or list item inside it: `<li><p>…</p></li>` yields the `<p>`.
const LEAF_BLOCK = /<(p|li)(?:\s[^>]*)?>((?:(?!<\/?(?:p|li)[\s>])[\s\S])*?)<\/\1>/gi;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

const decodeEntities = (text: string) =>
	text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
		if (name.startsWith("#")) {
			const code = /^#x/i.test(name) ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
			// Out of range (`&#99999999;`) stays as written instead of throwing.
			return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
		}
		return ENTITIES[name.toLowerCase()] ?? entity;
	});

/** The visible text of some HTML, on one line. */
export const blockText = (html: string) =>
	// `[^<>]` stops a run of unclosed `<` from rescanning to the end once per bracket.
	decodeEntities(html.replace(/<[^<>]*>/g, ""))
		.replace(/\s+/g, " ")
		.trim();

export type Block = { html: string; text: string; bullet: boolean };

/** The leaf paragraphs and list items of rich text, in order, skipping empty ones. */
export function splitBlocks(html: string): Block[] {
	const blocks: Block[] = [];
	let scannedTo = 0;
	let listDepth = 0;

	for (const match of html.matchAll(LEAF_BLOCK)) {
		const text = blockText(match[2] ?? "");
		if (!text) continue;

		// Inside a list when more <li> have opened than closed before this block.
		const preceding = html.slice(scannedTo, match.index);
		const opened = preceding.match(/<li[\s>]/gi)?.length ?? 0;
		const closed = preceding.match(/<\/li>/gi)?.length ?? 0;
		listDepth += opened - closed;
		scannedTo = match.index;
		blocks.push({ html: match[0], text, bullet: match[1]?.toLowerCase() === "li" || listDepth > 0 });
	}

	return blocks;
}

/** A bullet or paragraph an edit can target, with where it sits. */
export type Passage = {
	/** Derived from where the passage is and what it says, so an edit made against older text can't land. */
	id: string;
	target: ProposalTarget;
	/** "Experience · Studio Kettle · bullet 1". */
	location: string;
	/** The whole block (`<p>…</p>` or `<li>…</li>`) exactly as stored, so a proposal can find it again. */
	html: string;
	text: string;
};

export type PassageLabels = {
	/** Also list an empty (visible) summary or letter body, so something can be written into it. */
	includeEmpty?: boolean;
	summary: string;
	sectionTitle: (sectionId: string) => string;
	/** The entry as people know it: its company, school or name. */
	entryTitle: (sectionType: string, entry: Record<string, unknown>) => string;
	bullet: (n: number) => string;
	paragraph: (n: number) => string;
};

// FNV-1a: short and stable. The text is part of the key, so ids never outlive the words they name.
const hash = (value: string) => fnv1a(value).toString(36);

function passagesOf(
	html: string,
	target: ProposalTarget,
	where: string[],
	labels: Pick<PassageLabels, "bullet" | "paragraph" | "includeEmpty">,
	seen: Map<string, number>,
): Passage[] {
	let bullets = 0;
	let paragraphs = 0;
	const blocks = splitBlocks(html);

	// An empty field is one empty passage, written into by replacing "".
	if (blocks.length === 0 && labels.includeEmpty && !html.trim()) {
		return [
			{
				id: `p_${hash(`${target.sectionId}|${target.itemId ?? ""}|${target.roleId ?? ""}|${target.field}|`)}`,
				target,
				location: where.join(" · "),
				html: "",
				text: "",
			},
		];
	}

	return blocks.map((block) => {
		const place = block.bullet ? labels.bullet(++bullets) : labels.paragraph(++paragraphs);
		const base = `p_${hash(`${target.sectionId}|${target.itemId ?? ""}|${target.roleId ?? ""}|${target.field}|${block.text}`)}`;
		const count = (seen.get(base) ?? 0) + 1;
		seen.set(base, count);
		return {
			id: count === 1 ? base : `${base}_${count}`,
			target,
			location: [...where, place].join(" · "),
			html: block.html,
			text: block.text,
		};
	});
}

/**
 * Every passage an edit can target, in page order: the summary's paragraphs, then each visible entry's description,
 * section by section. Hidden sections and entries don't print, so they're left out.
 */
export function collectPassages(data: ResumeData, labels: PassageLabels): Passage[] {
	const seen = new Map<string, number>();
	const passages: Passage[] = [];

	if (!data.summary.hidden)
		passages.push(
			...passagesOf(data.summary.content, { sectionId: "summary", field: "content" }, [labels.summary], labels, seen),
		);

	type Section = { id: string; type: string; hidden: boolean; items: Entry[] };
	const sections: Section[] = [
		...Object.entries(data.sections).map(([id, section]) => ({
			id,
			type: id,
			hidden: section.hidden,
			items: section.items as unknown as Entry[],
		})),
		...data.customSections.map((section) => ({
			id: section.id,
			type: section.type as string,
			hidden: section.hidden,
			items: section.items as unknown as Entry[],
		})),
	];

	for (const section of sections) {
		if (section.hidden || section.type === "cover-letter") continue;

		for (const entry of section.items) {
			if (entry.hidden) continue;
			const title = labels.entryTitle(section.type, entry);
			const where = [labels.sectionTitle(section.id), ...(title ? [title] : [])];
			const field = section.type === "summary" ? "content" : "description";
			if (typeof entry[field] === "string")
				passages.push(
					...passagesOf(entry[field], { sectionId: section.id, itemId: entry.id, field }, where, labels, seen),
				);
			if (Array.isArray(entry.roles))
				for (const role of entry.roles as Entry[]) {
					if (typeof role.description !== "string") continue;
					passages.push(
						...passagesOf(
							role.description,
							{ sectionId: section.id, itemId: entry.id, roleId: role.id, field: "description" },
							[...where, ...(typeof role.position === "string" && role.position ? [role.position] : [])],
							labels,
							seen,
						),
					);
				}
		}
	}

	return passages;
}

/** A letter's body, passage by passage. */
export const collectLetterPassages = (
	content: string,
	labels: Pick<PassageLabels, "bullet" | "paragraph" | "includeEmpty"> & { body: string },
) => passagesOf(content, { sectionId: LETTER_SECTION_ID, field: "content" }, [labels.body], labels, new Map());
