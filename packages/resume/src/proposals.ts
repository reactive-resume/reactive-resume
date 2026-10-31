import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { escapeHtml, fnv1a } from "@reactive-resume/utils/string";

/**
 * Suggested edits to a document's text, shared by Check, the assistant and Improve. A proposal replaces one passage
 * (a whole `<p>` or `<li>` block) of a rich-text field and is never applied until accepted.
 */

/** A field that holds rich text: the summary's content, an entry's description, or a letter's body. */
export type ProposalTarget = { sectionId: string; itemId?: string; roleId?: string; field: string };

type ProposalSource = "check" | "assistant" | "improve";

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
};

/** Out of date is not stored: it's whenever the passage is no longer in the field. */
export type ProposalState = Proposal["status"] | "stale";

/** The section id a letter's body goes by, so letters share the proposal shape. */
export const LETTER_SECTION_ID = "letter";

type Entry = { id: string } & Record<string, unknown>;

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

export function writeTarget(draft: ResumeData, target: ProposalTarget, value: string) {
	if (!target.itemId) {
		if (target.sectionId === "summary" && target.field === "content") draft.summary.content = value;
		return;
	}

	const entry = findEntry(draft, target);
	if (entry) entry[target.field] = value;
}

/** Acceptance decisions travel with draft history, separately from authored document data. */
export type ProposalApplications = Readonly<Record<string, boolean>>;
export type ProposalSnapshot<T> = { data: T; applications: ProposalApplications };

/** Recovery data is untrusted; only own boolean decisions are restored. */
export function readProposalApplications(value: unknown): ProposalApplications {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return Object.fromEntries(
		Object.entries(value).filter(([id, applied]) => id.length > 0 && id.length <= 128 && typeof applied === "boolean"),
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
	return typeof applied !== "boolean" ? proposal.status : applied ? "accepted" : "pending";
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
	canApplyTo(readTarget(data, proposal.target), proposal);

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
export const getProposalState = (
	data: ResumeData,
	proposal: Proposal,
	applications: ProposalApplications = {},
): ProposalState => getStateIn(readTarget(data, proposal.target), proposal, applications);

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
	const next = applyTo(readTarget(draft, proposal.target), proposal);
	if (next === undefined) return false;
	writeTarget(draft, proposal.target, next);
	return true;
}

export type ProposalApplicationResult = { applied: Proposal[]; stale: Proposal[] };
const isAddition = ({ before, after }: Proposal) => after.startsWith(before) && after.length > before.length;

/** Additions first (backwards at a shared anchor, yielding proposal order), then rewrites. Record only real writes. */
export function applyProposals(
	proposals: readonly Proposal[],
	read: (target: ProposalTarget) => string | undefined,
	write: (target: ProposalTarget, value: string) => void,
	applications: ProposalApplications = {},
): ProposalApplicationResult {
	const unique = [...new Map(proposals.map((proposal) => [proposal.id, proposal])).values()];
	const applied = new Set<string>();
	const stale = new Set<string>();
	const ordered = [...unique.filter(isAddition).reverse(), ...unique.filter((proposal) => !isAddition(proposal))];
	for (const proposal of ordered) {
		if (applied.has(proposal.id) || proposalStatus(proposal, applications) !== "pending") continue;
		const next = applyTo(read(proposal.target), proposal);
		if (next === undefined) stale.add(proposal.id);
		else {
			write(proposal.target, next);
			applied.add(proposal.id);
		}
	}
	return {
		applied: unique.filter((proposal) => applied.has(proposal.id)),
		stale: unique.filter((proposal) => stale.has(proposal.id)),
	};
}

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
