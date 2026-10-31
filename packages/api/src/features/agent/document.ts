import type {
	ProposeEditsInput,
	ProposeEditsOutput,
	ProposeResumeEditsInput,
} from "@reactive-resume/ai/tools/agent-tool-contracts";
import type { Passage, ProposalTarget } from "@reactive-resume/resume/proposals";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { and, desc, eq } from "drizzle-orm";
import { proposeEditsInputSchema, proposeResumeEditsInputSchema } from "@reactive-resume/ai/tools/agent-tool-contracts";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { createEntry } from "@reactive-resume/resume/entries";
import { buildMarkdown } from "@reactive-resume/resume/markdown";
import {
	additionAfter,
	applyResumeProposals,
	blockText,
	canApplyTo,
	collectLetterPassages,
	collectPassages,
	readTarget,
	replaceBlockText,
	resumeStructureSnapshot,
} from "@reactive-resume/resume/proposals";
import { applyResumeStructureChange } from "@reactive-resume/resume/structural-proposals";
import { sectionTypeSchema } from "@reactive-resume/schema/resume/data";
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
	applicationId: string | null;
	passages: Passage[];
	/** The field a proposal targets, as it reads now. */
	read: (target: ProposalTarget) => string | undefined;
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
			view: {
				resume: buildMarkdown(resume.data),
				structure: {
					basics: resume.data.basics,
					summary: resume.data.summary,
					sections: resume.data.sections,
					customSections: resume.data.customSections,
				},
				entryTemplates: Object.fromEntries(sectionTypeSchema.options.map((type) => [type, createEntry(type)])),
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
		name: letter.name,
		updatedAt: letter.updatedAt,
		locked: letter.isLocked,
		applicationId: letter.sourceApplicationId,
		passages,
		read: (target) => (target.field === "content" ? letter.content : undefined),
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
	return { role: application.role, company: application.company, text, notes: application.notes?.trim() ?? "" };
}

/**
 * Places the model's edits on the document as it is now. An edit whose passage id no longer exists (the words
 * changed since the document was read) is skipped, with a reason the model can act on.
 */
export function resolveEdits(document: LoadedDocument, input: ProposeEditsInput): ProposeEditsOutput {
	const byId = new Map(document.passages.map((passage) => [passage.id, passage]));
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
		});
	}

	return { title: input.title, edits, skipped };
}

/** Revalidate here too: repaired/provider calls must not revive legacy prose-only resume edits. */
export function resolveDocumentEdits(document: LoadedDocument, input: unknown): ProposeEditsOutput {
	const schema = document.kind === "resume" ? proposeResumeEditsInputSchema : proposeEditsInputSchema;
	const parsed = schema.safeParse(input);
	if (!parsed.success)
		throw new Error("This suggestion couldn't be prepared. Read the document again, or edit it in Write.");
	return "changes" in parsed.data ? resolveResumeEdits(document, parsed.data) : resolveEdits(document, parsed.data);
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

/** Structure and text in one snapshot: accepting cannot split a section from its entries or overwrite later edits. */
export function resolveResumeEdits(document: LoadedDocument, input: ProposeResumeEditsInput): ProposeEditsOutput {
	const original = document.resume;
	if (!original) throw new Error("Open a resume to propose these changes.");
	let next = structuredClone(original);
	const before: string[] = [];
	const after: string[] = [];
	const reasons: string[] = [];
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
				const output = resolveEdits(document, {
					title: input.title,
					edits: [
						{
							passageId: change.passageId,
							text: change.text,
							why: change.why,
							...(change.add === undefined ? {} : { add: change.add }),
						},
					],
				});
				const edit = output.edits[0];
				if (!edit) throw new Error(output.skipped[0]?.reason ?? "This text changed. Ask for a fresh suggestion.");
				textEdits.push(edit);
				textPassages.set(edit.id, change.passageId);
				continue;
			} else {
				const changed = applyResumeStructureChange(next, change);
				upgradeResumeDates(changed);
				syncResumeDates(changed);
				if (change.kind === "field") {
					const location = fieldLocation(original, change);
					before.push(`${location}\n${change.before}`);
					after.push(`${location}\n${change.value}`);
				} else if (change.kind === "entry") {
					const section = Object.hasOwn(changed.sections, change.sectionId)
						? changed.sections[change.sectionId as keyof ResumeData["sections"]]
						: changed.customSections.find((item) => item.id === change.sectionId);
					const entry = section?.items.at(-1);
					if (!entry) throw new Error("This entry could not be prepared. Add it in Write instead.");
					after.push(`${sectionLocation(changed, change.sectionId)}\n${entryReview(entry)}`);
				} else {
					const section = changed.customSections.at(-1);
					if (!section) throw new Error("The new section could not be prepared. Add it in Write instead.");
					after.push(
						`${section.title} · ${section.type}\n${section.items.map((entry) => entryReview(entry)).join("\n\n")}`,
					);
				}
				next = changed;
			}
			reasons.push(change.why);
		} catch (error) {
			skipped.push({ passageId: id, reason: error instanceof Error ? error.message : "These changes need Write." });
		}
	}
	if (textOnly) return { title: input.title, edits: textEdits, skipped };
	const placed = applyResumeProposals(next, textEdits.map((edit) => ({ ...edit, source: "assistant" })));
	for (const edit of placed.applied) {
		before.push(`${edit.location}\n${blockText(edit.before)}`);
		after.push(`${edit.location}\n${blockText(edit.after)}`);
		reasons.push(edit.why);
	}
	for (const edit of placed.stale) skipped.push({
		passageId: textPassages.get(edit.id) ?? edit.id,
		reason: "This text changed or overlaps another edit. Ask for a fresh suggestion.",
	});
	const saved = resumeStructureSnapshot(original);
	const proposed = resumeStructureSnapshot(next);
	return {
		title: input.title,
		edits:
			saved === proposed
				? []
				: [
						{
							id: generateId(),
							target: { sectionId: "resume", field: "data" },
							location: "Resume",
							before: before.join("\n\n") || "—",
							after: after.join("\n\n"),
							snapshot: { before: saved, after: proposed },
							why: reasons.join("\n"),
							status: "pending",
						},
					],
		skipped,
	};
}
