import type {
	AiMetadata,
	ApplicationStatus,
	ApplicationTimelineEntry,
	Contact,
	InterviewDetails,
} from "@reactive-resume/schema/applications/data";
import type { ApplicationDocumentKind } from "../../dto/application";
import { ORPCError } from "@orpc/client";
import { and, arrayContains, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { generateId } from "@reactive-resume/utils/string";
import { resumeService } from "../resume/service";
import { getStorageService, uploadFile } from "../storage/service";

function timelineDate(value: Date | string): Date {
	return value instanceof Date ? value : new Date(value);
}

function atFromDateString(date: string, existing?: Date | string): Date {
	const [year, month, day] = date.split("-").map(Number);
	if (!year || !month || !day) throw new ORPCError("BAD_REQUEST", { message: "Date must use YYYY-MM-DD format." });

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
	if (timelineDay(parsed) !== date) throw new ORPCError("BAD_REQUEST", { message: "Date must use YYYY-MM-DD format." });

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
	if (Number.isNaN(parsed.getTime())) throw new ORPCError("BAD_REQUEST", { message: "Invalid interview date-time." });
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
		throw new ORPCError("BAD_REQUEST", { message: "Application timeline is missing its current stage entry." });

	const anchorDay = timelineDay(anchor.at);
	const newerStage = activity.some((entry) => entry.type === "stage" && timelineDay(entry.at) > anchorDay);
	if (newerStage) {
		throw new ORPCError("BAD_REQUEST", {
			message: "Current stage date cannot be older than another stage entry.",
		});
	}
}

function appliedAtFromTimeline(activity: ApplicationTimelineEntry[], fallback: Date): Date {
	const sorted = sortTimeline(activity);
	const applied = sorted.find((entry) => entry.type === "stage" && entry.stage === "applied");
	const fallbackEntry = sorted.at(-1);
	return applied ? timelineDate(applied.at) : fallbackEntry ? timelineDate(fallbackEntry.at) : fallback;
}

// Editable fields shared by create/update. Kept explicit so Drizzle's typed insert/update
// checks catch mistakes; `status`/`activity` are handled separately (auto-logging).
// `| undefined` is explicit throughout because the DTO layer (zod `.partial()`) produces
// `T | undefined` and the repo compiles with exactOptionalPropertyTypes.
type EditableFields = {
	company?: string | undefined;
	role?: string | undefined;
	location?: string | null | undefined;
	salary?: string | null | undefined;
	source?: string | null | undefined;
	sourceUrl?: string | null | undefined;
	jobDescription?: string | null | undefined;
	notes?: string | null | undefined;
	resumeFileUrl?: string | null | undefined;
	resumeFileName?: string | null | undefined;
	coverLetterUrl?: string | null | undefined;
	coverLetterName?: string | null | undefined;
	followUpAt?: Date | null | undefined;
	followUpNote?: string | null | undefined;
	contacts?: Contact[] | undefined;
	resumeId?: string | null | undefined;
	tags?: string[] | undefined;
};

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

	const match = pathname.match(/^\/(?:api\/)?uploads\/(.+)$/);
	if (!match?.[1]) return null;

	const key = `uploads/${match[1]}`;
	return key.startsWith(`uploads/${userId}/`) ? key : null;
}

