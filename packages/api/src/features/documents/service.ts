import type { EditableFields } from "../../dto/application";
import type { DocumentFilters, DocumentSummary } from "../../dto/documents";
import { ORPCError } from "@orpc/client";
import { and, asc, count, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { applicationService, insertApplication } from "../applications/service";
import { coverLetterService } from "../cover-letters/service";
import { resumeService, writeResumeFields } from "../resume/service";
import { followNameWithSlug } from "../resume/slugs";
import { listDocumentPage, listDocuments } from "./listing";
import { isRetriedCreate, lockUser, recordCreateRequest } from "./ownership";

type DocumentType = DocumentSummary["type"];
type DocumentRef = { userId: string; type: DocumentType; id: string };
type DocumentSelection = Pick<DocumentRef, "type" | "id">;

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

	if (!application)
		throw new ORPCError("NOT_FOUND", { message: "This application no longer exists. Choose another application." });
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
	await db.transaction(async (tx) => {
		await lockUser(tx, ref.userId);
		// A private resume's app-made address follows a new name, like a rename in the editor.
		if (ref.type === "resume" && resume.name !== undefined)
			await followNameWithSlug(tx, { userId: ref.userId, resumeId: ref.id, name: resume.name });
		const rows =
			ref.type === "resume"
				? await tx.update(schema.resume).set(resume).where(owned(ref)).returning({ id: schema.resume.id })
				: await tx
						.update(schema.coverLetter)
						// Letters carry a revision for their editor's optimistic saves; any change moves it on.
						.set({ ...letter, revision: sql`${schema.coverLetter.revision} + 1` })
						.where(owned(ref))
						.returning({ id: schema.coverLetter.id });

		if (rows.length === 0) throw new ORPCError("NOT_FOUND");
	});
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

/**
 * Deletes for good: resumes through their own path (storage too), letters directly. With `trashedBefore` (Trash
 * expiry), only a document still in Trash since then goes, whether or not it's locked.
 */
async function deleteForGood(ref: DocumentRef, trashedBefore?: Date) {
	if (ref.type === "resume")
		return resumeService.delete({ id: ref.id, userId: ref.userId, ...(trashedBefore ? { trashedBefore } : {}) });
	await db.transaction(async (tx) => {
		await lockUser(tx, ref.userId);
		await tx
			.delete(schema.coverLetter)
			.where(and(owned(ref), trashedBefore ? lt(schema.coverLetter.trashedAt, trashedBefore) : undefined));
	});
}

/**
 * Deletes a batch of the account's trashed letters in one statement. Selected IDs narrow it; `trashedBefore` keeps a
 * letter restored by another request. Active letters and other accounts' letters are never touched.
 */
async function deleteLettersForGood(input: { userId: string; ids?: readonly string[]; trashedBefore?: Date }) {
	const rows = await db.transaction(async (tx) => {
		await lockUser(tx, input.userId);
		return tx
			.delete(schema.coverLetter)
			.where(
				and(
					eq(schema.coverLetter.userId, input.userId),
					isNotNull(schema.coverLetter.trashedAt),
					input.ids ? inArray(schema.coverLetter.id, [...input.ids]) : undefined,
					input.trashedBefore ? lt(schema.coverLetter.trashedAt, input.trashedBefore) : undefined,
				),
			)
			.returning({ id: schema.coverLetter.id });
	});
	return rows.length;
}

/** One account's documents trashed more than 30 days ago go for good; runs when the account lists its documents. */
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
		...resumes.map(({ id }) => deleteForGood({ userId, type: "resume", id }, cutoff)),
		...letters.map(({ id }) => deleteForGood({ userId, type: "letter", id }, cutoff)),
	]);
}

/**
 * Trash keeps documents for 30 days, as the app promises, even for accounts that never come back: each scheduler tick
 * deletes a batch of expired documents across all accounts.
 */
async function purgeExpiredTrash(limit = 50) {
	const cutoff = new Date(Date.now() - TRASH_RETENTION_MS);
	const [resumes, letters] = await Promise.all([
		db
			.select({ id: schema.resume.id, userId: schema.resume.userId })
			.from(schema.resume)
			.where(lt(schema.resume.trashedAt, cutoff))
			.orderBy(asc(schema.resume.trashedAt))
			.limit(limit),
		db
			.select({ id: schema.coverLetter.id, userId: schema.coverLetter.userId })
			.from(schema.coverLetter)
			.where(lt(schema.coverLetter.trashedAt, cutoff))
			.orderBy(asc(schema.coverLetter.trashedAt))
			.limit(limit),
	]);

	await Promise.allSettled([
		...resumes.map(({ id, userId }) => deleteForGood({ userId, type: "resume", id }, cutoff)),
		...letters.map(({ id, userId }) => deleteForGood({ userId, type: "letter", id }, cutoff)),
	]);
}

