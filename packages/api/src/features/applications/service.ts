import type { ApplicationDocumentKind, EditableFields } from "../../dto/application";
import type { DbOrTx } from "@reactive-resume/db/client";
import type {
	AiMetadata,
	ApplicationClosedReason,
	ApplicationStatus,
	ApplicationTimelineEntry,
	InterviewDetails,
} from "@reactive-resume/schema/applications/data";
import { ORPCError } from "@orpc/client";
import { and, arrayContains, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { lintResumeForAts } from "@reactive-resume/resume/ats";
import { copyCoverLetterStyle } from "@reactive-resume/resume/cover-letter";
import { coverLetterSchema } from "@reactive-resume/schema/cover-letter/data";
import { generateId } from "@reactive-resume/utils/string";
import { requestRunCancellation } from "../agent/cancellation";
import { prepareRunAt } from "../career/scheduling";
import { coverLetterService } from "../cover-letters/service";
import { writeLetterVersion } from "../cover-letters/versions";
import { lockUser } from "../documents/ownership";
import { resumeService } from "../resume/service";
import { writeVersion } from "../resume/version-history";
import { getStorageService, uploadFile } from "../storage/service";

function timelineDate(value: Date | string): Date {
	return value instanceof Date ? value : new Date(value);
}

function atFromDateString(date: string, existing?: Date | string): Date {
	const [year, month, day] = date.split("-").map(Number);
	if (!year || !month || !day) throw new ORPCError("BAD_REQUEST", { message: "Enter the date as YYYY-MM-DD." });

	const existingDate = existing ? timelineDate(existing) : undefined;

	const parsed = new Date(
		Date.UTC(
			year,
			month - 1,
			day,
			existingDate?.getUTCHours() ?? 12,
			existingDate?.getUTCMinutes() ?? 0,
			existingDate?.getUTCSeconds() ?? 0,
			existingDate?.getUTCMilliseconds() ?? 0,
		),
	);
	if (timelineDay(parsed) !== date) throw new ORPCError("BAD_REQUEST", { message: "Enter the date as YYYY-MM-DD." });

	return parsed;
}

function stageEntry(stage: ApplicationStatus, date?: string): ApplicationTimelineEntry {
	return { id: generateId(), type: "stage", stage, at: date ? atFromDateString(date) : new Date() };
}

function noteEntry(text: string, date?: string): ApplicationTimelineEntry {
	return { id: generateId(), type: "note", text, at: date ? atFromDateString(date) : new Date() };
}

function interviewAt(value: string): Date {
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime()))
		throw new ORPCError("BAD_REQUEST", { message: "Enter a valid interview date and time." });
	return parsed;
}

function interviewEntry(at: string, details: InterviewDetails): ApplicationTimelineEntry {
	return { id: generateId(), type: "interview", at: interviewAt(at), ...details };
}

function timelineDay(value: Date | string) {
	return timelineDate(value).toISOString().slice(0, 10);
}

