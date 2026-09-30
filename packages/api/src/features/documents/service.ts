import type { DocumentSummary } from "../../dto/documents";
import { ORPCError } from "@orpc/client";
import { and, count, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { applicationService } from "../applications/service";
import { linkLetterApplication } from "../cover-letters/service";
import { resumeService } from "../resume/service";

type DocumentType = DocumentSummary["type"];
type DocumentRef = { userId: string; type: DocumentType; id: string };

// Trash keeps documents this long before deleting them for good.
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// Resumes keep their existing error code, which API and MCP clients already handle.
const locked = (type: DocumentType) =>
	type === "resume"
		? new ORPCError("RESUME_LOCKED", { status: 403 })
		: new ORPCError("DOCUMENT_LOCKED", { status: 400, message: "Unlock the letter first." });

/** "{source} — {company}" for a copy made for a job, "{source} (copy)" without one. */
function suggestCopyName(sourceName: string, company?: string) {
	const base = sourceName.split(" — ")[0]?.trim() || sourceName;
	return (company ? `${base} — ${company}` : `${base} (copy)`).slice(0, 100);
}

async function assertOwnedApplication(userId: string, applicationId: string) {
	const [application] = await db
		.select({
			id: schema.application.id,
			company: schema.application.company,
			resumeId: schema.application.resumeId,
			status: schema.application.status,
			sentResumeVersionId: schema.application.sentResumeVersionId,
		})
		.from(schema.application)
		.where(and(eq(schema.application.id, applicationId), eq(schema.application.userId, userId)));

	if (!application) throw new ORPCError("NOT_FOUND", { message: "Application not found." });
	return application;
}

/** A resume's or letter's row in its own table, scoped to its owner. */
const owned = ({ type, id, userId }: DocumentRef) =>
	type === "resume"
		? and(eq(schema.resume.id, id), eq(schema.resume.userId, userId))
		: and(eq(schema.coverLetter.id, id), eq(schema.coverLetter.userId, userId));

type ResumeChanges = Partial<typeof schema.resume.$inferInsert>;
type LetterChanges = Partial<typeof schema.coverLetter.$inferInsert>;

/** The same change to either table; `letter` differs only where the columns do (the linked application). */
async function update(ref: DocumentRef, resume: ResumeChanges, letter: LetterChanges = resume as LetterChanges) {
	const rows =
		ref.type === "resume"
			? await db.update(schema.resume).set(resume).where(owned(ref)).returning({ id: schema.resume.id })
			: await db
					.update(schema.coverLetter)
					// Letters carry a revision for their editor's optimistic saves; any change moves it on.
					.set({ ...letter, revision: sql`${schema.coverLetter.revision} + 1` })
					.where(owned(ref))
					.returning({ id: schema.coverLetter.id });

	if (rows.length === 0) throw new ORPCError("NOT_FOUND");
}

async function readState(ref: DocumentRef) {
	const [row] =
		ref.type === "resume"
			? await db
					.select({ isLocked: schema.resume.isLocked, trashedAt: schema.resume.trashedAt })
					.from(schema.resume)
					.where(owned(ref))
			: await db
					.select({ isLocked: schema.coverLetter.isLocked, trashedAt: schema.coverLetter.trashedAt })
					.from(schema.coverLetter)
					.where(owned(ref));

	if (!row) throw new ORPCError("NOT_FOUND");
	return row;
}

async function assertUnlocked(ref: DocumentRef) {
	const state = await readState(ref);
	if (state.isLocked) throw locked(ref.type);
	return state;
}

/** Deletes for good: resumes through their own path (storage too), letters directly. */
async function deleteForGood(ref: DocumentRef) {
	if (ref.type === "resume") return resumeService.delete({ id: ref.id, userId: ref.userId });
	await db.delete(schema.coverLetter).where(owned(ref));
}

/** Documents trashed more than 30 days ago go for good. It runs when the user lists documents, so no scheduler. */
async function purgeExpired(userId: string) {
	const cutoff = new Date(Date.now() - TRASH_RETENTION_MS);
	const [resumes, letters] = await Promise.all([
		db
			.select({ id: schema.resume.id })
			.from(schema.resume)
			.where(and(eq(schema.resume.userId, userId), lt(schema.resume.trashedAt, cutoff))),
		db
			.select({ id: schema.coverLetter.id })
			.from(schema.coverLetter)
			.where(and(eq(schema.coverLetter.userId, userId), lt(schema.coverLetter.trashedAt, cutoff))),
	]);

	await Promise.allSettled([
		...resumes.map(({ id }) => deleteForGood({ userId, type: "resume", id })),
		...letters.map(({ id }) => deleteForGood({ userId, type: "letter", id })),
	]);
}

export const documentsService = {
	/** Every live resume and letter (or everything in Trash), newest edit first. The app filters and sorts them. */
	list: async (input: { userId: string; trashed: boolean }): Promise<DocumentSummary[]> => {
		await purgeExpired(input.userId);

		const [resumes, letters] = await Promise.all([
			db
				.select({
					id: schema.resume.id,
					name: schema.resume.name,
					tags: schema.resume.tags,
					isLocked: schema.resume.isLocked,
					trashedAt: schema.resume.trashedAt,
					createdAt: schema.resume.createdAt,
					updatedAt: schema.resume.updatedAt,
					applicationId: schema.application.id,
					company: schema.application.company,
					role: schema.application.role,
				})
				.from(schema.resume)
				.leftJoin(schema.application, eq(schema.resume.applicationId, schema.application.id))
				.where(
					and(
						eq(schema.resume.userId, input.userId),
						input.trashed ? isNotNull(schema.resume.trashedAt) : isNull(schema.resume.trashedAt),
					),
				),
			db
				.select({
					id: schema.coverLetter.id,
					name: schema.coverLetter.name,
					tags: schema.coverLetter.tags,
					isLocked: schema.coverLetter.isLocked,
					trashedAt: schema.coverLetter.trashedAt,
					createdAt: schema.coverLetter.createdAt,
					updatedAt: schema.coverLetter.updatedAt,
					applicationId: schema.application.id,
					company: schema.application.company,
					role: schema.application.role,
				})
				.from(schema.coverLetter)
				.leftJoin(schema.application, eq(schema.coverLetter.sourceApplicationId, schema.application.id))
				.where(
					and(
						eq(schema.coverLetter.userId, input.userId),
						input.trashed ? isNotNull(schema.coverLetter.trashedAt) : isNull(schema.coverLetter.trashedAt),
					),
				),
		]);

		const toSummary =
			(type: DocumentType) =>
			({ applicationId, company, role, ...row }: (typeof resumes)[number]): DocumentSummary => ({
				type,
				...row,
				application: applicationId ? { id: applicationId, company: company ?? "", role: role ?? "" } : null,
			});

		return [...resumes.map(toSummary("resume")), ...letters.map(toSummary("letter"))].sort(
			(a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
		);
	},

	counts: async (input: { userId: string }) => {
		const [[resumes], [letters], [trashedResumes], [trashedLetters]] = await Promise.all([
			db
				.select({ total: count() })
				.from(schema.resume)
				.where(and(eq(schema.resume.userId, input.userId), isNull(schema.resume.trashedAt))),
			db
				.select({ total: count() })
				.from(schema.coverLetter)
				.where(and(eq(schema.coverLetter.userId, input.userId), isNull(schema.coverLetter.trashedAt))),
			db
				.select({ total: count() })
				.from(schema.resume)
				.where(and(eq(schema.resume.userId, input.userId), isNotNull(schema.resume.trashedAt))),
			db
				.select({ total: count() })
				.from(schema.coverLetter)
				.where(and(eq(schema.coverLetter.userId, input.userId), isNotNull(schema.coverLetter.trashedAt))),
		]);

		return {
			resume: resumes?.total ?? 0,
			letter: letters?.total ?? 0,
			trash: (trashedResumes?.total ?? 0) + (trashedLetters?.total ?? 0),
		};
	},

	/** A name typed by hand ends a blank resume's automatic naming. Locked documents keep their details. */
	rename: async (input: DocumentRef & { name: string }) => {
		await assertUnlocked(input);
		await update(input, { name: input.name, autoName: false }, { name: input.name });
	},

	setTags: async (input: DocumentRef & { tags: string[] }) => {
		await assertUnlocked(input);
		await update(input, { tags: [...new Set(input.tags)] });
	},

	setLocked: (input: DocumentRef & { isLocked: boolean }) =>
		input.type === "resume"
			? resumeService.setLocked({ id: input.id, userId: input.userId, isLocked: input.isLocked })
			: update(input, { isLocked: input.isLocked }),

	linkApplication: async (input: DocumentRef & { applicationId: string | null }) => {
		await assertUnlocked(input);
		const application = input.applicationId ? await assertOwnedApplication(input.userId, input.applicationId) : null;
		if (input.type === "resume") {
			await update(input, { applicationId: input.applicationId });
			if (application && !application.sentResumeVersionId && (!application.resumeId || application.status === "saved"))
				await applicationService.update({ userId: input.userId, id: application.id, resumeId: input.id });
			return;
		}

		const [letter] = await db
			.select({ applicationId: schema.coverLetter.sourceApplicationId })
			.from(schema.coverLetter)
			.where(owned(input));
		await update(input, {}, { sourceApplicationId: input.applicationId });
		await linkLetterApplication({
			userId: input.userId,
			letterId: input.id,
			from: letter?.applicationId,
			to: input.applicationId,
			replace: true,
		});
	},

	/** Undoable: Trash hides the document and stops its public link; Restore brings it back intact. */
	trash: async (input: DocumentRef) => {
		await assertUnlocked(input);
		await update(input, { trashedAt: new Date() });
	},

	restore: (input: DocumentRef) => update(input, { trashedAt: null }),

	/** "Delete now…": only for documents already in Trash. */
	purge: async (input: DocumentRef) => {
		const state = await readState(input);
		if (!state.trashedAt) throw new ORPCError("BAD_REQUEST", { message: "Move the document to Trash first." });
		await deleteForGood(input);
	},

	/** Duplicates a resume for a job, selecting the working copy while preserving submitted versions. */
	copyForJob: async (input: {
		userId: string;
		resumeId: string;
		applicationId?: string | undefined;
		name?: string | undefined;
	}) => {
		const source = await resumeService.getById({ id: input.resumeId, userId: input.userId });
		const application = input.applicationId ? await assertOwnedApplication(input.userId, input.applicationId) : null;

		const id = await resumeService.create({
			userId: input.userId,
			name: input.name ?? suggestCopyName(source.name, application?.company),
			tags: source.tags,
			locale: source.data.metadata.page.locale as never,
			data: source.data,
		});

		if (application) {
			await db.update(schema.resume).set({ applicationId: application.id }).where(eq(schema.resume.id, id));
			if (!application.sentResumeVersionId && (!application.resumeId || application.status === "saved"))
				await applicationService.update({ userId: input.userId, id: application.id, resumeId: id });
		}

		return id;
	},
};
