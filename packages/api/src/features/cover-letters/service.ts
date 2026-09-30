import type { CoverLetterListInput, CoverLetterUpdateInput } from "../../dto/cover-letter";
import type {
	CoverLetter,
	CoverLetterDocument,
	CoverLetterLayout,
	CoverLetterStyle,
} from "@reactive-resume/schema/cover-letter/data";
import type { Template } from "@reactive-resume/schema/templates";
import { ORPCError } from "@orpc/client";
import { and, count, desc, eq, ilike, isNull, sql } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { copyCoverLetterStyle } from "@reactive-resume/resume/cover-letter";
import {
	coverLetterContentSchema,
	coverLetterDocumentSchema,
	coverLetterSchema,
} from "@reactive-resume/schema/cover-letter/data";
import { resumeDataSchema } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { resumeService } from "../resume/service";
import { sanitizeCoverLetterHtml } from "./html";
import { getLetterVersion, saveLetterSessionVersion, writeLetterVersion } from "./versions";

type OwnedId = { userId: string; id: string };
type RevisionInput = OwnedId & { expectedRevision: number };
type CreateInput = {
	userId: string;
	name: string;
	recipient?: string | undefined;
	content?: string | undefined;
	resumeId?: string | undefined;
	applicationId?: string | undefined;
	template?: Template | undefined;
	layout?: CoverLetterLayout | undefined;
	recipientName?: string | undefined;
	recipientCompany?: string | undefined;
	letterDate?: string | null | undefined;
};

/** A stored row as a letter. Links end with the resume they point at, so a letter without one isn't linked. */
function toLetter(row: typeof schema.coverLetter.$inferSelect): CoverLetter {
	const letter = coverLetterSchema.parse(row);
	return letter.sourceResumeId ? letter : { ...letter, senderLinked: false, designLinked: false };
}

/** The stored letter, with the copies in `style` as they are. */
async function getRow(input: OwnedId): Promise<CoverLetter> {
	const [row] = await db
		.select()
		.from(schema.coverLetter)
		.where(and(eq(schema.coverLetter.id, input.id), eq(schema.coverLetter.userId, input.userId)));
	if (!row) throw new ORPCError("NOT_FOUND");
	return toLetter(row);
}

/**
 * A letter as it reads now: linked sender details and design come from its source resume as the resume is today.
 * If the resume is gone, the copies the letter keeps stand in.
 */
async function resolveLinks(letter: CoverLetter, userId: string): Promise<CoverLetter> {
	if (!(letter.senderLinked || letter.designLinked) || !letter.sourceResumeId) return letter;

	let linked: CoverLetterStyle;
	try {
		linked = await getResumeStyle(userId, letter.sourceResumeId, letter.style.sectionId, letter.style.itemId);
	} catch {
		return letter;
	}

	return {
		...letter,
		style: {
			...letter.style,
			...(letter.senderLinked ? { basics: linked.basics, picture: linked.picture } : {}),
			...(letter.designLinked ? { metadata: linked.metadata } : {}),
		},
	};
}

async function getById(input: OwnedId): Promise<CoverLetter> {
	return resolveLinks(await getRow(input), input.userId);
}

/** Today as YYYY-MM-DD, the date a new letter starts with. */
const today = () => new Date().toISOString().slice(0, 10);

async function getResumeStyle(userId: string, resumeId?: string, sectionId?: string, itemId?: string) {
	const data = resumeId
		? resumeDataSchema.parse((await resumeService.getById({ userId, id: resumeId })).data)
		: defaultResumeData;
	return copyCoverLetterStyle(data, sectionId, itemId);
}

async function getOwnedApplication(userId: string, id?: string) {
	if (!id) return null;
	const [application] = await db
		.select({ id: schema.application.id, company: schema.application.company, contacts: schema.application.contacts })
		.from(schema.application)
		.where(and(eq(schema.application.id, id), eq(schema.application.userId, userId)));
	if (!application) throw new ORPCError("NOT_FOUND");
	return application;
}

async function assertOwnedApplication(userId: string, id?: string) {
	await getOwnedApplication(userId, id);
}