function sortTimeline(activity: ApplicationTimelineEntry[]): ApplicationTimelineEntry[] {
	return [...activity].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

function currentStageAnchor(activity: ApplicationTimelineEntry[], status: ApplicationStatus) {
	return sortTimeline(activity).find((entry) => entry.type === "stage" && entry.stage === status);
}

function assertCurrentStageAnchorLatest(activity: ApplicationTimelineEntry[], status: ApplicationStatus) {
	const anchor = currentStageAnchor(activity, status);
	if (!anchor)
		throw new ORPCError("BAD_REQUEST", {
			message: "This application's timeline is missing its current stage. Reload the application and try again.",
		});

	const anchorDay = timelineDay(anchor.at);
	const newerStage = activity.some((entry) => entry.type === "stage" && timelineDay(entry.at) > anchorDay);
	if (newerStage) {
		throw new ORPCError("BAD_REQUEST", {
			message: "Choose a current stage date on or after the other stage dates.",
		});
	}
}

function appliedAtFromTimeline(activity: ApplicationTimelineEntry[], fallback: Date): Date {
	const sorted = sortTimeline(activity);
	const applied = sorted.find((entry) => entry.type === "stage" && entry.stage === "applied");
	const fallbackEntry = sorted.at(-1);
	return applied ? timelineDate(applied.at) : fallbackEntry ? timelineDate(fallbackEntry.at) : fallback;
}

// All reads/writes filter on userId — the single ownership guard every route funnels through.
async function requireOwned(id: string, userId: string) {
	const [row] = await db
		.select()
		.from(schema.application)
		.where(and(eq(schema.application.id, id), eq(schema.application.userId, userId)));
	if (!row) throw new ORPCError("NOT_FOUND");
	return row;
}

async function assertOwnedResume(userId: string, resumeId: string | null | undefined) {
	if (!resumeId) return;
	await resumeService.getById({ id: resumeId, userId });
}

async function assertOwnedCoverLetter(userId: string, coverLetterId: string | null | undefined) {
	if (!coverLetterId) return;
	await coverLetterService.getById({ id: coverLetterId, userId });
}

// Stages at which an application has been sent.
const SENT_STAGES = new Set<ApplicationStatus>(["applied", "screening", "interview", "offer"]);

type ApplicationRow = typeof schema.application.$inferSelect;

/**
 * Once an application has been sent (Applied or later), its linked resume is saved as a "sent" version, named after
 * the company, with its Check score at the time, and so is its linked letter. The application keeps pointing at
 * them, so it can open exactly what went out while the documents move on.
 */
export async function recordSentResume(row: ApplicationRow, client: DbOrTx): Promise<ApplicationRow> {
	if (!SENT_STAGES.has(row.status)) return row;
	const changes: Partial<ApplicationRow> = {};

	if (row.resumeId && !row.sentResumeVersionId) {
		const [resume] = await client
			.select()
			.from(schema.resume)
			.where(
				and(eq(schema.resume.id, row.resumeId), eq(schema.resume.userId, row.userId), isNull(schema.resume.trashedAt)),
			)
			.for("update");
		if (!resume)
			throw new ORPCError("NOT_FOUND", { message: "The linked resume is unavailable. Restore it before submitting." });
		const version = await writeVersion(client, {
			resumeId: row.resumeId,
			userId: row.userId,
			data: resume.data,
			kind: "sent",
			name: row.company,
		});
		changes.sentResumeVersionId = version.id;
		changes.sentCheckScore = lintResumeForAts(resume.data).score;
	}

	// The letter sent with it is kept the same way.
	if (row.coverLetterId && !row.sentCoverLetterVersionId) {
		const [stored] = await client
			.select()
			.from(schema.coverLetter)
			.where(
				and(
					eq(schema.coverLetter.id, row.coverLetterId),
					eq(schema.coverLetter.userId, row.userId),
					isNull(schema.coverLetter.trashedAt),
				),
			)
			.for("update");
		if (!stored)
			throw new ORPCError("NOT_FOUND", { message: "The linked letter is unavailable. Restore it before submitting." });
		const letter = coverLetterSchema.parse(stored);
		if (letter.sourceResumeId && (letter.senderLinked || letter.designLinked)) {
			const [source] = await client
				.select()
				.from(schema.resume)
				.where(
					and(
						eq(schema.resume.id, letter.sourceResumeId),
						eq(schema.resume.userId, row.userId),
						isNull(schema.resume.trashedAt),
					),
				)
				.for("update");
			if (source) {
				const linked = copyCoverLetterStyle(source.data, letter.style.sectionId, letter.style.itemId);
				letter.style = {
					...letter.style,
					...(letter.senderLinked ? { basics: linked.basics, picture: linked.picture } : {}),
					...(letter.designLinked ? { metadata: linked.metadata } : {}),
				};
			}
		}
		const version = await writeLetterVersion(client, { letter, userId: row.userId, kind: "sent", name: row.company });
		changes.sentCoverLetterVersionId = version.id;
	}

	if (Object.keys(changes).length === 0) return row;
	const [updated] = await client
		.update(schema.application)
		.set(changes)
		.where(eq(schema.application.id, row.id))
		.returning();
	return updated ?? row;
}

/** Closing keeps (or takes) a reason; any other stage clears it. */
function stageFields(status: ApplicationStatus | undefined, closedReason: ApplicationClosedReason | null | undefined) {
	if (status === undefined) return closedReason !== undefined ? { closedReason } : {};
	if (status === "closed") return closedReason !== undefined ? { closedReason } : {};
	return { closedReason: null };
}

async function assertOwnedResumes(userId: string, resumeIds: (string | null | undefined)[]) {
	const uniqueResumeIds = [...new Set(resumeIds.filter((id): id is string => !!id))];
	await Promise.all(uniqueResumeIds.map((resumeId) => assertOwnedResume(userId, resumeId)));
}

function storageKeyFromApplicationUrl(userId: string, value: string | null | undefined) {
	if (!value) return null;

	let pathname: string;
	try {
		pathname = value.startsWith("/") ? value : new URL(value).pathname;
	} catch {
		return null;
	}

	// Only the single file uploadFile writes (pictures/<uuid>.pdf, older ones <timestamp>.pdf): an edited URL
	// must never point delete at a folder or another kind of file.
	const key = pathname.match(/^\/(?:api\/)?(uploads\/[^/]+\/pictures\/[\w-]+\.pdf)$/)?.[1];
	return key?.startsWith(`uploads/${userId}/`) ? key : null;
}

async function deleteApplicationAttachments(
	userId: string,
	applications: Pick<EditableFields, "resumeFileUrl" | "coverLetterUrl">[],
) {
	const candidateKeys = [
		...new Set(
			applications.flatMap((application) => [
				storageKeyFromApplicationUrl(userId, application.resumeFileUrl),
				storageKeyFromApplicationUrl(userId, application.coverLetterUrl),
			]),
		),
	].filter((key): key is string => !!key);

	if (candidateKeys.length === 0) return;

	const remainingApplications = await db
		.select({
			resumeFileUrl: schema.application.resumeFileUrl,
			coverLetterUrl: schema.application.coverLetterUrl,
		})
		.from(schema.application)
		.where(eq(schema.application.userId, userId));

	const referencedKeys = new Set(
		remainingApplications.flatMap((application) => [
			storageKeyFromApplicationUrl(userId, application.resumeFileUrl),
			storageKeyFromApplicationUrl(userId, application.coverLetterUrl),
		]),
	);
	const keys = candidateKeys.filter((key) => !referencedKeys.has(key));

	if (keys.length === 0) return;
	const storageService = getStorageService();
	await Promise.allSettled(keys.map((key) => storageService.delete(key)));
}

async function deleteApplicationCoaching(userId: string, applicationIds: string[]) {
	if (!applicationIds.length) return;
	const threads = await db
		.select({ id: schema.agentThread.id, runId: schema.agentThread.activeRunId })
		.from(schema.agentThread)
		.where(and(eq(schema.agentThread.userId, userId), inArray(schema.agentThread.applicationId, applicationIds)));
	for (const thread of threads) {
		if (thread.runId) await requestRunCancellation(thread.runId, "APPLICATION_DELETED");
		await getStorageService().delete(`uploads/${userId}/agent/${thread.id}`);
	}
}

/**
 * A rescheduled round moves its briefings with it (24h, 2h or the morning before the new time); a removed round pauses
 * them and says so in Today. Either way, work already queued for the old time is canceled.
 */
async function followInterviewSchedules(
	tx: DbOrTx,
	userId: string,
	applicationId: string,
	interviewId: string,
	at: Date | null,
) {
	const schedules = await tx
		.select()
		.from(schema.careerSchedule)
		.where(
			and(
				eq(schema.careerSchedule.userId, userId),
				eq(schema.careerSchedule.applicationId, applicationId),
				eq(schema.careerSchedule.interviewId, interviewId),
			),
		)
		.orderBy(schema.careerSchedule.id)
		.for("update");
	if (!schedules.length) return;
	await tx
		.update(schema.careerJob)
		.set({ status: "canceled", lease: null, leaseUntil: null })
		.where(
			and(
				eq(schema.careerJob.userId, userId),
				inArray(
					schema.careerJob.scheduleId,
					schedules.map((row) => row.id),
				),
				inArray(schema.careerJob.status, ["queued", "running"]),
			),
		);
	for (const schedule of schedules)
		await tx
			.update(schema.careerSchedule)
			.set(
				at
					? {
							nextRunAt: prepareRunAt(at, (schedule.lead ?? "24h") as "24h" | "2h" | "morning", schedule.timezone),
							lastQueuedAt: null,
						}
					: { enabled: false },
			)
			.where(eq(schema.careerSchedule.id, schedule.id));
	if (at || !schedules.some((schedule) => schedule.enabled)) return;
	await tx.insert(schema.careerNotification).values({
		userId,
		applicationId,
		key: `interview-removed:${generateId()}`,
		notice: { type: "briefing-paused" },
		url: `/dashboard/career?schedule=${encodeURIComponent(schedules[0]?.id ?? "")}`,
	});
}

function documentFields(kind: ApplicationDocumentKind) {
	return kind === "resume"
		? ({
				file: "resumeFile",
				url: "resumeFileUrl",
				name: "resumeFileName",
			} as const)
		: ({
				file: "coverLetterFile",
				url: "coverLetterUrl",
				name: "coverLetterName",
			} as const);
}

type UploadedDocumentFields = Pick<
	EditableFields,
	"resumeFileUrl" | "resumeFileName" | "coverLetterUrl" | "coverLetterName"
>;

type DocumentFiles = { resumeFile?: File | undefined; coverLetterFile?: File | undefined };

// One request owns the uploads and record write; browser dismissal cannot strand an upload.
async function withDocumentFiles<T>(
	userId: string,
	files: DocumentFiles,
	save: (fields: UploadedDocumentFields) => Promise<T>,
) {
	const uploadedFields: UploadedDocumentFields = {};
	try {
		// ponytail: at most two sequential uploads; use allSettled if measured latency warrants concurrency.
		for (const kind of ["resume", "cover-letter"] as const) {
			const fields = documentFields(kind);
			const file = files[fields.file];
			if (!file) continue;
			if (file.type !== "application/pdf") {
				throw new ORPCError("BAD_REQUEST", { message: "Attach a PDF file." });
			}
			const uploaded = await uploadFile({
				userId,
				data: new Uint8Array(await file.arrayBuffer()),
				contentType: file.type,
			});
			uploadedFields[fields.url] = uploaded.url;
			uploadedFields[fields.name] = file.name;
		}
		return await save(uploadedFields);
	} catch (error) {
		// The record may already have committed before later work failed. Never delete referenced files.
		await deleteApplicationAttachments(userId, [uploadedFields]).catch(() => {});
		throw error;
	}
}

const stripUserId = <T extends { userId: string; activity?: ApplicationTimelineEntry[] }>(row: T) => {
	const { userId: _userId, ...rest } = row;
	return rest.activity ? { ...rest, activity: sortTimeline(rest.activity) } : rest;
};

export const applicationService = {
	list: async (input: {
		userId: string;
		status?: ApplicationStatus;
		tags?: string[];
		limit?: number;
		offset?: number;
	}) => {
		const where = and(
			eq(schema.application.userId, input.userId),
			input.status ? eq(schema.application.status, input.status) : undefined,
			input.tags && input.tags.length > 0 ? arrayContains(schema.application.tags, input.tags) : undefined,
		);
		// Bulk imports share an update timestamp; the ID keeps their pages stable.
		const query = db
			.select()
			.from(schema.application)
			.where(where)
			.orderBy(sql`${schema.application.updatedAt} desc nulls last`, desc(schema.application.id));
		const paged = input.limit !== undefined || input.offset !== undefined;
		const [rows, totals] = await Promise.all([
			paged ? query.limit(input.limit ?? 20).offset(input.offset ?? 0) : query,
			paged ? db.select({ total: count() }).from(schema.application).where(where) : undefined,
		]);

		return { items: rows.map(stripUserId), total: totals?.[0]?.total ?? rows.length };
	},

	getById: async (input: { id: string; userId: string }) => {
		return stripUserId(await requireOwned(input.id, input.userId));
	},

	create: async (
		input: EditableFields &
			DocumentFiles & {
				userId: string;
				company: string;
				role: string;
				status?: ApplicationStatus | undefined;
				closedReason?: ApplicationClosedReason | null | undefined;
				stageEnteredAt?: string | undefined;
			},
	) => {
		const { userId, status, stageEnteredAt, closedReason, resumeFile, coverLetterFile, ...fields } = input;
		const id = generateId();
		const initialStatus = status ?? "saved";
		const activity = [stageEntry(initialStatus, stageEnteredAt)];

		await assertOwnedResume(userId, fields.resumeId);
		await assertOwnedCoverLetter(userId, fields.coverLetterId);

		return withDocumentFiles(userId, { resumeFile, coverLetterFile }, (uploadedFields) =>
			db.transaction(async (tx) => {
				await lockUser(tx, userId);
				const [row] = await tx
					.insert(schema.application)
					.values({
						id,
						userId,
						status: initialStatus,
						...(initialStatus === "closed" && closedReason ? { closedReason } : {}),
						activity,
						appliedAt: appliedAtFromTimeline(activity, new Date()),
						...fields,
						...uploadedFields,
					})
					.returning();

				if (row) await recordSentResume(row, tx);
				return id;
			}),
		);
	},

	importMany: async (input: {
		userId: string;
		items: (EditableFields & {
			company: string;
			role: string;
			status?: ApplicationStatus | undefined;
			stageEnteredAt?: string | undefined;
		})[];
	}) => {
		if (input.items.length === 0) return { imported: 0 };

		await assertOwnedResumes(
			input.userId,
			input.items.map((item) => item.resumeId),
		);
		const coverLetterIds = new Set(input.items.map((item) => item.coverLetterId).filter((id) => !!id));
		await Promise.all([...coverLetterIds].map((id) => assertOwnedCoverLetter(input.userId, id)));

		const values = input.items.map(({ status, stageEnteredAt, ...fields }) => {
			const initialStatus = status ?? ("saved" as ApplicationStatus);
			const activity = [stageEntry(initialStatus, stageEnteredAt)];
			return {
				id: generateId(),
				userId: input.userId,
				status: initialStatus,
				activity,
				appliedAt: appliedAtFromTimeline(activity, new Date()),
				...fields,
			};
		});

		// Rows imported as already sent keep what went out, as create does.
		return db.transaction(async (tx) => {
			await lockUser(tx, input.userId);
			const rows = await tx.insert(schema.application).values(values).returning();
			for (const row of rows) await recordSentResume(row, tx);
			return { imported: rows.length };
		});
	},

	update: async (
		input: EditableFields &
			DocumentFiles & {
				id: string;
				userId: string;
				status?: ApplicationStatus | undefined;
				stageEnteredAt?: string | undefined;
				closedReason?: ApplicationClosedReason | null | undefined;
			},
	) => {
		const existing = await requireOwned(input.id, input.userId);

		const { id, userId, status, stageEnteredAt, closedReason, resumeFile, coverLetterFile, ...fields } = input;
		if (
			(existing.sentResumeVersionId && fields.resumeId !== undefined && fields.resumeId !== existing.resumeId) ||
			(existing.sentCoverLetterVersionId &&
				fields.coverLetterId !== undefined &&
				fields.coverLetterId !== existing.coverLetterId)
		) {
			throw new ORPCError("BAD_REQUEST", {
				message:
					"Recorded submitted documents cannot be replaced. Prepare a copy to keep the submitted versions intact.",
			});
		}
		await assertOwnedResume(userId, fields.resumeId);
		await assertOwnedCoverLetter(userId, fields.coverLetterId);

		const statusEntry = status !== undefined ? stageEntry(status, stageEnteredAt) : undefined;
		// Append in SQL so concurrent notes/stage events are not overwritten by a stale array.
		const activityExpr =
			statusEntry !== undefined
				? sql`case when ${schema.application.status} <> ${status}
						then ${schema.application.activity} || ${JSON.stringify([statusEntry])}::jsonb
						else ${schema.application.activity} end`
				: undefined;
		const appliedAtExpr =
			statusEntry !== undefined && status === "applied"
				? sql`case when ${schema.application.status} <> ${status}
						then ${statusEntry.at}
						else ${schema.application.appliedAt} end`
				: undefined;

		return withDocumentFiles(userId, { resumeFile, coverLetterFile }, async (uploadedFields) => {
			const result = await db.transaction(async (tx) => {
				await lockUser(tx, userId);
				const [current] = await tx
					.select()
					.from(schema.application)
					.where(and(eq(schema.application.id, id), eq(schema.application.userId, userId)))
					.for("update");
				if (!current) throw new ORPCError("NOT_FOUND");
				if (
					(current.sentResumeVersionId && fields.resumeId !== undefined && fields.resumeId !== current.resumeId) ||
					(current.sentCoverLetterVersionId &&
						fields.coverLetterId !== undefined &&
						fields.coverLetterId !== current.coverLetterId)
				)
					throw new ORPCError("BAD_REQUEST", {
						message:
							"Recorded submitted documents cannot be replaced. Prepare a copy to keep the submitted versions intact.",
					});
				const [updated] = await tx
					.update(schema.application)
					.set({
						...fields,
						...uploadedFields,
						...(status !== undefined ? { status } : {}),
						...(appliedAtExpr ? { appliedAt: appliedAtExpr } : {}),
						...stageFields(status, closedReason),
						...(activityExpr ? { activity: activityExpr } : {}),
					})
					.where(and(eq(schema.application.id, id), eq(schema.application.userId, userId)))
					.returning();

				if (!updated) throw new ORPCError("NOT_FOUND");
				return stripUserId(await recordSentResume(updated, tx));
			});
			if (fields.resumeFileUrl !== undefined || fields.coverLetterUrl !== undefined || resumeFile || coverLetterFile) {
				await deleteApplicationAttachments(userId, [existing]).catch(() => {});
			}
			return result;
		});
	},

	attachDocument: (input: { id: string; userId: string; kind: ApplicationDocumentKind; file: File }) => {
		const fields = documentFields(input.kind);
		return applicationService.update({ id: input.id, userId: input.userId, [fields.file]: input.file });
	},

	removeDocument: (input: { id: string; userId: string; kind: ApplicationDocumentKind }) => {
		const fields = documentFields(input.kind);
		return applicationService.update({ id: input.id, userId: input.userId, [fields.url]: null, [fields.name]: null });
	},

	// Persist AI-owned enrichment (match score + freeform metadata). Separate from the editable
	// update path so these fields are only ever written by the AI procedures.
	setAiResult: async (input: {
		id: string;
		userId: string;
		matchScore?: number | null;
		aiMetadata?: AiMetadata | null;
	}) => {
		const [updated] = await db
			.update(schema.application)
			.set({
				...(input.matchScore !== undefined ? { matchScore: input.matchScore } : {}),
				...(input.aiMetadata !== undefined ? { aiMetadata: input.aiMetadata } : {}),
			})
			.where(and(eq(schema.application.id, input.id), eq(schema.application.userId, input.userId)))
			.returning();

		if (!updated) throw new ORPCError("NOT_FOUND");
		return stripUserId(updated);
	},

	addNote: async (input: { id: string; userId: string; text: string; date?: string | undefined }) => {
		// Append in a single statement (activity || [event]) so concurrent notes can't drop each
		// other via read-then-write; ownership is enforced by the WHERE clause.
		const event = noteEntry(input.text, input.date);
		const [updated] = await db
			.update(schema.application)
			.set({ activity: sql`${schema.application.activity} || ${JSON.stringify([event])}::jsonb` })
			.where(and(eq(schema.application.id, input.id), eq(schema.application.userId, input.userId)))
			.returning();

		if (!updated) throw new ORPCError("NOT_FOUND");
		return stripUserId(updated);
	},

	addInterview: async (input: InterviewDetails & { id: string; userId: string; at: string }) => {
		const { id, userId, at, ...details } = input;
		const event = interviewEntry(at, details);
		// Same atomic append as addNote so a concurrent note/stage move can't be dropped.
		const [updated] = await db
			.update(schema.application)
			.set({ activity: sql`${schema.application.activity} || ${JSON.stringify([event])}::jsonb` })
			.where(and(eq(schema.application.id, id), eq(schema.application.userId, userId)))
			.returning();

		if (!updated) throw new ORPCError("NOT_FOUND");
		return stripUserId(updated);
	},

	updateInterview: (
		input: Partial<{ [K in keyof InterviewDetails]: InterviewDetails[K] | undefined }> & {
			id: string;
			userId: string;
			entryId: string;
			at?: string | undefined;
		},
	) => {
		const { id, userId, entryId, at, ...details } = input;
		const patch = Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined));

		return db.transaction(async (tx) => {
			const [existing] = await tx
				.select()
				.from(schema.application)
				.where(and(eq(schema.application.id, id), eq(schema.application.userId, userId)))
				.for("update");
			if (!existing) throw new ORPCError("NOT_FOUND");

			const target = existing.activity.find((entry) => entry.id === entryId);
			if (!target) throw new ORPCError("NOT_FOUND");
			if (target.type !== "interview") {
				throw new ORPCError("BAD_REQUEST", { message: "Timeline entry is not an interview." });
			}

			const activity = existing.activity.map((entry) =>
				entry.id === entryId ? { ...entry, ...patch, ...(at !== undefined ? { at: interviewAt(at) } : {}) } : entry,
			);

			const [updated] = await tx
				.update(schema.application)
				.set({ activity })
				.where(and(eq(schema.application.id, id), eq(schema.application.userId, userId)))
				.returning();

			if (!updated) throw new ORPCError("NOT_FOUND");
			// Only a new time moves briefings; re-saving the same time would cancel a briefing that's running.
			const moved = at !== undefined && interviewAt(at).getTime() !== new Date(target.at).getTime();
			if (moved) await followInterviewSchedules(tx, userId, id, entryId, interviewAt(at));
			return stripUserId(updated);
		});
	},

	updateTimelineEntry: (input: {
		id: string;
		userId: string;
		entryId: string;
		date?: string | undefined;
		text?: string | undefined;
	}) => {
		return db.transaction(async (tx) => {
			const [existing] = await tx
				.select()
				.from(schema.application)
				.where(and(eq(schema.application.id, input.id), eq(schema.application.userId, input.userId)))
				.for("update");
			if (!existing) throw new ORPCError("NOT_FOUND");

			const activity = existing.activity.map((entry) => {
				if (entry.id !== input.entryId) return entry;

				// Interviews hold an exact time; a day-granular date edit here could move them to the wrong local day.
				if (entry.type === "interview") {
					throw new ORPCError("BAD_REQUEST", {
						message: "Interview entries must be edited with updateInterview (update_application_interview).",
					});
				}

				if (entry.type !== "note" && input.text !== undefined) {
					throw new ORPCError("BAD_REQUEST", { message: "Only note timeline entries have editable text." });
				}

				return {
					...entry,
					...(input.date !== undefined ? { at: atFromDateString(input.date, entry.at) } : {}),
					...(entry.type === "note" && input.text !== undefined ? { text: input.text } : {}),
				};
			});

			if (!activity.some((entry) => entry.id === input.entryId)) throw new ORPCError("NOT_FOUND");
			assertCurrentStageAnchorLatest(activity, existing.status);

			const [updated] = await tx
				.update(schema.application)
				.set({
					activity,
					appliedAt: appliedAtFromTimeline(activity, existing.appliedAt),
				})
				.where(and(eq(schema.application.id, input.id), eq(schema.application.userId, input.userId)))
				.returning();

			if (!updated) throw new ORPCError("NOT_FOUND");
			return stripUserId(updated);
		});
	},

	deleteTimelineEntry: (input: { id: string; userId: string; entryId: string }) => {
		return db.transaction(async (tx) => {
			const [existing] = await tx
				.select()
				.from(schema.application)
				.where(and(eq(schema.application.id, input.id), eq(schema.application.userId, input.userId)))
				.for("update");
			if (!existing) throw new ORPCError("NOT_FOUND");

			const entry = existing.activity.find((item) => item.id === input.entryId);
			if (!entry) throw new ORPCError("NOT_FOUND");

			const anchor = currentStageAnchor(existing.activity, existing.status);
			if (entry.type === "stage" && anchor?.id === entry.id) {
				throw new ORPCError("BAD_REQUEST", { message: "The current stage can't be deleted. Change the stage first." });
			}

			const activity = existing.activity.filter((item) => item.id !== input.entryId);
			assertCurrentStageAnchorLatest(activity, existing.status);

			const [updated] = await tx
				.update(schema.application)
				.set({
					activity,
					appliedAt: appliedAtFromTimeline(activity, existing.appliedAt),
				})
				.where(and(eq(schema.application.id, input.id), eq(schema.application.userId, input.userId)))
				.returning();

			if (!updated) throw new ORPCError("NOT_FOUND");
			if (entry.type === "interview") await followInterviewSchedules(tx, input.userId, input.id, entry.id, null);
			return stripUserId(updated);
		});
	},

	delete: async (input: { id: string; userId: string }) => {
		const existing = await requireOwned(input.id, input.userId);
		await deleteApplicationCoaching(input.userId, [input.id]);
		const result = await db.transaction(async (tx) => {
			await lockUser(tx, input.userId);
			return tx
				.delete(schema.application)
				.where(and(eq(schema.application.id, input.id), eq(schema.application.userId, input.userId)))
				.returning({ id: schema.application.id });
		});
		if (result.length === 0) throw new ORPCError("NOT_FOUND");
		await deleteApplicationAttachments(input.userId, [existing]);
	},

	bulkUpdate: (input: {
		userId: string;
		ids: string[];
		status?: ApplicationStatus | undefined;
		closedReason?: ApplicationClosedReason | null | undefined;
		addTags?: string[] | undefined;
	}) => {
		const scope = and(inArray(schema.application.id, input.ids), eq(schema.application.userId, input.userId));

		// Tags: union the new tags into the existing array (de-duplicated) in a single statement.
		// Build an explicit `array[$1, $2]` — drizzle renders a bare JS array as a tuple `($1,$2)`,
		// which can't be cast to text[].
		const tagsExpr =
			input.addTags && input.addTags.length > 0
				? sql`(select array(select distinct unnest(${schema.application.tags} || array[${sql.join(
						input.addTags.map((tag) => sql`${tag}`),
						sql`, `,
					)}]::text[])))`
				: undefined;

		// Stage moves must log a timeline event on every row that actually changed — mirror the
		// single-item update path. Append the event only where the current status differs.
		const statusEntry = input.status !== undefined ? stageEntry(input.status) : undefined;
		const activityExpr =
			statusEntry !== undefined
				? sql`case when ${schema.application.status} <> ${input.status}
					then ${schema.application.activity} || ${JSON.stringify([statusEntry])}::jsonb
					else ${schema.application.activity} end`
				: undefined;
		const appliedAtExpr =
			statusEntry !== undefined && input.status === "applied"
				? sql`case when ${schema.application.status} <> ${input.status}
					then ${statusEntry.at}
					else ${schema.application.appliedAt} end`
				: undefined;

		return db.transaction(async (tx) => {
			await lockUser(tx, input.userId);
			const rows = await tx
				.update(schema.application)
				.set({
					...(input.status !== undefined ? { status: input.status } : {}),
					...(appliedAtExpr ? { appliedAt: appliedAtExpr } : {}),
					...(activityExpr ? { activity: activityExpr } : {}),
					...stageFields(input.status, input.closedReason),
					...(tagsExpr ? { tags: tagsExpr } : {}),
				})
				.where(scope)
				.returning();

			for (const row of rows) await recordSentResume(row, tx);
			return { updated: rows.length };
		});
	},

	bulkDelete: async (input: { userId: string; ids: string[] }) => {
		const existing = await db
			.select()
			.from(schema.application)
			.where(and(inArray(schema.application.id, input.ids), eq(schema.application.userId, input.userId)));
		await deleteApplicationCoaching(
			input.userId,
			existing.map((item) => item.id),
		);
		const rows = await db.transaction(async (tx) => {
			await lockUser(tx, input.userId);
			return tx
				.delete(schema.application)
				.where(and(inArray(schema.application.id, input.ids), eq(schema.application.userId, input.userId)))
				.returning({ id: schema.application.id });
		});
		await deleteApplicationAttachments(
			input.userId,
			existing.filter((application) => rows.some((row) => row.id === application.id)),
		);
		return { deleted: rows.length };
	},

	// Raw counts for Insights; funnel/sankey/tiles are derived client-side from these.
	stats: async (input: { userId: string }) => {
		const scope = eq(schema.application.userId, input.userId);

		const byStage = await db
			.select({ status: schema.application.status, count: sql<number>`count(*)::int` })
			.from(schema.application)
			.where(scope)
			.groupBy(schema.application.status);

		const bySource = await db
			.select({ source: schema.application.source, count: sql<number>`count(*)::int` })
			.from(schema.application)
			.where(scope)
			.groupBy(schema.application.source);

		const total = byStage.reduce((sum, row) => sum + row.count, 0);

		return {
			total,
			byStage,
			bySource: bySource
				.filter((row): row is { source: string; count: number } => !!row.source)
				.sort((a, b) => b.count - a.count),
		};
	},

	listTags: async (input: { userId: string }) => {
		const rows = await db
			.select({ tag: sql<string>`distinct unnest(${schema.application.tags})` })
			.from(schema.application)
			.where(eq(schema.application.userId, input.userId));

		return rows.map((row) => row.tag).sort((a, b) => a.localeCompare(b));
	},
};