export const documentsService = {
	purgeExpired,
	purgeExpiredTrash,

	list: async (
		input: DocumentFilters & { userId: string; limit?: number | undefined; offset?: number | undefined },
	) => {
		// Legacy complete Trash reads retain their cleanup side effect. Bounded reads leave cleanup to the scheduler.
		if (input.trashed && input.limit === undefined && input.offset === undefined)
			await purgeExpired(input.userId).catch((error: unknown) =>
				console.error("[documents] Trash purge failed", error),
			);
		return listDocuments(input);
	},
	page: (input: DocumentFilters & { userId: string; limit: number; offset: number }) => listDocumentPage(input),

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
				.where(
					and(
						eq(schema.resume.userId, input.userId),
						gte(schema.resume.trashedAt, new Date(Date.now() - TRASH_RETENTION_MS)),
					),
				),
			db
				.select({ total: count() })
				.from(schema.coverLetter)
				.where(
					and(
						eq(schema.coverLetter.userId, input.userId),
						gte(schema.coverLetter.trashedAt, new Date(Date.now() - TRASH_RETENTION_MS)),
					),
				),
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

	setLocked: async (input: DocumentRef & { isLocked: boolean }) => {
		if (input.type === "resume")
			await resumeService.setLocked({ id: input.id, userId: input.userId, isLocked: input.isLocked });
		else await update(input, { isLocked: input.isLocked });
	},

	linkApplication: async (
		input: DocumentRef & { applicationId: string | null; expectedUpdatedAt?: Date | undefined },
	) => {
		await assertUnlocked(input);
		const application = input.applicationId ? await assertOwnedApplication(input.userId, input.applicationId) : null;
		if (input.type === "resume") {
			// Answers with the resume's new revision, so the open editor's next autosave builds on it. The account lock
			// comes first, then the resume, then the application: the order every document and application write takes.
			const resume = await writeResumeFields({
				id: input.id,
				userId: input.userId,
				set: { applicationId: input.applicationId },
				unlockedOnly: true,
				expectedUpdatedAt: input.expectedUpdatedAt,
				mutation: "update",
				before: (tx) => lockUser(tx, input.userId),
			});
			if (application && !application.sentResumeVersionId && (!application.resumeId || application.status === "saved"))
				await applicationService.update({ userId: input.userId, id: application.id, resumeId: input.id });
			return resume;
		}

		const letter = await coverLetterService.getById({ id: input.id, userId: input.userId });
		await coverLetterService.update({
			id: input.id,
			userId: input.userId,
			expectedRevision: letter.revision,
			applicationId: input.applicationId,
		});
		return null;
	},

	/** Undoable: Trash hides the document and stops its public link; Restore brings it back intact. */
	trash: async (input: DocumentRef) => {
		await assertUnlocked(input);
		await update(input, { trashedAt: new Date() });
	},

	restore: (input: DocumentRef) => update(input, { trashedAt: null }),

	/**
	 * Restores the selected loaded documents in one transaction. Only this account's documents that are still in Trash
	 * are touched; a document restored or deleted by another request is skipped instead of failing the batch.
	 */
	restoreMany: async (input: { userId: string; documents: DocumentSelection[] }) => {
		const resumeIds = [...new Set(input.documents.filter(({ type }) => type === "resume").map(({ id }) => id))];
		const letterIds = [...new Set(input.documents.filter(({ type }) => type === "letter").map(({ id }) => id))];
		const restored = await db.transaction(async (tx) => {
			await lockUser(tx, input.userId);
			const resumes =
				resumeIds.length === 0
					? []
					: await tx
							.update(schema.resume)
							.set({ trashedAt: null })
							.where(
								and(
									eq(schema.resume.userId, input.userId),
									inArray(schema.resume.id, resumeIds),
									isNotNull(schema.resume.trashedAt),
								),
							)
							.returning({ id: schema.resume.id });
			const letters =
				letterIds.length === 0
					? []
					: await tx
							.update(schema.coverLetter)
							.set({ trashedAt: null, revision: sql`${schema.coverLetter.revision} + 1` })
							.where(
								and(
									eq(schema.coverLetter.userId, input.userId),
									inArray(schema.coverLetter.id, letterIds),
									isNotNull(schema.coverLetter.trashedAt),
								),
							)
							.returning({ id: schema.coverLetter.id });
			return resumes.length + letters.length;
		});
		return { restored };
	},

	/**
	 * "Delete permanently" for the selected loaded documents. Only this account's documents still in Trash when the
	 * request runs are deleted, so a concurrent restore wins. Anything else counts as skipped rather than failing.
	 */
	purgeMany: async (input: { userId: string; documents: DocumentSelection[] }) => {
		const cutoff = new Date();
		const resumeIds = [...new Set(input.documents.filter(({ type }) => type === "resume").map(({ id }) => id))];
		const letterIds = [...new Set(input.documents.filter(({ type }) => type === "letter").map(({ id }) => id))];
		const [resumes, letters] = await Promise.all([
			resumeIds.length === 0
				? 0
				: resumeService.deleteTrashedMany({ userId: input.userId, ids: resumeIds, trashedBefore: cutoff }),
			letterIds.length === 0
				? 0
				: deleteLettersForGood({ userId: input.userId, ids: letterIds, trashedBefore: cutoff }),
		]);
		const deleted = resumes + letters;
		return { deleted, skipped: input.documents.length - deleted };
	},

	/**
	 * Empty Trash: deletes every one of this account's trashed documents server-side, not the IDs the client has
	 * loaded. Active documents and other accounts' Trash are untouched, and a concurrent restore wins.
	 */
	emptyTrash: async (input: { userId: string }) => {
		const cutoff = new Date();
		const [resumes, letters] = await Promise.all([
			resumeService.deleteTrashedMany({ userId: input.userId, trashedBefore: cutoff }),
			deleteLettersForGood({ userId: input.userId, trashedBefore: cutoff }),
		]);
		return { deleted: resumes + letters };
	},

	/** "Delete now…": only for documents already in Trash. */
	purge: async (input: DocumentRef) => {
		const state = await readState(input);
		if (!state.trashedAt) throw new ORPCError("BAD_REQUEST", { message: "Move the document to Trash first." });
		// A concurrent restore wins; Trash deletes don't need a lock because deleting is the point of being there.
		await deleteForGood(input, new Date());
	},

	/**
	 * Duplicates a resume for a job, selecting the working copy while preserving submitted versions. A new job given
	 * with it is saved in the copy's transaction, so there is never a job without its copy or a copy without its job.
	 * With `newId`, a retry (a lost response, a second press, a remounted screen) returns the copy already made.
	 */
	copyForJob: async (input: {
		userId: string;
		resumeId: string;
		applicationId?: string | undefined;
		application?: (EditableFields & { company: string; role: string }) | undefined;
		name?: string | undefined;
		newId?: string | undefined;
	}) => {
		if (input.applicationId && input.application)
			throw new ORPCError("BAD_REQUEST", { message: "Give an existing job or a new one, not both." });

		const application = input.applicationId ? await assertOwnedApplication(input.userId, input.applicationId) : null;
		const { userId, resumeId, applicationId, application: newJob, name, newId } = input;
		// What this copy is for: a retry must ask for the same, so a reused ID never returns or links another resume.
		const created = newId && {
			table: "resume" as const,
			id: newId,
			userId,
			request: { operation: "documents.copyForJob", resumeId, applicationId, application: newJob, name },
		};
		let retried = Boolean(created && (await isRetriedCreate(db, created)));
		let id = retried && created ? created.id : undefined;
		if (!id) {
			const source = await resumeService.getById({ id: resumeId, userId });
			try {
				id = await resumeService.create({
					...(created ? { id: created.id } : {}),
					userId,
					name: name ?? suggestCopyName(source.name, application?.company ?? newJob?.company),
					tags: source.tags,
					locale: source.data.metadata.page.locale as never,
					data: source.data,
					...(created || newJob
						? {
								inTransaction: async (tx, copyId) => {
									if (created) await recordCreateRequest(tx, created);
									if (!newJob) return;
									const jobId = await insertApplication(tx, { userId, fields: { ...newJob, resumeId: copyId } });
									await tx.update(schema.resume).set({ applicationId: jobId }).where(eq(schema.resume.id, copyId));
									if (created)
										await tx
											.update(schema.createRequest)
											.set({ applicationId: jobId })
											.where(eq(schema.createRequest.id, copyId));
								},
							}
						: {}),
				});
			} catch (error) {
				// Two presses at once: the first made the copy, the second returns it.
				if (!created || !(await isRetriedCreate(db, created))) throw error;
				id = created.id;
				retried = true;
			}
		}

		const [copy] = retried
			? await db
					.select({ applicationId: schema.resume.applicationId })
					.from(schema.resume)
					.where(eq(schema.resume.id, id))
			: [];
		// The job saved with this copy is part of what the request made: if it has since been deleted or unlinked, a retry
		// is refused rather than saving the job again.
		if (retried && newJob) {
			const [receipt] = await db
				.select({ applicationId: schema.createRequest.applicationId })
				.from(schema.createRequest)
				.where(and(eq(schema.createRequest.id, id), eq(schema.createRequest.userId, userId)));
			if (!receipt?.applicationId || receipt.applicationId !== copy?.applicationId)
				throw new ORPCError("CONFLICT", {
					message: "The job saved with this copy has since been deleted, unlinked or changed.",
				});
		}

		// A retry completes only links the first attempt didn't finish; a link the user has changed since stays.
		if (application) {
			const jobUnchanged = !application.resumeId || application.resumeId === resumeId;
			if (!retried || (!copy?.applicationId && (jobUnchanged || application.resumeId === id)))
				await update({ userId, type: "resume", id }, { applicationId: application.id });
			const linkable = !application.sentResumeVersionId && (!application.resumeId || application.status === "saved");
			if (linkable && application.resumeId !== id && (!retried || jobUnchanged))
				await applicationService.update({ userId, id: application.id, resumeId: id });
		}

		return id;
	},
};