/**
 * A letter for an application is the letter that application sends: a new one becomes its letter if it has none, and
 * moving a letter to another application takes it along.
 */
export async function linkLetterApplication(input: {
	userId: string;
	letterId: string;
	from?: string | null | undefined;
	to?: string | null | undefined;
	replace: boolean;
}) {
	const table = schema.application;
	if (input.from && input.from !== input.to) {
		await db
			.update(table)
			.set({ coverLetterId: null })
			.where(and(eq(table.id, input.from), eq(table.userId, input.userId), eq(table.coverLetterId, input.letterId)));
	}
	if (input.to && input.to !== input.from) {
		await db
			.update(table)
			.set({ coverLetterId: input.letterId })
			.where(
				and(
					eq(table.id, input.to),
					eq(table.userId, input.userId),
					...(input.replace ? [] : [isNull(table.coverLetterId)]),
				),
			);
	}
}

async function insert(input: {
	userId: string;
	name: string;
	recipient: string;
	content: string;
	style: CoverLetterStyle;
	layout?: CoverLetterLayout | undefined;
	recipientName?: string | undefined;
	recipientCompany?: string | undefined;
	letterDate?: string | null | undefined;
	sourceResumeId?: string | null;
	sourceApplicationId?: string | null;
	senderLinked?: boolean;
	designLinked?: boolean;
}): Promise<CoverLetter> {
	const content = coverLetterContentSchema.parse(input);
	const [row] = await db
		.insert(schema.coverLetter)
		.values({
			...content,
			userId: input.userId,
			recipient: sanitizeCoverLetterHtml(content.recipient),
			content: sanitizeCoverLetterHtml(content.content),
			sourceResumeId: input.sourceResumeId ?? null,
			sourceApplicationId: input.sourceApplicationId ?? null,
			senderLinked: input.senderLinked ?? false,
			designLinked: input.designLinked ?? false,
		})
		.returning();
	if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to save the letter." });
	const letter = toLetter(row);
	await writeLetterVersion(db, { letter, userId: input.userId, kind: "created" });
	return letter;
}

async function updateRevision(
	input: RevisionInput,
	changes: Partial<typeof schema.coverLetter.$inferInsert>,
): Promise<CoverLetter> {
	const [row] = await db
		.update(schema.coverLetter)
		.set({ ...changes, revision: sql`${schema.coverLetter.revision} + 1` })
		.where(
			and(
				eq(schema.coverLetter.id, input.id),
				eq(schema.coverLetter.userId, input.userId),
				eq(schema.coverLetter.revision, input.expectedRevision),
				eq(schema.coverLetter.isLocked, false),
			),
		)
		.returning();
	if (row) return toLetter(row);
	await assertUnlocked(input);
	throw new ORPCError("CONFLICT", { message: "This cover letter changed elsewhere. Reload it before saving again." });
}

/** Locked letters, like locked resumes, can't be edited or moved to Trash. */
async function assertUnlocked(input: OwnedId) {
	const [row] = await db
		.select({ isLocked: schema.coverLetter.isLocked })
		.from(schema.coverLetter)
		.where(and(eq(schema.coverLetter.id, input.id), eq(schema.coverLetter.userId, input.userId)));
	if (!row) throw new ORPCError("NOT_FOUND");
	if (row.isLocked) throw new ORPCError("DOCUMENT_LOCKED", { status: 400, message: "Unlock the letter first." });
}

