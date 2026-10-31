import type { ResumeUpdatedEvent } from "./events";
import type { DbOrTx } from "@reactive-resume/db/client";
import type { JsonPatchOperation } from "@reactive-resume/resume/patch";
import type { ProposalApplications } from "@reactive-resume/resume/proposals";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Locale } from "@reactive-resume/utils/locale";
import { ORPCError } from "@orpc/client";
import { compare, hash } from "bcryptjs";
import {
	and,
	arrayContains,
	asc,
	desc,
	eq,
	gte,
	inArray,
	isNotNull,
	isNull,
	lt,
	ne,
	notExists,
	sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { match } from "ts-pattern";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { detachEmbeddedLetters } from "@reactive-resume/resume/cover-letter";
import { applyResumePatches, ResumePatchError } from "@reactive-resume/resume/patch";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { isValidSlug } from "@reactive-resume/schema/resume/slug";
import { generateId } from "@reactive-resume/utils/string";
import { consumeResumePasswordLimit } from "../../middleware/rate-limit";
import {
	assertCurrentClientWrite,
	CurrentClientRequired,
	saveProposalApplications,
} from "../agent/proposal-applications";
import { adoptEmbeddedLetters } from "../cover-letters/embedded";
import { lockUser } from "../documents/ownership";
import { enqueueStorageCleanup, reportStorageCleanupSummary, runStorageCleanup } from "../storage/cleanup";
import { grantResumeAccess, hasResumeAccess } from "./access";
import {
	assertCanView,
	isOwner,
	redactResumeForViewer,
	requiresPassword,
	shouldCountForStatistics,
} from "./access-policy";
import { publishResumeUpdated } from "./events";
import { parseStoredResumeData, parseWritableResumeData } from "./resume-data-validation";
import { checkSlug, DEFAULT_SLUG_STEM, findFreeSlug, findResume, followNameWithSlug, recordSlugChange } from "./slugs";
import {
	deleteVersion,
	getVersion,
	listVersions,
	renameVersion,
	saveSessionVersion,
	writeVersion,
} from "./version-history";
import { countVisit } from "./view-dedup";

function resumeVersionConflict(updatedAt: Date) {
	return new ORPCError("RESUME_VERSION_CONFLICT", {
		status: 409,
		message: "The resume changed after this patch was generated. Read the resume again and regenerate the patch.",
		data: { updatedAt: updatedAt.toISOString() },
	});
}

/**
 * An older app tried to change a resume holding assistant edits it could apply wrongly (see assertCurrentClientWrite).
 * Nothing it sent is written. The resume's version moves on, so a draft it kept to resend later conflicts too, and the
 * app answers with its usual version-conflict path: keep the draft as a copy, reload this resume.
 */
async function refuseOlderClient(input: { id: string; userId: string }) {
	const [touched] = await db
		.update(schema.resume)
		.set({ updatedAt: new Date() })
		.where(activeResumeWhere(input.id, input.userId))
		.returning({ updatedAt: schema.resume.updatedAt });
	if (!touched) return new ORPCError("NOT_FOUND");
	await notifyResumeUpdated({
		type: "resume.updated",
		resumeId: input.id,
		userId: input.userId,
		updatedAt: touched.updatedAt.toISOString(),
		mutation: "update",
	});
	return new ORPCError("RESUME_VERSION_CONFLICT", {
		status: 409,
		message:
			"This resume has assistant edits this version of the app can't check. Refresh or update the app, then make the change again.",
		data: { updatedAt: touched.updatedAt.toISOString(), reason: "CURRENT_CLIENT_REQUIRED" },
	});
}

function assertResumeVersion(updatedAt: Date, expectedUpdatedAt?: Date) {
	if (expectedUpdatedAt && updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
		throw resumeVersionConflict(updatedAt);
	}
}

function invalidPatchOperation(message: string, index: number, operation: JsonPatchOperation) {
	return new ORPCError("INVALID_PATCH_OPERATIONS", { status: 400, message, data: { index, operation } });
}

/** The unique constraint a Postgres insert or update broke, if that's why it failed. */
const uniqueConstraint = (error: unknown) => (error as { cause?: { constraint?: string } } | null)?.cause?.constraint;

const otherPrimary = alias(schema.resume, "other_primary");

/**
 * Makes a resume the account's primary one when the account has none, in its own savepoint: when another resume
 * becomes primary at the same moment, that one keeps the role and this save still succeeds.
 */
async function claimPrimaryIfNone(tx: DbOrTx, input: { userId: string; resumeId: string }) {
	try {
		await tx.transaction((savepoint) =>
			savepoint
				.update(schema.resume)
				.set({ isPrimary: true })
				.where(
					and(
						eq(schema.resume.id, input.resumeId),
						eq(schema.resume.userId, input.userId),
						notExists(
							savepoint
								.select({ id: otherPrimary.id })
								.from(otherPrimary)
								.where(and(eq(otherPrimary.userId, input.userId), eq(otherPrimary.isPrimary, true))),
						),
					),
				),
		);
	} catch (error) {
		if (uniqueConstraint(error) !== "resume_primary_unique") throw error;
	}
}

function isValidJsonPointer(pointer: string): boolean {
	if (pointer === "") return true;
	if (!pointer.startsWith("/")) return false;

	const segments = pointer
		.slice(1)
		.split("/")
		.map((segment) => {
			if (/~(?:[^01]|$)/.test(segment)) return undefined;
			return segment.replace(/~[01]/g, (encoded) => (encoded === "~1" ? "/" : "~"));
		});
	return !segments.some((segment) => segment === undefined);
}

function assertValidPatchPointers(operation: JsonPatchOperation, index: number) {
	if (!isValidJsonPointer(operation.path)) {
		throw invalidPatchOperation("Operation `path` property is not a valid JSON Pointer string.", index, operation);
	}

	if ("from" in operation && !isValidJsonPointer(operation.from)) {
		throw invalidPatchOperation("Operation `from` property is not a valid JSON Pointer string.", index, operation);
	}
}

const activeResumeConditions = (id: string, userId: string) => [
	eq(schema.resume.id, id),
	eq(schema.resume.userId, userId),
	isNull(schema.resume.trashedAt),
];

/** Matches an active resume (not in Trash) owned by the user. */
const activeResumeWhere = (id: string, userId: string) => and(...activeResumeConditions(id, userId));

/** Matches an active, editable (unlocked and not in Trash) resume owned by the user. */
const activeUnlockedResumeWhere = (id: string, userId: string) =>
	and(...activeResumeConditions(id, userId), eq(schema.resume.isLocked, false));

/** The fields a resume read or write returns to its owner. */
/** The Share settings every read of a resume carries. */
const shareColumns = {
	showInSearchEngines: schema.resume.showInSearchEngines,
	hideContactDetails: schema.resume.hideContactDetails,
	isPrimary: schema.resume.isPrimary,
};

const resumeColumns = {
	...shareColumns,
	id: schema.resume.id,
	name: schema.resume.name,
	slug: schema.resume.slug,
	tags: schema.resume.tags,
	data: schema.resume.data,
	isPublic: schema.resume.isPublic,
	isLocked: schema.resume.isLocked,
	showDownloadButtons: schema.resume.showDownloadButtons,
	createdAt: schema.resume.createdAt,
	updatedAt: schema.resume.updatedAt,
	hasPassword: sql<boolean>`${schema.resume.password} IS NOT NULL`,
};

async function applyResumePatchTx(
	client: DbOrTx,
	input: {
		id: string;
		userId: string;
		operations: JsonPatchOperation[];
		expectedUpdatedAt?: Date;
		proposalApplications?: ProposalApplications;
		proposalSafety?: "v1";
	},
) {
	const [existing] = await client
		.select({
			name: schema.resume.name,
			data: schema.resume.data,
			isLocked: schema.resume.isLocked,
			updatedAt: schema.resume.updatedAt,
		})
		.from(schema.resume)
		.where(activeResumeWhere(input.id, input.userId))
		.for("update");

	if (!existing) throw new ORPCError("NOT_FOUND");
	if (existing.isLocked) throw new ORPCError("RESUME_LOCKED", { status: 403 });
	assertResumeVersion(existing.updatedAt, input.expectedUpdatedAt);
	await assertCurrentClientWrite(client, {
		userId: input.userId,
		document: { kind: "resume", id: input.id },
		proposalSafety: input.proposalSafety,
	});

	input.operations.forEach(assertValidPatchPointers);

	let patchedData: ResumeData;
	const storedData = parseStoredResumeData(existing.data);

	try {
		patchedData = applyResumePatches(storedData, input.operations);
	} catch (error) {
		if (error instanceof ResumePatchError) {
			throw new ORPCError("INVALID_PATCH_OPERATIONS", {
				status: 400,
				message: error.message,
				data: { code: error.code, index: error.index, operation: error.operation },
			});
		}

		throw new ORPCError("INVALID_PATCH_OPERATIONS", {
			status: 400,
			message: error instanceof Error ? error.message : "Failed to apply patch operations",
		});
	}

	patchedData = parseWritableResumeData(patchedData);
	await adoptEmbeddedLetters(client, {
		userId: input.userId,
		resumeId: input.id,
		resumeName: existing.name,
		data: patchedData,
	});
	// The version guard is the ms-precision JS check above, under the SELECT ... FOR UPDATE lock.
	// Never compare expectedUpdatedAt in SQL: rows stamped by Postgres now() (defaultNow() on
	// insert) carry microseconds, while JS Dates are ms-truncated — SQL equality then matches
	// zero rows and every guarded patch on a fresh resume reports a version conflict forever.
	const [resume] = await client
		.update(schema.resume)
		.set({ data: patchedData })
		.where(activeUnlockedResumeWhere(input.id, input.userId))
		.returning(resumeColumns);

	if (!resume) {
		if (input.expectedUpdatedAt) throw resumeVersionConflict(existing.updatedAt);
		throw new ORPCError("NOT_FOUND");
	}
	await saveProposalApplications(client, {
		userId: input.userId,
		document: { kind: "resume", id: input.id },
		applications: input.proposalApplications,
		conflict: () => resumeVersionConflict(existing.updatedAt),
	});

	// Checkpoint every patch (AI/API edit) atomically within the same transaction as the edit.
	// ponytail: a multi-patch agent turn writes one row per patch; 90-day retention bounds it.
	await writeVersion(client, {
		resumeId: resume.id,
		userId: input.userId,
		data: resume.data,
		kind: "ai",
	});

	return resume;
}

const tags = {
	list: async (input: { userId: string }) => {
		const result = await db
			.select({ tags: schema.resume.tags })
			.from(schema.resume)
			.where(and(eq(schema.resume.userId, input.userId), isNull(schema.resume.trashedAt)));

		return [...new Set(result.flatMap((tag) => tag.tags))].sort((a, b) => a.localeCompare(b));
	},
};

const statistics = {
	recordDownload: async (input: {
		username: string;
		slug: string;
		requestHeaders: Headers;
		trustedClient?: string;
		currentUserId?: string;
	}): Promise<boolean> => {
		const resume = await findResume(input, {
			id: schema.resume.id,
			userId: schema.resume.userId,
			isPublic: schema.resume.isPublic,
			passwordHash: schema.resume.password,
		});

		if (!resume) throw new ORPCError("NOT_FOUND");
		const viewer = input.currentUserId ? { id: input.currentUserId } : null;
		assertCanView(resume, viewer);
		if (requiresPassword(resume, viewer) && !hasResumeAccess(input.requestHeaders, resume.id, resume.passwordHash)) {
			throw new ORPCError("NEED_PASSWORD", {
				status: 401,
				data: { username: input.username, slug: input.slug },
			});
		}

		// Like views, a visitor's downloads count once an hour, so repeated calls can't inflate the number.
		if (shouldCountForStatistics(resume, viewer))
			await countVisit({ kind: "download", resumeId: resume.id, trustedClient: input.trustedClient });
		return true;
	},

	getById: async (input: { id: string; userId: string }) => {
		const [statistics] = await db
			.select({
				isPublic: schema.resume.isPublic,
				views: schema.resumeStatistics.views,
				downloads: schema.resumeStatistics.downloads,
				lastViewedAt: schema.resumeStatistics.lastViewedAt,
				lastDownloadedAt: schema.resumeStatistics.lastDownloadedAt,
			})
			.from(schema.resumeStatistics)
			.rightJoin(schema.resume, eq(schema.resumeStatistics.resumeId, schema.resume.id))
			.where(activeResumeWhere(input.id, input.userId));

		if (!statistics) throw new ORPCError("NOT_FOUND");

		return {
			isPublic: statistics.isPublic,
			views: statistics.views ?? 0,
			downloads: statistics.downloads ?? 0,
			lastViewedAt: statistics.lastViewedAt,
			lastDownloadedAt: statistics.lastDownloadedAt,
		};
	},

	increment: async (input: { id: string; views?: boolean; downloads?: boolean }) => {
		const views = input.views ? 1 : 0;
		const downloads = input.downloads ? 1 : 0;
		const lastViewedAt = input.views ? sql`now()` : undefined;
		const lastDownloadedAt = input.downloads ? sql`now()` : undefined;
		const today = new Date().toISOString().slice(0, 10);

		await db.transaction(async (tx) => {
			await tx
				.insert(schema.resumeStatistics)
				.values({
					resumeId: input.id,
					views,
					downloads,
					lastViewedAt,
					lastDownloadedAt,
				})
				.onConflictDoUpdate({
					target: [schema.resumeStatistics.resumeId],
					set: {
						views: sql`${schema.resumeStatistics.views} + ${views}`,
						downloads: sql`${schema.resumeStatistics.downloads} + ${downloads}`,
						lastViewedAt,
						lastDownloadedAt,
					},
				});

			await tx
				.insert(schema.resumeStatisticsDaily)
				.values({ resumeId: input.id, date: today, views, downloads })
				.onConflictDoUpdate({
					target: [schema.resumeStatisticsDaily.resumeId, schema.resumeStatisticsDaily.date],
					set: {
						views: sql`${schema.resumeStatisticsDaily.views} + ${views}`,
						downloads: sql`${schema.resumeStatisticsDaily.downloads} + ${downloads}`,
					},
				});
		});
	},

	// Returns the last `days` (default 30) of daily view/download counts, zero-filled so the series is continuous.
	getDailySeries: async (input: { id: string; userId: string; days?: number }) => {
		const days = input.days ?? 30;

		const [resume] = await db
			.select({ id: schema.resume.id })
			.from(schema.resume)
			.where(activeResumeWhere(input.id, input.userId));

		if (!resume) throw new ORPCError("NOT_FOUND");

		const now = new Date();
		const utcDay = (offset: number) =>
			new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset)).toISOString().slice(0, 10);
		const start = utcDay(days - 1);
		const dates = Array.from({ length: days }, (_, i) => utcDay(days - 1 - i));

		const rows = await db
			.select({
				date: schema.resumeStatisticsDaily.date,
				views: schema.resumeStatisticsDaily.views,
				downloads: schema.resumeStatisticsDaily.downloads,
			})
			.from(schema.resumeStatisticsDaily)
			.where(and(eq(schema.resumeStatisticsDaily.resumeId, input.id), gte(schema.resumeStatisticsDaily.date, start)));

		const byDate = new Map(rows.map((row) => [row.date, row]));

		return dates.map((date) => ({
			date,
			views: byDate.get(date)?.views ?? 0,
			downloads: byDate.get(date)?.downloads ?? 0,
		}));
	},
};

