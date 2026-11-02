import type {
	ProposeEditsInput,
	ProposeEditsOutput,
	ProposeResumeEditsInput,
} from "@reactive-resume/ai/tools/agent-tool-contracts";
import type { Passage, ProposalEvidence, ProposalTarget, RequirementCoverage } from "@reactive-resume/resume/proposals";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { UIMessage } from "ai";
import { ORPCError } from "@orpc/client";
import { and, desc, eq } from "drizzle-orm";
import {
	proposeEditsInputSchema,
	proposeResumeEditsInputSchema,
	REVOKED_PASSAGE,
	tailoringAllows,
} from "@reactive-resume/ai/tools/agent-tool-contracts";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { createEntry } from "@reactive-resume/resume/entries";
import { buildMarkdown, getVisibleResumeStructure } from "@reactive-resume/resume/markdown";
import {
	additionAfter,
	applyResumeProposals,
	blockText,
	canApplyTo,
	collectLetterPassages,
	collectPassages,
	entryText,
	readTarget,
	replaceBlockText,
	resumeStructureSnapshot,
	unverifiedClaims,
} from "@reactive-resume/resume/proposals";
import { applyResumeStructureChange, resumeEntryTypeSchema } from "@reactive-resume/resume/structural-proposals";
import { syncResumeDates, upgradeResumeDates } from "@reactive-resume/schema/resume/dates";
import { generateId } from "@reactive-resume/utils/string";
import { coverLetterService } from "../cover-letters/service";
import { resumeService } from "../resume/service";
import { assertResumeChangeProse } from "./prose";
import { entryReview } from "./review";

/** The one document a conversation is about. */
export type AssistantDocument = { kind: "resume" | "letter"; id: string };

export const documentOf = (thread: {
	workingResumeId: string | null;
	coverLetterId: string | null;
}): AssistantDocument | null => {
	if (thread.coverLetterId) return { kind: "letter", id: thread.coverLetterId };
	return thread.workingResumeId ? { kind: "resume", id: thread.workingResumeId } : null;
};

// The model reads passage locations in English; the editor shows its own, translated.
const LABELS = {
	includeEmpty: true,
	summary: "Summary",
	bullet: (n: number) => `bullet ${n}`,
	paragraph: (n: number) => `paragraph ${n}`,
};

const ENTRY_TITLE_FIELDS = ["company", "school", "organization", "name", "title", "network", "language", "position"];