export const coverLetterService = {
	getById,
	list: async (input: CoverLetterListInput & { userId: string }) => {
		const filters = [eq(schema.coverLetter.userId, input.userId), isNull(schema.coverLetter.trashedAt)];
		if (input.resumeId) filters.push(eq(schema.coverLetter.sourceResumeId, input.resumeId));
		if (input.applicationId) filters.push(eq(schema.coverLetter.sourceApplicationId, input.applicationId));
		if (input.search?.trim())
			filters.push(ilike(schema.coverLetter.name, `%${input.search.trim().replace(/[\\%_]/g, "\\$&")}%`));
		const where = and(...filters);
		const [rows, totals] = await Promise.all([
			db
				.select()
				.from(schema.coverLetter)
				.where(where)
				.orderBy(desc(schema.coverLetter.updatedAt), desc(schema.coverLetter.id))
				.limit(input.limit)
				.offset(input.offset),
			db.select({ total: count() }).from(schema.coverLetter).where(where),
		]);
		return { items: rows.map(toLetter), total: totals[0]?.total ?? 0 };
	},
	/**
	 * New letters are structured, with the recipient filled from the application (its company and first contact),
	 * and linked to their resume's sender details and design. A letter given a recipient block stays freeform.
	 */
	create: async (input: CreateInput) => {
		const application = await getOwnedApplication(input.userId, input.applicationId);
		const style = await getResumeStyle(input.userId, input.resumeId);
		if (input.template) style.metadata.template = input.template;
		const linked = Boolean(input.resumeId) && !input.template;
		const letter = await insert({
			userId: input.userId,
			name: input.name,
			recipient: input.recipient ?? "",
			content: input.content ?? "",
			style,
			layout: input.layout ?? (input.recipient?.trim() ? "freeform" : "structured"),
			recipientName: input.recipientName ?? application?.contacts[0]?.name ?? "",
			recipientCompany: input.recipientCompany ?? application?.company ?? "",
			letterDate: input.letterDate === undefined ? today() : input.letterDate,
			sourceResumeId: input.resumeId ?? null,
			sourceApplicationId: input.applicationId ?? null,
			senderLinked: Boolean(input.resumeId),
			designLinked: linked,
		});
		await linkLetterApplication({ userId: input.userId, letterId: letter.id, to: input.applicationId, replace: false });
		return resolveLinks(letter, input.userId);
	},
	update: async (input: CoverLetterUpdateInput & { userId: string }) => {
		const changes: Partial<typeof schema.coverLetter.$inferInsert> = {};
		const stored = await getRow(input);

		if (input.resumeId !== undefined) {
			if (input.resumeId) await resumeService.getById({ userId: input.userId, id: input.resumeId });
			changes.sourceResumeId = input.resumeId;
		}
		if (input.applicationId !== undefined) {
			await assertOwnedApplication(input.userId, input.applicationId ?? undefined);
			changes.sourceApplicationId = input.applicationId;
		}

		const sourceResumeId = changes.sourceResumeId !== undefined ? changes.sourceResumeId : stored.sourceResumeId;
		if ((input.senderLinked || input.designLinked) && !sourceResumeId) {
			throw new ORPCError("BAD_REQUEST", { message: "Choose a resume to link the letter to first." });
		}

		// Links follow the letter's resume and end when it's cleared; choosing a template or design ends the design link.
		const ownDesign = Boolean(input.template || input.metadata);
		const senderLinked = Boolean(sourceResumeId) && (input.senderLinked ?? stored.senderLinked);
		const designLinked = Boolean(sourceResumeId) && !ownDesign && (input.designLinked ?? stored.designLinked);

		// Unlinking keeps the details and design exactly as they read at that moment.
		if ((stored.senderLinked && !senderLinked) || (stored.designLinked && !designLinked)) {
			changes.style = (await resolveLinks(stored, input.userId)).style;
		}
		changes.senderLinked = senderLinked;
		changes.designLinked = designLinked;

		if (input.template) {
			const style = changes.style ?? stored.style;
			changes.style = { ...style, metadata: { ...style.metadata, template: input.template } };
		}
		if (input.metadata) {
			const style = changes.style ?? stored.style;
			const set = Object.fromEntries(Object.entries(input.metadata).filter(([, value]) => value !== undefined));
			changes.style = { ...style, metadata: { ...style.metadata, ...(set as Partial<typeof style.metadata>) } };
		}
		if (input.name !== undefined) changes.name = coverLetterContentSchema.shape.name.parse(input.name);
		if (input.recipient !== undefined)
			changes.recipient = sanitizeCoverLetterHtml(coverLetterContentSchema.shape.recipient.parse(input.recipient));
		if (input.content !== undefined)
			changes.content = sanitizeCoverLetterHtml(coverLetterContentSchema.shape.content.parse(input.content));
		if (input.recipientName !== undefined) changes.recipientName = input.recipientName.trim();
		if (input.recipientCompany !== undefined) changes.recipientCompany = input.recipientCompany.trim();
		if (input.letterDate !== undefined) changes.letterDate = input.letterDate;

		const updated = await resolveLinks(await updateRevision(input, changes), input.userId);
		if (input.applicationId !== undefined) {
			await linkLetterApplication({
				userId: input.userId,
				letterId: input.id,
				from: stored.sourceApplicationId,
				to: input.applicationId,
				replace: true,
			});
		}
		await saveLetterSessionVersion({
			letter: updated,
			userId: input.userId,
			...(input.sessionId ? { sessionId: input.sessionId } : {}),
		});
		return updated;
	},
	refreshStyle: async (input: RevisionInput & { resumeId: string }) => {
		const letter = await getById(input);
		const style = await getResumeStyle(input.userId, input.resumeId, letter.style.sectionId, letter.style.itemId);
		style.metadata.template = letter.style.metadata.template;
		return resolveLinks(await updateRevision(input, { style, sourceResumeId: input.resumeId }), input.userId);
	},
	duplicate: async (input: OwnedId & { name?: string | undefined }) => {
		const letter = await getRow(input);
		const copy = await insert({
			...letter,
			userId: input.userId,
			name: input.name ?? `${letter.name} (copy)`.slice(0, 100),
		});
		return resolveLinks(copy, input.userId);
	},
	/** Moves the letter to Trash (30 days, then deleted); Trash offers Restore and Delete now. */
	delete: async (input: RevisionInput): Promise<void> => {
		const rows = await db
			.update(schema.coverLetter)
			.set({ trashedAt: new Date(), revision: sql`${schema.coverLetter.revision} + 1` })
			.where(
				and(
					eq(schema.coverLetter.id, input.id),
					eq(schema.coverLetter.userId, input.userId),
					eq(schema.coverLetter.revision, input.expectedRevision),
					eq(schema.coverLetter.isLocked, false),
				),
			)
			.returning({ id: schema.coverLetter.id });
		if (rows.length) return;
		await assertUnlocked(input);
		throw new ORPCError("CONFLICT", { message: "This cover letter changed elsewhere. Reload it before deleting." });
	},
	export: async (input: OwnedId): Promise<CoverLetterDocument> => {
		const letter = await getById(input);
		return coverLetterDocumentSchema.parse({ ...letter, format: "reactive-resume-cover-letter", version: 1 });
	},
	/** "Name this version": a named version of the letter as it is now. */
	createVersion: async (input: OwnedId & { name: string }) => {
		const letter = await getById(input);
		return writeLetterVersion(db, { letter, userId: input.userId, kind: "named", name: input.name });
	},
	/**
	 * Restores a version: the current state is kept as "Before restore" first, then the letter reads as it did. Its
	 * links stay as they are, so linked details and design keep coming from the resume.
	 */
	restoreVersion: async (input: OwnedId & { versionId: string }) => {
		const version = await getLetterVersion({
			coverLetterId: input.id,
			userId: input.userId,
			versionId: input.versionId,
		});
		const current = await getById(input);
		await writeLetterVersion(db, { letter: current, userId: input.userId, kind: "before-restore" });

		const { data } = version;
		const restored = await updateRevision(
			{ id: input.id, userId: input.userId, expectedRevision: current.revision },
			{
				name: data.name,
				recipient: data.recipient,
				content: data.content,
				style: data.style,
				layout: data.layout,
				recipientName: data.recipientName,
				recipientCompany: data.recipientCompany,
				letterDate: data.letterDate,
			},
		);
		const resolved = await resolveLinks(restored, input.userId);
		await writeLetterVersion(db, { letter: resolved, userId: input.userId, kind: "restored" });
		return resolved;
	},
	/** The version an application was sent with ("sent", named after the company). */
	recordSent: async (input: OwnedId & { company: string }) => {
		const letter = await getById(input);
		return writeLetterVersion(db, { letter, userId: input.userId, kind: "sent", name: input.company });
	},
	import: (input: { userId: string; document: CoverLetterDocument }) => {
		const document = coverLetterDocumentSchema.parse(input.document);
		return insert({ ...document, userId: input.userId });
	},
};