function toSharedResumeResponse(
	resume: {
		id: string;
		name: string;
		slug: string;
		tags: string[];
		data: ResumeData;
		isPublic: boolean;
		isLocked: boolean;
		showDownloadButtons: boolean;
		showInSearchEngines: boolean;
		hideContactDetails: boolean;
		isPrimary: boolean;
	},
	hasPassword: boolean,
) {
	return {
		showInSearchEngines: resume.showInSearchEngines,
		hideContactDetails: resume.hideContactDetails,
		isPrimary: resume.isPrimary,
		id: resume.id,
		name: resume.name,
		slug: resume.slug,
		tags: resume.tags,
		data: resume.data,
		isPublic: resume.isPublic,
		isLocked: resume.isLocked,
		showDownloadButtons: resume.showDownloadButtons,
		hasPassword,
	};
}

async function notifyResumeUpdated(event: ResumeUpdatedEvent) {
	try {
		await publishResumeUpdated(event);
	} catch (error) {
		console.warn("Failed to publish resume.updated event:", error);
	}
}

// One conditional UPDATE skips locked rows atomically; only a miss pays for the read that says why.
// Resumes in Trash miss both the update and the fallback read (activeResumeWhere), throwing NOT_FOUND without leaking lock state.
async function updateResumePassword(input: { id: string; userId: string; password: string | null }) {
	const owned = activeResumeWhere(input.id, input.userId);
	const [resume] = await db
		.update(schema.resume)
		.set({ password: input.password })
		.where(activeUnlockedResumeWhere(input.id, input.userId))
		.returning({ id: schema.resume.id, updatedAt: schema.resume.updatedAt });

	if (!resume) {
		const [existing] = await db.select({ id: schema.resume.id }).from(schema.resume).where(owned);
		throw existing ? new ORPCError("RESUME_LOCKED", { status: 403 }) : new ORPCError("NOT_FOUND");
	}

	await notifyResumeUpdated({
		type: "resume.updated",
		resumeId: resume.id,
		userId: input.userId,
		updatedAt: resume.updatedAt.toISOString(),
		mutation: "password",
	});
}