function entryTitle(_type: string, entry: Record<string, unknown>) {
	for (const field of ENTRY_TITLE_FIELDS) {
		const value = entry[field];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return "";
}

function sectionTitle(data: ResumeData, sectionId: string) {
	const custom = data.customSections.find((section) => section.id === sectionId);
	const title =
		sectionId === "summary"
			? data.summary.title
			: custom
				? custom.title
				: data.sections[sectionId as keyof ResumeData["sections"]]?.title;
	const fallback = (custom?.type ?? sectionId).replace(/-/g, " ");
	return title?.trim() || fallback.charAt(0).toUpperCase() + fallback.slice(1);
}

function sectionLocation(data: ResumeData, sectionId: string) {
	const title = sectionTitle(data, sectionId);
	const ids = ["basics", "summary", ...Object.keys(data.sections), ...data.customSections.map((section) => section.id)];
	if (ids.filter((id) => sectionTitle(data, id) === title).length < 2) return title;
	const ordered = [
		...new Set([...data.metadata.layout.pages.flatMap((page) => [...page.main, ...page.sidebar]), ...ids]),
	].filter((id) => ids.includes(id));
	return `${title} · Section ${ordered.indexOf(sectionId) + 1}`;
}

type LoadedDocument = {
	kind: AssistantDocument["kind"];
	name: string;
	updatedAt: Date;
	locked: boolean;
	sourceResume?: { id: string; updatedAt: Date } | undefined;
	applicationId: string | null;
	passages: Passage[];
	/** The field a proposal targets, as it reads now. */
	read: (target: ProposalTarget) => string | undefined;
	/** Everything the targeted entry says (a letter has none beyond the passage): what new figures are checked against. */
	entry: (target: ProposalTarget) => string;
	/** What read_resume / read_letter returns to the model. */
	view: Record<string, unknown>;
	resume?: ResumeData;
};

export async function loadDocument(userId: string, document: AssistantDocument): Promise<LoadedDocument> {
	if (document.kind === "resume") {
		const resume = await resumeService.getById({ id: document.id, userId });
		const passages = collectPassages(resume.data, {
			...LABELS,
			sectionTitle: (sectionId) => sectionLocation(resume.data, sectionId),
			entryTitle,
		});

		return {
			kind: "resume",
			resume: resume.data,
			name: resume.name,
			updatedAt: resume.updatedAt,
			locked: resume.isLocked,
			applicationId: resume.applicationId,
			passages,
			read: (target) => readTarget(resume.data, target),
			entry: (target) => entryText(resume.data, target),
			view: {
				resume: buildMarkdown(resume.data),
				structure: getVisibleResumeStructure(resume.data),
				entryTemplates: Object.fromEntries(resumeEntryTypeSchema.options.map((type) => [type, createEntry(type)])),
			},
		};
	}

	const letter = await coverLetterService.getById({ id: document.id, userId });
	const passages = collectLetterPassages(letter.content, { ...LABELS, body: "Letter" });
	// The letter's facts come from its resume.
	const resume = letter.sourceResumeId
		? await resumeService.getById({ id: letter.sourceResumeId, userId }).catch(() => null)
		: null;

	return {
		kind: "letter",
		sourceResume: resume ? { id: resume.id, updatedAt: resume.updatedAt } : undefined,
		name: letter.name,
		updatedAt: letter.updatedAt,
		locked: letter.isLocked,
		applicationId: letter.sourceApplicationId,
		passages,
		read: (target) => (target.field === "content" ? letter.content : undefined),
		entry: () => "",
		view: {
			sender: letter.style.basics.name,
			recipient:
				letter.layout === "structured"
					? { name: letter.recipientName, company: letter.recipientCompany, date: letter.letterDate }
					: blockText(letter.recipient),
			note: "The greeting and sign-off are added around the body automatically; propose edits to the body only.",
			...(resume ? { resume: buildMarkdown(resume.data) } : {}),
		},
	};
}

/** The read tool's result: the document's text and every passage an edit can target. */
export function documentView(document: LoadedDocument) {
	return {
		name: document.name,
		updatedAt: document.updatedAt.toISOString(),
		// `data` holds the snapshot; older snapshots are pruned from the model's context.
		data: {
			...document.view,
			passages: document.passages.map((passage) => ({
				id: passage.id,
				sectionId: passage.target.sectionId,
				location: passage.location,
				text: passage.text || "(empty)",
			})),
		},
	};
}

/** The posting of the application the document is for: its role, company and description or requirements. */
export async function findPosting(
	userId: string,
	documentId: string,
	loaded: Pick<LoadedDocument, "kind" | "applicationId">,
	applicationId?: string,
) {
	// A resume made for an application says so; otherwise, the latest application it's linked to.
	const selectedId = applicationId ?? loaded.applicationId;
	if (!selectedId && loaded.kind === "letter") return null;
	const table = schema.application;
	const [application] = await db
		.select({
			id: table.id,
			updatedAt: table.updatedAt,
			role: table.role,
			company: table.company,
			jobDescription: table.jobDescription,
			requirements: table.requirements,
			notes: table.notes,
		})
		.from(table)
		.where(and(eq(table.userId, userId), selectedId ? eq(table.id, selectedId) : eq(table.resumeId, documentId)))
		.orderBy(desc(table.updatedAt))
		.limit(1);
	if (!application) return null;

	const text =
		application.jobDescription?.trim() ||
		(application.requirements.length > 0 ? application.requirements.map((item) => `- ${item}`).join("\n") : "");
	return {
		applicationId: application.id,
		updatedAt: application.updatedAt,
		role: application.role,
		company: application.company,
		text,
		notes: application.notes?.trim() ?? "",
		requirements: application.requirements,
	};
}

export const NOT_JOB_COPY_MESSAGE =
	"Edits that use the posting go to a copy of this resume made for the job, so the original stays unchanged. Copy it for this job first, or leave the posting out to edit this resume.";

/**
 * What a set of edits is reviewed against beyond the document: Knowledge facts shared this turn (id to text), and the
 * posting shared with the message, if any.
 */
export type ReviewContext = {
	facts: ReadonlyMap<string, string>;
	posting: { applicationId: string; requirements: readonly string[] } | null;
};

const NO_REVIEW_CONTEXT: ReviewContext = { facts: new Map(), posting: null };

type ReviewFields = Pick<
	ProposeEditsInput["edits"][number],
	"requirement" | "evidence" | "factIds" | "unsupported" | "addsClaims"
>;
type Cite = (
	passageIds?: readonly string[],
	factIds?: readonly string[],
) => { evidence: ProposalEvidence[]; unresolved: number };
/** What a reviewed change shows the user: the requirement it addresses, what's cited, what nothing backs. */
type Review = Partial<
	Pick<ProposeEditsOutput["edits"][number], "requirement" | "evidence" | "unresolved" | "unsupported" | "addsClaims">
>;

/**
 * Reviews proposed text against this document and the facts shared this turn. Citations are the model's pointers: they
 * resolve only to this document's passages and those facts, and never count as proof. Claims nothing cited backs are
 * flagged: the model's own list first, then what the server finds that it left out.
 */
function reviewer(document: LoadedDocument, review: ReviewContext) {
	const byId = new Map(document.passages.map((passage) => [passage.id, passage]));
	const documentText = `${document.passages.map((passage) => passage.text).join("\n")}\n${JSON.stringify(document.view)}`;
	const cite: Cite = (passageIds = [], factIds = []) => {
		const evidence: ProposalEvidence[] = [];
		let unresolved = 0;
		for (const id of new Set(passageIds)) {
			const passage = byId.get(id);
			if (passage?.text) evidence.push({ kind: "passage", location: passage.location, text: passage.text });
			else unresolved++;
		}
		for (const id of new Set(factIds)) {
			if (review.facts.has(id)) evidence.push({ kind: "fact", id });
			else unresolved++;
		}
		return { evidence, unresolved };
	};
	/** `text`: what the change says; `entry`: what the entry it changes already says. */
	const reviewOf = (fields: ReviewFields, text: string, entry: string): Review => {
		const { evidence, unresolved } = cite(fields.evidence, fields.factIds);
		const citedFacts = (fields.factIds ?? []).flatMap((id) => review.facts.get(id) ?? []);
		const declared = fields.unsupported ?? [];
		const flagged = declared.map((claim) => claim.text.toLowerCase()).join("\n");
		const found = unverifiedClaims(text, { entry, document: [documentText, ...citedFacts].join("\n") }).filter(
			(claim) => !flagged.includes(claim.text.toLowerCase()),
		);
		const unsupported = [...declared, ...found];
		return {
			...(fields.requirement ? { requirement: fields.requirement } : {}),
			...(evidence.length > 0 ? { evidence } : {}),
			...(unresolved > 0 ? { unresolved } : {}),
			...(unsupported.length > 0 ? { unsupported } : {}),
			// A word the document doesn't use ("term") is too weak a sign on its own: most rewrites have one.
			...(fields.addsClaims || unsupported.some((claim) => claim.kind !== "term") ? { addsClaims: true } : {}),
		};
	};
	return { byId, cite, reviewOf };
}

/**
 * What every set of resume edits carries: which job's copy it's for (accepting it anywhere else would tailor a resume
 * other jobs share), and the posting's requirements as the assistant read them.
 */
function reviewedSet(
	document: LoadedDocument,
	review: ReviewContext,
	requirements: ProposeEditsInput["requirements"],
	addressed: readonly (string | undefined)[],
	cite: Cite,
) {
	return {
		...(document.kind === "resume" ? { tailoredFor: review.posting?.applicationId ?? null } : {}),
		...coverage(requirements, review, addressed, cite),
	};
}

/**
 * Places the model's edits on the document as it is now. An edit whose passage id no longer exists (the words
 * changed since the document was read) is skipped, with a reason the model can act on.
 */
export function resolveEdits(
	document: LoadedDocument,
	input: ProposeEditsInput,
	review: ReviewContext = NO_REVIEW_CONTEXT,
): ProposeEditsOutput {
	const { byId, cite, reviewOf } = reviewer(document, review);
	const edits: ProposeEditsOutput["edits"] = [];
	const skipped: ProposeEditsOutput["skipped"] = [];

	for (const edit of input.edits) {
		const passage = byId.get(edit.passageId);
		if (!passage) {
			skipped.push({
				passageId: edit.passageId,
				reason: "That text no longer exists: the document changed since it was read. Read it again.",
			});
			continue;
		}
		if (!canApplyTo(document.read(passage.target), { before: passage.html })) {
			skipped.push({
				passageId: edit.passageId,
				reason: "This text repeats or changed. Edit it manually, or read the document again.",
			});
			continue;
		}

		const placed = edit.add
			? additionAfter(document.read(passage.target) ?? "", passage.html, edit.text)
			: { before: passage.html, after: replaceBlockText(passage.html, edit.text) };
		if (!placed || placed.after === placed.before) {
			skipped.push({ passageId: edit.passageId, reason: "The suggestion doesn't change the text." });
			continue;
		}

		edits.push({
			id: generateId(),
			target: passage.target,
			location: passage.location,
			before: placed.before,
			after: placed.after,
			why: edit.why,
			status: "pending",
			...reviewOf(edit, edit.text, `${passage.text}\n${document.entry(passage.target)}`),
		});
	}

	return {
		title: input.title,
		edits,
		skipped,
		...reviewedSet(
			document,
			review,
			input.requirements,
			edits.map((edit) => edit.requirement),
			cite,
		),
	};
}

/**
 * The posting's requirements as the assistant read them. "Edited" holds only when an edit that was actually placed
 * names the requirement; otherwise it falls back to what the citations show. Listed requirements it didn't mention
 * are added as not assessed, so a gap can't disappear by being left out.
 */
function coverage(
	requirements: ProposeEditsInput["requirements"],
	review: ReviewContext,
	placed: readonly (string | undefined)[],
	cite: Cite,
): { requirements?: RequirementCoverage[] } {
	const key = (text: string) => text.trim().toLowerCase();
	const addressed = new Set(placed.flatMap((requirement) => (requirement ? [key(requirement)] : [])));
	const read = (requirements ?? []).map(({ text, status, passageIds, factIds }) => {
		const { evidence, unresolved } = cite(passageIds, factIds);
		const shown: RequirementCoverage["status"] =
			status === "edited" && addressed.has(key(text))
				? "edited"
				: status === "missing"
					? "missing"
					: // A claimed edit that wasn't placed, or "cited" with nothing that resolves, isn't coverage.
						evidence.length > 0
						? "cited"
						: status === "cited"
							? "missing"
							: "unassessed";
		return { text, status: shown, evidence, ...(unresolved ? { unresolved } : {}) };
	});
	const mentioned = new Set(read.map((item) => key(item.text)));
	const unassessed = (review.posting?.requirements ?? [])
		.filter((text) => text.trim() && !mentioned.has(key(text)))
		.map((text) => ({ text, status: "unassessed" as const, evidence: [] }));
	const all = [...read, ...unassessed];
	return all.length > 0 ? { requirements: all } : {};
}

/**
 * A restored message with resume edits that can't be accepted on this resume withheld (see tailoringAllows): a pending
 * edit's passage (a structural change's snapshot) becomes one no document contains, so every app, older ones included, shows it out of date instead of
 * offering to apply it. Decided edits keep what happened to them. Stored messages are unchanged.
 */
export function withUsableTailoring(message: UIMessage, madeFor: string | null): UIMessage {
	if (!message.parts.some((part) => part.type === "tool-propose_edits")) return message;
	return {
		...message,
		parts: message.parts.map((part) => {
			const output = (part as { output?: ProposeEditsOutput }).output;
			if (part.type !== "tool-propose_edits" || !output?.edits || tailoringAllows(message, output, madeFor))
				return part;
			return {
				...part,
				output: {
					...output,
					revoked: true,
					// A structural change keeps its readable summary; its snapshot can't match any resume.
					edits: output.edits.map((edit) =>
						edit.status !== "pending"
							? edit
							: edit.snapshot
								? { ...edit, snapshot: { ...edit.snapshot, before: REVOKED_PASSAGE } }
								: { ...edit, before: REVOKED_PASSAGE },
					),
				},
			} as typeof part;
		}),
	};
}

/** Revalidate here too: repaired/provider calls must not revive legacy prose-only resume edits. */
export function resolveDocumentEdits(
	document: LoadedDocument,
	input: unknown,
	review: ReviewContext = NO_REVIEW_CONTEXT,
): ProposeEditsOutput {
	// Tailoring never edits a resume other jobs share: only the copy made for the posting's application.
	if (document.kind === "resume" && review.posting && document.applicationId !== review.posting.applicationId)
		throw new ORPCError("BAD_REQUEST", { message: NOT_JOB_COPY_MESSAGE });
	const schema = document.kind === "resume" ? proposeResumeEditsInputSchema : proposeEditsInputSchema;
	const parsed = schema.safeParse(input);
	if (!parsed.success)
		throw new ORPCError("BAD_REQUEST", {
			message: "This suggestion couldn't be prepared. Read the document again, or edit it in Write.",
		});
	return "changes" in parsed.data
		? resolveResumeEdits(document, parsed.data, review)
		: resolveEdits(document, parsed.data, review);
}

const ENTRY_IDENTITY_FIELDS: Record<string, string[]> = {
	experience: ["position", "location", "period"],
	education: ["degree", "area", "location", "period"],
	projects: ["period"],
	volunteer: ["location", "period"],
	awards: ["awarder", "date"],
	certifications: ["issuer", "date"],
	publications: ["publisher", "date"],
	profiles: ["username"],
	references: ["position", "phone"],
	languages: ["fluency"],
	skills: ["proficiency"],
};

function fieldLocation(
	data: ResumeData,
	{ target }: Extract<ProposeResumeEditsInput["changes"][number], { kind: "field" }>,
) {
	const labels = [target.sectionId === "basics" ? "Basics" : sectionLocation(data, target.sectionId)];
	if (target.itemId) {
		const custom = data.customSections.find((section) => section.id === target.sectionId);
		const section = custom ?? data.sections[target.sectionId as keyof ResumeData["sections"]];
		const type = custom?.type ?? target.sectionId;
		const index = section?.items.findIndex((entry) => entry.id === target.itemId) ?? -1;
		const entry = section?.items[index] as Record<string, unknown> | undefined;
		if (entry) {
			const identity = [
				entryTitle(type, entry),
				...(ENTRY_IDENTITY_FIELDS[type] ?? []).map((field) => entry[field]),
			].filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
			labels.push(...new Set(identity), `Entry ${index + 1}`);
			if (target.roleId && Array.isArray(entry.roles)) {
				const roleIndex = entry.roles.findIndex((role: { id: string }) => role.id === target.roleId);
				const role = entry.roles[roleIndex] as Record<string, unknown> | undefined;
				if (role)
					labels.push(
						...[entryTitle(type, role), role.period].filter(
							(value): value is string => typeof value === "string" && Boolean(value.trim()),
						),
						`Role ${roleIndex + 1}`,
					);
			}
		} else labels.push(target.itemId);
	}
	return [...labels, target.field].join(" · ");
}

/** One structural set is one card: its review is every change's, without repeats. */
function combinedReview(reviews: readonly Review[]): Review {
	const unique = <T>(items: T[], key: (item: T) => string) => [
		...new Map(items.map((item) => [key(item), item])).values(),
	];
	const requirements = unique(
		reviews.flatMap((review) => (review.requirement ? [review.requirement] : [])),
		(text) => text.trim().toLowerCase(),
	);
	const evidence = unique(
		reviews.flatMap((review) => review.evidence ?? []),
		(item) => JSON.stringify(item),
	);
	const unresolved = reviews.reduce((total, review) => total + (review.unresolved ?? 0), 0);
	const unsupported = unique(
		reviews.flatMap((review) => review.unsupported ?? []),
		(claim) => claim.text.toLowerCase(),
	);
	return {
		...(requirements.length > 0 ? { requirement: requirements.join("; ") } : {}),
		...(evidence.length > 0 ? { evidence } : {}),
		...(unresolved > 0 ? { unresolved } : {}),
		...(unsupported.length > 0 ? { unsupported } : {}),
		...(reviews.some((review) => review.addsClaims) ? { addsClaims: true } : {}),
	};
}

/** Structure and text in one snapshot: accepting cannot split a section from its entries or overwrite later edits. */
function resolveResumeEdits(
	document: LoadedDocument,
	input: ProposeResumeEditsInput,
	review: ReviewContext,
): ProposeEditsOutput {
	const original = document.resume;
	if (!original) throw new Error("Open a resume to propose these changes.");
	const { cite, reviewOf } = reviewer(document, review);
	let next = structuredClone(original);
	const before: string[] = [];
	const after: string[] = [];
	const reasons: string[] = [];
	const reviews: Review[] = [];
	const addressed: string[] = [];
	const skipped: ProposeEditsOutput["skipped"] = [];
	const textEdits: ProposeEditsOutput["edits"] = [];
	const textPassages = new Map<string, string>();
	const textOnly = input.changes.every((change) => change.kind === "text");
	for (const [index, change] of input.changes.entries()) {
		const id = change.kind === "text" ? change.passageId : `change_${index + 1}`;
		try {
			assertResumeChangeProse(change);
			if (change.kind === "text") {
				const passage = document.passages.find((passage) => passage.id === change.passageId);
				if (!passage || passage.target.sectionId !== change.sectionId)
					throw new Error(
						"This text belongs to a different section, or changed. Read the resume again and choose the matching section.",
					);
				const { kind: _kind, sectionId: _sectionId, ...edit } = change;
				const output = resolveEdits(document, { title: input.title, edits: [edit] }, review);
				const placed = output.edits[0];
				if (!placed) throw new Error(output.skipped[0]?.reason ?? "This text changed. Ask for a fresh suggestion.");
				textEdits.push(placed);
				textPassages.set(placed.id, change.passageId);
				continue;
			}
			const changed = applyResumeStructureChange(next, change);
			upgradeResumeDates(changed);
			syncResumeDates(changed);
			// What the change says, reviewed against what the entry it changes already says (new entries: nothing).
			let says: string;
			let entry = "";
			if (change.kind === "field") {
				const location = fieldLocation(original, change);
				before.push(`${location}\n${change.before}`);
				after.push(`${location}\n${change.value}`);
				says = change.value;
				entry = change.target.itemId ? document.entry({ ...change.target, field: "" }) : change.before;
			} else if (change.kind === "entry") {
				const section = Object.hasOwn(changed.sections, change.sectionId)
					? changed.sections[change.sectionId as keyof ResumeData["sections"]]
					: changed.customSections.find((item) => item.id === change.sectionId);
				const added = section?.items.at(-1);
				if (!added) throw new Error("This entry could not be prepared. Add it in Write instead.");
				after.push(`${sectionLocation(changed, change.sectionId)}\n${entryReview(added)}`);
				says = entryText(changed, { sectionId: change.sectionId, itemId: added.id, field: "" });
			} else {
				const section = changed.customSections.at(-1);
				if (!section) throw new Error("The new section could not be prepared. Add it in Write instead.");
				after.push(
					`${section.title} · ${section.type}\n${section.items.map((item) => entryReview(item)).join("\n\n")}`,
				);
				says = [
					section.title,
					...section.items.map((item) => entryText(changed, { sectionId: section.id, itemId: item.id, field: "" })),
				].join("\n");
			}
			next = changed;
			reasons.push(change.why);
			reviews.push(reviewOf(change, says, entry));
			if (change.requirement) addressed.push(change.requirement);
		} catch (error) {
			skipped.push({ passageId: id, reason: error instanceof Error ? error.message : "These changes need Write." });
		}
	}
	if (textOnly)
		return {
			title: input.title,
			edits: textEdits,
			skipped,
			...reviewedSet(
				document,
				review,
				input.requirements,
				textEdits.map((edit) => edit.requirement),
				cite,
			),
		};
	const placed = applyResumeProposals(
		next,
		textEdits.map((edit) => ({ ...edit, source: "assistant" })),
	);
	for (const edit of placed.applied) {
		before.push(`${edit.location}\n${blockText(edit.before)}`);
		after.push(`${edit.location}\n${blockText(edit.after)}`);
		reasons.push(edit.why);
		const { requirement, evidence, unresolved, unsupported } = edit;
		reviews.push({ requirement, evidence, unresolved, unsupported });
		if (edit.requirement) addressed.push(edit.requirement);
	}
	for (const edit of placed.stale)
		skipped.push({
			passageId: textPassages.get(edit.id) ?? edit.id,
			reason: "This text changed or overlaps another edit. Ask for a fresh suggestion.",
		});
	const saved = resumeStructureSnapshot(original);
	const proposed = resumeStructureSnapshot(next);
	const changed = saved !== proposed;
	return {
		title: input.title,
		edits: changed
			? [
					{
						id: generateId(),
						target: { sectionId: "resume", field: "data" },
						location: "Resume",
						before: before.join("\n\n") || "—",
						after: after.join("\n\n"),
						snapshot: { before: saved, after: proposed },
						why: reasons.join("\n"),
						status: "pending",
						...combinedReview(reviews),
					},
				]
			: [],
		skipped,
		...reviewedSet(document, review, input.requirements, changed ? addressed : [], cite),
	};
}