async function deleteApplicationAttachments(
	userId: string,
	applications: { resumeFileUrl?: string | null; coverLetterUrl?: string | null }[],
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

function documentFields(kind: ApplicationDocumentKind) {
	return kind === "resume"
		? ({
				url: "resumeFileUrl",
				name: "resumeFileName",
			} as const)
		: ({
				url: "coverLetterUrl",
				name: "coverLetterName",
			} as const);
}

const stripUserId = <T extends { userId: string; activity?: ApplicationTimelineEntry[] }>(row: T) => {
	const { userId: _userId, ...rest } = row;
	return rest.activity ? { ...rest, activity: sortTimeline(rest.activity) } : rest;
};

export const applicationService = {
	list: async (input: { userId: string; status?: ApplicationStatus; tags?: string[]; includeArchived?: boolean }) => {
		const rows = await db
			.select()
			.from(schema.application)
			.where(
				and(
					eq(schema.application.userId, input.userId),
					input.status ? eq(schema.application.status, input.status) : undefined,
					input.tags && input.tags.length > 0 ? arrayContains(schema.application.tags, input.tags) : undefined,
				),
			)
			.orderBy(desc(schema.application.updatedAt));

		return rows.filter((row) => input.includeArchived || !row.archived).map(stripUserId);
	},

	getById: async (input: { id: string; userId: string }) => {
		return stripUserId(await requireOwned(input.id, input.userId));
	},

	create: async (
		input: EditableFields & {
			userId: string;
			company: string;
			role: string;
			status?: ApplicationStatus | undefined;
			stageEnteredAt?: string | undefined;
		},
	) => {
		const { userId, status, stageEnteredAt, ...fields } = input;
		const id = generateId();
		const initialStatus = status ?? "saved";
		const activity = [stageEntry(initialStatus, stageEnteredAt)];

		await assertOwnedResume(userId, fields.resumeId);

		await db.insert(schema.application).values({
			id,
			userId,
			status: initialStatus,
			activity,
			appliedAt: appliedAtFromTimeline(activity, new Date()),
			...fields,
		});

		return id;
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

		const rows = await db.insert(schema.application).values(values).returning({ id: schema.application.id });
		return { imported: rows.length };
	},

	update: async (
		input: EditableFields & {
			id: string;
			userId: string;
			status?: ApplicationStatus | undefined;
			archived?: boolean | undefined;
		},
	) => {
		await requireOwned(input.id, input.userId);

		const { id, userId, status, archived, ...fields } = input;
		await assertOwnedResume(userId, fields.resumeId);

		const statusEntry = status !== undefined ? stageEntry(status) : undefined;
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

		const [updated] = await db
			.update(schema.application)
			.set({
				...fields,
				...(status !== undefined ? { status } : {}),
				...(appliedAtExpr ? { appliedAt: appliedAtExpr } : {}),
				...(archived !== undefined ? { archived } : {}),
				...(activityExpr ? { activity: activityExpr } : {}),
			})
			.where(and(eq(schema.application.id, id), eq(schema.application.userId, userId)))
			.returning();

		if (!updated) throw new ORPCError("NOT_FOUND");
		return stripUserId(updated);
	},

	attachDocument: async (input: {
		id: string;
		userId: string;
		kind: ApplicationDocumentKind;
		fileName: string;
		data: Uint8Array;
		contentType: string;
	}) => {
		if (input.contentType !== "application/pdf") {
			throw new ORPCError("BAD_REQUEST", { message: "Application documents must be PDF files." });
		}

		const existing = await requireOwned(input.id, input.userId);
		const fields = documentFields(input.kind);
		const uploaded = await uploadFile({
			userId: input.userId,
			data: input.data,
			contentType: input.contentType,
		});

		try {
			const updated = await applicationService.update({
				id: input.id,
				userId: input.userId,
				[fields.url]: uploaded.url,
				[fields.name]: input.fileName,
			});

			await deleteApplicationAttachments(input.userId, [
				{
					resumeFileUrl: fields.url === "resumeFileUrl" ? existing.resumeFileUrl : null,
					coverLetterUrl: fields.url === "coverLetterUrl" ? existing.coverLetterUrl : null,
				},
			]);

			return updated;
		} catch (error) {
			await getStorageService()
				.delete(uploaded.key)
				.catch(() => false);
			throw error;
		}
	},

	removeDocument: async (input: { id: string; userId: string; kind: ApplicationDocumentKind }) => {
		const existing = await requireOwned(input.id, input.userId);
		const fields = documentFields(input.kind);
		const updated = await applicationService.update({
			id: input.id,
			userId: input.userId,
			[fields.url]: null,
			[fields.name]: null,
		});

		await deleteApplicationAttachments(input.userId, [
			{
				resumeFileUrl: fields.url === "resumeFileUrl" ? existing.resumeFileUrl : null,
				coverLetterUrl: fields.url === "coverLetterUrl" ? existing.coverLetterUrl : null,
			},
		]);

		return updated;
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
			await tx.execute(sql`
				select 1 from ${schema.application}
				where ${schema.application.id} = ${id} and ${schema.application.userId} = ${userId}
				for update
			`);

			const [existing] = await tx
				.select()
				.from(schema.application)
				.where(and(eq(schema.application.id, id), eq(schema.application.userId, userId)));
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
			await tx.execute(sql`
				select 1 from ${schema.application}
				where ${schema.application.id} = ${input.id} and ${schema.application.userId} = ${input.userId}
				for update
			`);

			const [existing] = await tx
				.select()
				.from(schema.application)
				.where(and(eq(schema.application.id, input.id), eq(schema.application.userId, input.userId)));
			if (!existing) throw new ORPCError("NOT_FOUND");

			const activity = existing.activity.map((entry) => {
				if (entry.id !== input.entryId) return entry;

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
			await tx.execute(sql`
				select 1 from ${schema.application}
				where ${schema.application.id} = ${input.id} and ${schema.application.userId} = ${input.userId}
				for update
			`);

			const [existing] = await tx
				.select()
				.from(schema.application)
				.where(and(eq(schema.application.id, input.id), eq(schema.application.userId, input.userId)));
			if (!existing) throw new ORPCError("NOT_FOUND");

			const entry = existing.activity.find((item) => item.id === input.entryId);
			if (!entry) throw new ORPCError("NOT_FOUND");

			const anchor = currentStageAnchor(existing.activity, existing.status);
			if (entry.type === "stage" && anchor?.id === entry.id) {
				throw new ORPCError("BAD_REQUEST", { message: "The current stage timeline entry cannot be deleted." });
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
			return stripUserId(updated);
		});
	},

	delete: async (input: { id: string; userId: string }) => {
		const existing = await requireOwned(input.id, input.userId);
		const result = await db
			.delete(schema.application)
			.where(and(eq(schema.application.id, input.id), eq(schema.application.userId, input.userId)))
			.returning({ id: schema.application.id });
		if (result.length === 0) throw new ORPCError("NOT_FOUND");
		await deleteApplicationAttachments(input.userId, [existing]);
	},

	bulkUpdate: async (input: {
		userId: string;
		ids: string[];
		status?: ApplicationStatus | undefined;
		archived?: boolean | undefined;
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

		const rows = await db
			.update(schema.application)
			.set({
				...(input.status !== undefined ? { status: input.status } : {}),
				...(appliedAtExpr ? { appliedAt: appliedAtExpr } : {}),
				...(activityExpr ? { activity: activityExpr } : {}),
				...(input.archived !== undefined ? { archived: input.archived } : {}),
				...(tagsExpr ? { tags: tagsExpr } : {}),
			})
			.where(scope)
			.returning({ id: schema.application.id });

		return { updated: rows.length };
	},

	bulkDelete: async (input: { userId: string; ids: string[] }) => {
		const existing = await db
			.select()
			.from(schema.application)
			.where(and(inArray(schema.application.id, input.ids), eq(schema.application.userId, input.userId)));
		const rows = await db
			.delete(schema.application)
			.where(and(inArray(schema.application.id, input.ids), eq(schema.application.userId, input.userId)))
			.returning({ id: schema.application.id });
		await deleteApplicationAttachments(
			input.userId,
			existing.filter((application) => rows.some((row) => row.id === application.id)),
		);
		return { deleted: rows.length };
	},

	// Raw counts for Insights; funnel/sankey/tiles are derived client-side from these.
	stats: async (input: { userId: string }) => {
		const scope = and(eq(schema.application.userId, input.userId), eq(schema.application.archived, false));

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