let unusedHash: Promise<string> | undefined;
const unusedPasswordHash = () => (unusedHash ??= hash(generateId(), 10));

/** Every storage prefix owned by one resume. Shared account pictures stay outside them. */
const resumeStorageKeys = (userId: string, resumeId: string) => [
	`uploads/${userId}/screenshots/${resumeId}`,
	`uploads/${userId}/pdfs/${resumeId}`,
];

export const resumeService = {
	tags,
	statistics,

	checkSlug,

	versions: {
		list: listVersions,
		get: getVersion,
		rename: renameVersion,
		delete: deleteVersion,

		/** "Name this version": keeps the resume as it is now, until the user deletes it. */
		create: async (input: { resumeId: string; userId: string; name: string }) => {
			const current = await resumeService.getById({ id: input.resumeId, userId: input.userId });
			return writeVersion(db, {
				resumeId: input.resumeId,
				userId: input.userId,
				data: current.data,
				kind: "named",
				name: input.name,
			});
		},

		// Non-destructive restore: writes the snapshot's data back through the normal update path, so
		// prior versions remain and the restore is itself just another (snapshot-able, undoable) change.
		restore: async (input: { resumeId: string; versionId: string; userId: string; proposalSafety?: "v1" }) => {
			// Check lock state before loading or validating historical data so locked resumes fail without expensive work.
			const current = await resumeService.getById({ id: input.resumeId, userId: input.userId });
			if (current.isLocked) throw new ORPCError("RESUME_LOCKED", { status: 403 });

			const version = await getVersion(input);

			// Capture the pre-restore state first so the restore itself is undoable.
			await writeVersion(db, {
				resumeId: input.resumeId,
				userId: input.userId,
				data: current.data,
				kind: "before-restore",
			});

			const updated = await resumeService.update({
				id: input.resumeId,
				userId: input.userId,
				data: version.data,
				skipAutoSnapshot: true,
				...(input.proposalSafety ? { proposalSafety: input.proposalSafety } : {}),
			});

			await writeVersion(db, {
				resumeId: input.resumeId,
				userId: input.userId,
				data: updated.data,
				kind: "restored",
			});

			return updated;
		},
	},

	list: (input: { userId: string; tags: string[]; sort: "lastUpdatedAt" | "createdAt" | "name" }) =>
		db
			.select({
				id: schema.resume.id,
				name: schema.resume.name,
				slug: schema.resume.slug,
				tags: schema.resume.tags,
				isPublic: schema.resume.isPublic,
				isLocked: schema.resume.isLocked,
				showDownloadButtons: schema.resume.showDownloadButtons,
				...shareColumns,
				createdAt: schema.resume.createdAt,
				updatedAt: schema.resume.updatedAt,
			})
			.from(schema.resume)
			.where(
				and(
					eq(schema.resume.userId, input.userId),
					isNull(schema.resume.trashedAt),
					input.tags.length > 0 ? arrayContains(schema.resume.tags, input.tags) : undefined,
				),
			)
			.orderBy(
				match(input.sort)
					.with("lastUpdatedAt", () => desc(schema.resume.updatedAt))
					.with("createdAt", () => asc(schema.resume.createdAt))
					.with("name", () => asc(schema.resume.name))
					.exhaustive(),
			),

	getById: async (input: { id: string; userId: string }) => {
		const [resume] = await db
			.select({ ...resumeColumns, applicationId: schema.resume.applicationId })
			.from(schema.resume)
			// Read-only and owner-scoped, so resumes in Trash stay readable for their thumbnails; writes reject them.
			.where(and(eq(schema.resume.id, input.id), eq(schema.resume.userId, input.userId)));

		if (!resume) throw new ORPCError("NOT_FOUND");

		// Clients get the current data shape (structured dates and their text in step), not the stored one.
		return { ...resume, data: parseStoredResumeData(resume.data) };
	},

	getBySlug: async (input: {
		username: string;
		slug: string;
		requestHeaders: Headers;
		trustedClient?: string;
		currentUserId?: string;
		requirePublic?: boolean;
		expectedResumeId?: string;
	}) => {
		const resume = await findResume(input, {
			id: schema.resume.id,
			userId: schema.resume.userId,
			name: schema.resume.name,
			slug: schema.resume.slug,
			tags: schema.resume.tags,
			data: schema.resume.data,
			isPublic: schema.resume.isPublic,
			isLocked: schema.resume.isLocked,
			showDownloadButtons: schema.resume.showDownloadButtons,
			...shareColumns,
			passwordHash: schema.resume.password,
			hasPassword: sql<boolean>`${schema.resume.password} IS NOT NULL`,
		});

		if (
			!resume ||
			(input.requirePublic && !resume.isPublic) ||
			(input.expectedResumeId && resume.id !== input.expectedResumeId)
		)
			throw new ORPCError("NOT_FOUND");

		const viewer = input.currentUserId ? { id: input.currentUserId } : null;
		assertCanView(resume, viewer);

		if (requiresPassword(resume, viewer) && !hasResumeAccess(input.requestHeaders, resume.id, resume.passwordHash)) {
			throw new ORPCError("NEED_PASSWORD", {
				status: 401,
				data: { username: input.username, slug: input.slug },
			});
		}

		if (shouldCountForStatistics(resume, viewer))
			await countVisit({ kind: "view", resumeId: resume.id, trustedClient: input.trustedClient });

		const current = { ...resume, data: parseStoredResumeData(resume.data) };
		return toSharedResumeResponse(redactResumeForViewer(current, isOwner(current, viewer)), resume.hasPassword);
	},

	create: async (input: {
		id?: string;
		userId: string;
		name: string;
		/** Generated from the name, and made unique among the user's resumes, when omitted. */
		slug?: string;
		tags: string[];
		locale: Locale;
		data?: ResumeData;
		/** The first version in History: "created", or "import" for an imported document. */
		origin?: "created" | "import";
		/** The name follows the headline until someone renames the resume. */
		autoName?: boolean;
	}) => {
		const id = input.id ?? generateId();
		const data = parseWritableResumeData(structuredClone(input.data ?? defaultResumeData));
		data.metadata.page.locale = input.locale;

		if (input.slug !== undefined && !isValidSlug(input.slug)) {
			throw new ORPCError("INVALID_SLUG", { status: 400 });
		}

		try {
			// An app-made address follows the name until the resume is published (see followNameWithSlug). A default
			// name ("Untitled resume", in the user's language) gives the neutral "resume" instead of a translation.
			const slug =
				input.slug ?? (await findFreeSlug(db, input.userId, input.autoName ? DEFAULT_SLUG_STEM : input.name));
			await db.transaction(async (tx) => {
				// The resume row comes first: letters an imported file carried are saved linked to it.
				const stored = structuredClone(data);
				detachEmbeddedLetters(stored);
				await tx.insert(schema.resume).values({
					id,
					name: input.name,
					autoName: input.autoName ?? false,
					slug,
					autoSlug: input.slug === undefined,
					tags: input.tags,
					userId: input.userId,
					data: stored,
				});
				await adoptEmbeddedLetters(tx, { userId: input.userId, resumeId: id, resumeName: input.name, data });
			});

			// History is never empty: its first entry is where the document came from (best effort).
			await writeVersion(db, { resumeId: id, userId: input.userId, data, kind: input.origin ?? "created" }).catch(
				(error: unknown) => console.warn("Failed to save the first version:", error),
			);

			await notifyResumeUpdated({
				type: "resume.updated",
				resumeId: id,
				userId: input.userId,
				updatedAt: new Date().toISOString(),
				mutation: "create",
			});

			return id;
		} catch (error) {
			if (error instanceof ORPCError) throw error;

			const constraint = uniqueConstraint(error);

			if (constraint === "resume_slug_user_id_unique") {
				throw new ORPCError("RESUME_SLUG_ALREADY_EXISTS", { status: 400 });
			}

			console.error("Couldn't create the resume. Try again.:", error);
			throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Couldn't create the resume. Try again." });
		}
	},

	update: async (input: {
		id: string;
		userId: string;
		name?: string;
		slug?: string;
		tags?: string[];
		data?: ResumeData;
		isPublic?: boolean;
		showDownloadButtons?: boolean;
		showInSearchEngines?: boolean;
		hideContactDetails?: boolean;
		isPrimary?: boolean;
		expectedUpdatedAt?: Date;
		skipAutoSnapshot?: boolean;
		/** The editor visit this save belongs to; its autosaves share one version. */
		sessionId?: string;
		proposalApplications?: ProposalApplications;
		proposalSafety?: "v1";
	}) => {
		const resume = await db
			.transaction(async (tx) => {
				const [existing] = await tx
					.select({
						name: schema.resume.name,
						data: schema.resume.data,
						slug: schema.resume.slug,
						isLocked: schema.resume.isLocked,
						isPublic: schema.resume.isPublic,
						autoName: schema.resume.autoName,
						autoSlug: schema.resume.autoSlug,
						updatedAt: schema.resume.updatedAt,
					})
					.from(schema.resume)
					.where(activeResumeWhere(input.id, input.userId))
					.for("update");

				if (!existing) throw new ORPCError("NOT_FOUND");
				if (existing.isLocked) throw new ORPCError("RESUME_LOCKED", { status: 403 });
				assertResumeVersion(existing.updatedAt, input.expectedUpdatedAt);
				if (input.data !== undefined)
					await assertCurrentClientWrite(tx, {
						userId: input.userId,
						document: { kind: "resume", id: input.id },
						proposalSafety: input.proposalSafety,
					});

				// A new address must follow the pattern; existing ones that don't keep working until changed.
				const renamed = input.slug !== undefined && input.slug !== existing.slug;
				if (renamed && !isValidSlug(input.slug as string)) {
					throw new ORPCError("INVALID_SLUG", { status: 400 });
				}
				if (renamed) {
					await recordSlugChange(tx, {
						userId: input.userId,
						resumeId: input.id,
						from: existing.slug,
						to: input.slug as string,
					});
				}

				const normalizedData = input.data ? parseWritableResumeData(input.data) : undefined;
				if (normalizedData)
					await adoptEmbeddedLetters(tx, {
						userId: input.userId,
						resumeId: input.id,
						resumeName: input.name ?? existing.name,
						data: normalizedData,
					});
				// A blank resume is named after its headline until someone names it by hand.
				const followedName =
					existing.autoName && input.name === undefined && normalizedData
						? normalizedData.basics.headline.trim().slice(0, 100) || undefined
						: undefined;
				const nextName = input.name ?? followedName;
				if (nextName !== undefined && nextName !== existing.name && input.slug === undefined)
					await followNameWithSlug(tx, { userId: input.userId, resumeId: input.id, name: nextName });
				// Publishing the account's first web page makes it the primary one, so the short link opens it.
				if (input.isPublic === true && !existing.isPublic && input.isPrimary === undefined)
					await claimPrimaryIfNone(tx, { userId: input.userId, resumeId: input.id });
				const updateData: Partial<typeof schema.resume.$inferSelect> = {
					...(input.proposalApplications && Object.keys(input.proposalApplications).length
						? { updatedAt: new Date() }
						: {}),
					...(input.name !== undefined ? { name: input.name, autoName: false } : {}),
					...(followedName ? { name: followedName } : {}),
					...(input.slug !== undefined ? { slug: input.slug } : {}),
					// Once chosen by hand or published, the address stays put.
					...(input.slug !== undefined || input.isPublic === true ? { autoSlug: false } : {}),
					...(input.tags !== undefined ? { tags: input.tags } : {}),
					...(normalizedData ? { data: normalizedData } : {}),
					...(input.isPublic !== undefined ? { isPublic: input.isPublic } : {}),
					...(input.showDownloadButtons !== undefined ? { showDownloadButtons: input.showDownloadButtons } : {}),
					...(input.showInSearchEngines !== undefined ? { showInSearchEngines: input.showInSearchEngines } : {}),
					...(input.hideContactDetails !== undefined ? { hideContactDetails: input.hideContactDetails } : {}),
					...(input.isPrimary !== undefined ? { isPrimary: input.isPrimary } : {}),
				};

				// Only a published resume can become the primary one; it takes the role from the account's previous primary.
				if (input.isPrimary === true) {
					if (!(input.isPublic ?? existing.isPublic))
						throw new ORPCError("RESUME_NOT_PUBLIC", {
							status: 400,
							message: "Publish the resume before making it primary.",
						});
					await tx
						.update(schema.resume)
						.set({ isPrimary: false })
						.where(
							and(
								eq(schema.resume.userId, input.userId),
								eq(schema.resume.isPrimary, true),
								ne(schema.resume.id, input.id),
							),
						);
				}

				const [updated] = await tx
					.update(schema.resume)
					.set(updateData)
					.where(activeUnlockedResumeWhere(input.id, input.userId))
					.returning(resumeColumns);

				if (!updated) throw new ORPCError("NOT_FOUND");
				await saveProposalApplications(tx, {
					userId: input.userId,
					document: { kind: "resume", id: input.id },
					applications: input.proposalApplications,
					conflict: () => resumeVersionConflict(existing.updatedAt),
				});
				return updated;
			})
			.catch(async (error: unknown) => {
				if (error instanceof CurrentClientRequired) throw await refuseOlderClient(input);
				if (error instanceof ORPCError) throw error;

				if (uniqueConstraint(error) === "resume_slug_user_id_unique") {
					throw new ORPCError("RESUME_SLUG_ALREADY_EXISTS", { status: 400 });
				}

				console.error("Couldn't update the resume. Try again.:", error);
				throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Couldn't update the resume. Try again." });
			});

		// Data edits refresh this editing session's version (see saveSessionVersion).
		if (input.data !== undefined && !input.skipAutoSnapshot) {
			await saveSessionVersion({
				resumeId: resume.id,
				userId: input.userId,
				data: resume.data,
				...(input.sessionId ? { sessionId: input.sessionId } : {}),
			});
		}

		await notifyResumeUpdated({
			type: "resume.updated",
			resumeId: resume.id,
			userId: input.userId,
			updatedAt: resume.updatedAt.toISOString(),
			mutation: "update",
		});

		return resume;
	},

	patch: async (input: {
		id: string;
		userId: string;
		operations: JsonPatchOperation[];
		expectedUpdatedAt?: Date;
		proposalApplications?: ProposalApplications;
		proposalSafety?: "v1";
	}) => {
		const resume = await db
			.transaction((tx) => applyResumePatchTx(tx, input))
			.catch(async (error: unknown) => {
				throw error instanceof CurrentClientRequired ? await refuseOlderClient(input) : error;
			});

		await notifyResumeUpdated({
			type: "resume.updated",
			resumeId: resume.id,
			userId: input.userId,
			updatedAt: resume.updatedAt.toISOString(),
			mutation: "patch",
		});

		return resume;
	},

	patchInTransaction: applyResumePatchTx,

	setLocked: async (input: { id: string; userId: string; isLocked: boolean }) => {
		const [resume] = await db
			.update(schema.resume)
			.set({ isLocked: input.isLocked })
			.where(activeResumeWhere(input.id, input.userId))
			.returning({ id: schema.resume.id, updatedAt: schema.resume.updatedAt });

		if (!resume) throw new ORPCError("NOT_FOUND");

		await notifyResumeUpdated({
			type: "resume.updated",
			resumeId: resume.id,
			userId: input.userId,
			updatedAt: resume.updatedAt.toISOString(),
			mutation: "lock",
		});
	},

	setPassword: async (input: { id: string; userId: string; password: string }) =>
		updateResumePassword({ ...input, password: await hash(input.password, 10) }),

	verifyPassword: async (input: {
		slug: string;
		username: string;
		password: string;
		responseHeaders?: Headers;
		trustedClient?: string | undefined;
	}) => {
		const resume = await findResume(
			input,
			{ id: schema.resume.id, password: schema.resume.password },
			isNotNull(schema.resume.password),
			eq(schema.resume.isPublic, true),
		);

		if (!(await consumeResumePasswordLimit({ resumeId: resume?.id ?? "missing", trustedClient: input.trustedClient })))
			throw new ORPCError("TOO_MANY_REQUESTS");
		// A miss costs the same bcrypt work as a wrong password, so timing doesn't reveal which addresses exist.
		const passwordHash = resume?.password ?? (await unusedPasswordHash());
		const isValid = await compare(input.password, passwordHash);
		if (!resume) throw new ORPCError("INVALID_PASSWORD", { status: 401 });

		if (!isValid) throw new ORPCError("INVALID_PASSWORD", { status: 401 });

		if (input.responseHeaders) grantResumeAccess(input.responseHeaders, resume.id, passwordHash);

		return true;
	},

	removePassword: (input: { id: string; userId: string }) => updateResumePassword({ ...input, password: null }),

	/**
	 * With `trashedBefore`, deletes only if the resume is still in Trash since before then (Trash expiry): a resume
	 * restored meanwhile stays, and a lock doesn't keep an expired one.
	 */
	delete: async (input: { id: string; userId: string; trashedBefore?: Date }) => {
		const target = and(
			eq(schema.resume.id, input.id),
			eq(schema.resume.userId, input.userId),
			input.trashedBefore ? lt(schema.resume.trashedAt, input.trashedBefore) : undefined,
		);
		const deleted = await db.transaction(async (tx) => {
			await lockUser(tx, input.userId);
			const [resume] = await tx.select({ isLocked: schema.resume.isLocked }).from(schema.resume).where(target);

			if (!resume) {
				if (input.trashedBefore) return false;
				throw new ORPCError("NOT_FOUND");
			}
			if (resume.isLocked && !input.trashedBefore) throw new ORPCError("RESUME_LOCKED", { status: 403 });

			await tx.delete(schema.resume).where(target);
			await enqueueStorageCleanup(tx, input.userId, resumeStorageKeys(input.userId, input.id));
			return true;
		});
		if (!deleted) return;

		await runStorageCleanup({
			storageKeys: resumeStorageKeys(input.userId, input.id),
			limit: 2,
		})
			.then(reportStorageCleanupSummary)
			.catch((error: unknown) => console.warn("Failed to run resume storage cleanup now; it will retry.", error));

		await notifyResumeUpdated({
			type: "resume.updated",
			resumeId: input.id,
			userId: input.userId,
			updatedAt: new Date().toISOString(),
			mutation: "delete",
		});
	},

	/**
	 * Permanently deletes a batch of this account's trashed resumes in one statement. `ids` narrows it to selected
	 * documents; `trashedBefore` keeps a resume restored by another request. Cleanup jobs are written in the same
	 * transaction; a bounded immediate pass runs after commit and the scheduler retries anything still pending.
	 */
	deleteTrashedMany: async (input: { userId: string; ids?: readonly string[]; trashedBefore?: Date }) => {
		const target = and(
			eq(schema.resume.userId, input.userId),
			isNotNull(schema.resume.trashedAt),
			input.ids ? inArray(schema.resume.id, [...input.ids]) : undefined,
			input.trashedBefore ? lt(schema.resume.trashedAt, input.trashedBefore) : undefined,
		);
		const ids = await db.transaction(async (tx) => {
			await lockUser(tx, input.userId);
			const rows = await tx.delete(schema.resume).where(target).returning({ id: schema.resume.id });
			const deleted = rows.map((row) => row.id);
			await enqueueStorageCleanup(
				tx,
				input.userId,
				deleted.flatMap((id) => resumeStorageKeys(input.userId, id)),
			);
			return deleted;
		});
		if (ids.length === 0) return 0;

		const cleanupKeys = ids.flatMap((id) => resumeStorageKeys(input.userId, id));
		await runStorageCleanup({ storageKeys: cleanupKeys.slice(0, 200), limit: 200 })
			.then(reportStorageCleanupSummary)
			.catch((error: unknown) => console.warn("Failed to run Trash storage cleanup now; it will retry.", error));

		const chunkSize = 100;
		for (let start = 0; start < ids.length; start += chunkSize) {
			const chunk = ids.slice(start, start + chunkSize);
			await Promise.allSettled(
				chunk.map((id) =>
					notifyResumeUpdated({
						type: "resume.updated",
						resumeId: id,
						userId: input.userId,
						updatedAt: new Date().toISOString(),
						mutation: "delete",
					}),
				),
			);
		}
		return ids.length;
	},
};
