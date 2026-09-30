import type { ResumeUpdatedEvent } from "./events";
import type { DbOrTx } from "@reactive-resume/db/client";
import type { JsonPatchOperation } from "@reactive-resume/resume/patch";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Locale } from "@reactive-resume/utils/locale";
import { ORPCError } from "@orpc/client";
import { compare, hash } from "bcryptjs";
import { and, arrayContains, asc, desc, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import { match } from "ts-pattern";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { detachEmbeddedLetters } from "@reactive-resume/resume/cover-letter";
import { applyResumePatches, ResumePatchError } from "@reactive-resume/resume/patch";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { generateId } from "@reactive-resume/utils/string";
import { adoptEmbeddedLetters } from "../cover-letters/embedded";
import { getStorageService } from "../storage/service";
import { grantResumeAccess, hasResumeAccess } from "./access";
import { assertCanView, isOwner, redactResumeForViewer, shouldCountForStatistics } from "./access-policy";
import { publishResumeUpdated } from "./events";
import { parseStoredResumeData, parseWritableResumeData } from "./resume-data-validation";
import { checkSlug, findFreeSlug, matchesSlug, recordSlugChange, SLUG_PATTERN } from "./slugs";
import {
	deleteVersion,
	getVersion,
	listVersions,
	renameVersion,
	saveSessionVersion,
	writeVersion,
} from "./version-history";
import { clientKeyFromHeaders, shouldCountView } from "./view-dedup";

function resumeVersionConflict(updatedAt: Date) {
	return new ORPCError("RESUME_VERSION_CONFLICT", {
		status: 409,
		message: "The resume changed after this patch was generated.",
		data: { updatedAt: updatedAt.toISOString() },
	});
}

function invalidPatchOperation(message: string, index: number, operation: JsonPatchOperation) {
	return new ORPCError("INVALID_PATCH_OPERATIONS", { status: 400, message, data: { index, operation } });
}

/** The unique constraint a Postgres insert or update broke, if that's why it failed. */
const uniqueConstraint = (error: unknown) => (error as { cause?: { constraint?: string } } | null)?.cause?.constraint;

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

async function applyResumePatchTx(
	client: DbOrTx,
	input: {
		id: string;
		userId: string;
		operations: JsonPatchOperation[];
		expectedUpdatedAt?: Date;
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
		.where(and(eq(schema.resume.id, input.id), eq(schema.resume.userId, input.userId)))
		.for("update");

	if (!existing) throw new ORPCError("NOT_FOUND");
	if (existing.isLocked) throw new ORPCError("RESUME_LOCKED", { status: 403 });
	if (input.expectedUpdatedAt && existing.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
		throw resumeVersionConflict(existing.updatedAt);
	}

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
		.where(
			and(eq(schema.resume.id, input.id), eq(schema.resume.isLocked, false), eq(schema.resume.userId, input.userId)),
		)
		.returning({
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
		});

	if (!resume) {
		if (input.expectedUpdatedAt) throw resumeVersionConflict(existing.updatedAt);
		throw new ORPCError("NOT_FOUND");
	}

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
			.where(eq(schema.resume.userId, input.userId));

		return [...new Set(result.flatMap((tag) => tag.tags))].sort((a, b) => a.localeCompare(b));
	},
};

const statistics = {
	recordDownload: async (input: {
		username: string;
		slug: string;
		requestHeaders: Headers;
		currentUserId?: string;
	}): Promise<boolean> => {
		const [resume] = await db
			.select({
				id: schema.resume.id,
				userId: schema.resume.userId,
				isPublic: schema.resume.isPublic,
				passwordHash: schema.resume.password,
			})
			.from(schema.resume)
			.innerJoin(schema.user, eq(schema.resume.userId, schema.user.id))
			.where(
				and(
					eq(schema.resume.slug, input.slug),
					eq(schema.user.username, input.username),
					isNull(schema.resume.trashedAt),
				),
			);

		if (!resume) throw new ORPCError("NOT_FOUND");
		const viewer = input.currentUserId ? { id: input.currentUserId } : null;
		assertCanView(resume, viewer);
		if (
			resume.passwordHash &&
			!isOwner(resume, viewer) &&
			!hasResumeAccess(input.requestHeaders, resume.id, resume.passwordHash)
		) {
			throw new ORPCError("NEED_PASSWORD", {
				status: 401,
				data: { username: input.username, slug: input.slug },
			});
		}

		if (shouldCountForStatistics(resume, viewer)) {
			await statistics.increment({ id: resume.id, downloads: true });
		}
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
			.where(and(eq(schema.resume.id, input.id), eq(schema.resume.userId, input.userId)));

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
			.where(and(eq(schema.resume.id, input.id), eq(schema.resume.userId, input.userId)));

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
	},
	hasPassword: boolean,
) {
	return {
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
		restore: async (input: { resumeId: string; versionId: string; userId: string }) => {
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
			.select({
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
				applicationId: schema.resume.applicationId,
			})
			.from(schema.resume)
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
		const [resume] = await db
			.select({
				id: schema.resume.id,
				userId: schema.resume.userId,
				name: schema.resume.name,
				slug: schema.resume.slug,
				tags: schema.resume.tags,
				data: schema.resume.data,
				isPublic: schema.resume.isPublic,
				isLocked: schema.resume.isLocked,
				showDownloadButtons: schema.resume.showDownloadButtons,
				passwordHash: schema.resume.password,
				hasPassword: sql<boolean>`${schema.resume.password} IS NOT NULL`,
			})
			.from(schema.resume)
			.innerJoin(schema.user, eq(schema.resume.userId, schema.user.id))
			.where(and(matchesSlug(input.slug), eq(schema.user.username, input.username), isNull(schema.resume.trashedAt)))
			// A resume's current slug wins over another's redirect (renames delete clashing redirects anyway).
			.orderBy(desc(sql`${schema.resume.slug} = ${input.slug}`))
			.limit(1);

		if (
			!resume ||
			(input.requirePublic && !resume.isPublic) ||
			(input.expectedResumeId && resume.id !== input.expectedResumeId)
		)
			throw new ORPCError("NOT_FOUND");

		const viewer = input.currentUserId ? { id: input.currentUserId } : null;
		assertCanView(resume, viewer);

		if (
			resume.hasPassword &&
			!isOwner(resume, viewer) &&
			!hasResumeAccess(input.requestHeaders, resume.id, resume.passwordHash)
		) {
			throw new ORPCError("NEED_PASSWORD", {
				status: 401,
				data: { username: input.username, slug: input.slug },
			});
		}

		if (shouldCountForStatistics(resume, viewer)) {
			const key = `${resume.id}:${clientKeyFromHeaders(input.trustedClient)}`;
			if (await shouldCountView(key, Date.now())) {
				await resumeService.statistics.increment({ id: resume.id, views: true });
			}
		}

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

		try {
			const slug = input.slug ?? (await findFreeSlug(db, input.userId, input.name));
			await db.transaction(async (tx) => {
				// The resume row comes first: letters an imported file carried are saved linked to it.
				const stored = structuredClone(data);
				detachEmbeddedLetters(stored);
				await tx.insert(schema.resume).values({
					id,
					name: input.name,
					autoName: input.autoName ?? false,
					slug,
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
			const constraint = uniqueConstraint(error);

			if (constraint === "resume_slug_user_id_unique") {
				throw new ORPCError("RESUME_SLUG_ALREADY_EXISTS", { status: 400 });
			}

			console.error("Failed to create resume:", error);
			throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to create resume" });
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
		skipAutoSnapshot?: boolean;
		/** The editor visit this save belongs to; its autosaves share one version. */
		sessionId?: string;
	}) => {
		const resume = await db
			.transaction(async (tx) => {
				const [existing] = await tx
					.select({
						name: schema.resume.name,
						data: schema.resume.data,
						slug: schema.resume.slug,
						isLocked: schema.resume.isLocked,
						autoName: schema.resume.autoName,
					})
					.from(schema.resume)
					.where(and(eq(schema.resume.id, input.id), eq(schema.resume.userId, input.userId)))
					.for("update");

				if (!existing) throw new ORPCError("NOT_FOUND");
				if (existing.isLocked) throw new ORPCError("RESUME_LOCKED", { status: 403 });

				// A new address must follow the pattern; existing ones that don't keep working until changed.
				const renamed = input.slug !== undefined && input.slug !== existing.slug;
				if (renamed && !SLUG_PATTERN.test(input.slug as string)) {
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
				const updateData: Partial<typeof schema.resume.$inferSelect> = {
					...(input.name !== undefined ? { name: input.name, autoName: false } : {}),
					...(followedName ? { name: followedName } : {}),
					...(input.slug !== undefined ? { slug: input.slug } : {}),
					...(input.tags !== undefined ? { tags: input.tags } : {}),
					...(normalizedData ? { data: normalizedData } : {}),
					...(input.isPublic !== undefined ? { isPublic: input.isPublic } : {}),
					...(input.showDownloadButtons !== undefined ? { showDownloadButtons: input.showDownloadButtons } : {}),
				};

				const [updated] = await tx
					.update(schema.resume)
					.set(updateData)
					.where(
						and(
							eq(schema.resume.id, input.id),
							eq(schema.resume.isLocked, false),
							eq(schema.resume.userId, input.userId),
						),
					)
					.returning({
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
					});

				if (!updated) throw new ORPCError("NOT_FOUND");
				return updated;
			})
			.catch((error: unknown) => {
				if (error instanceof ORPCError) throw error;

				if (uniqueConstraint(error) === "resume_slug_user_id_unique") {
					throw new ORPCError("RESUME_SLUG_ALREADY_EXISTS", { status: 400 });
				}

				console.error("Failed to update resume:", error);
				throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to update resume" });
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

	patch: async (input: { id: string; userId: string; operations: JsonPatchOperation[]; expectedUpdatedAt?: Date }) => {
		const resume = await db.transaction((tx) => applyResumePatchTx(tx, input));

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
			.where(and(eq(schema.resume.id, input.id), eq(schema.resume.userId, input.userId)))
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

	setPassword: async (input: { id: string; userId: string; password: string }) => {
		const hashedPassword = await hash(input.password, 10);

		const [resume] = await db
			.update(schema.resume)
			.set({ password: hashedPassword })
			.where(and(eq(schema.resume.id, input.id), eq(schema.resume.userId, input.userId)))
			.returning({ id: schema.resume.id, updatedAt: schema.resume.updatedAt });

		if (!resume) throw new ORPCError("NOT_FOUND");

		await notifyResumeUpdated({
			type: "resume.updated",
			resumeId: resume.id,
			userId: input.userId,
			updatedAt: resume.updatedAt.toISOString(),
			mutation: "password",
		});
	},

	verifyPassword: async (input: { slug: string; username: string; password: string; responseHeaders?: Headers }) => {
		const [resume] = await db
			.select({ id: schema.resume.id, password: schema.resume.password })
			.from(schema.resume)
			.innerJoin(schema.user, eq(schema.resume.userId, schema.user.id))
			.where(
				and(
					isNotNull(schema.resume.password),
					matchesSlug(input.slug),
					eq(schema.user.username, input.username),
					isNull(schema.resume.trashedAt),
				),
			)
			.orderBy(desc(sql`${schema.resume.slug} = ${input.slug}`))
			.limit(1);

		if (!resume) throw new ORPCError("INVALID_PASSWORD", { status: 401 });

		const passwordHash = resume.password as string;
		const isValid = await compare(input.password, passwordHash);

		if (!isValid) throw new ORPCError("INVALID_PASSWORD", { status: 401 });

		if (input.responseHeaders) grantResumeAccess(input.responseHeaders, resume.id, passwordHash);

		return true;
	},

	removePassword: async (input: { id: string; userId: string }) => {
		const [resume] = await db
			.update(schema.resume)
			.set({ password: null })
			.where(and(eq(schema.resume.id, input.id), eq(schema.resume.userId, input.userId)))
			.returning({ id: schema.resume.id, updatedAt: schema.resume.updatedAt });

		if (!resume) throw new ORPCError("NOT_FOUND");

		await notifyResumeUpdated({
			type: "resume.updated",
			resumeId: resume.id,
			userId: input.userId,
			updatedAt: resume.updatedAt.toISOString(),
			mutation: "password",
		});
	},

	delete: async (input: { id: string; userId: string }) => {
		await db.transaction(async (tx) => {
			const [resume] = await tx
				.select({ isLocked: schema.resume.isLocked })
				.from(schema.resume)
				.where(and(eq(schema.resume.id, input.id), eq(schema.resume.userId, input.userId)));

			if (!resume) throw new ORPCError("NOT_FOUND");
			if (resume.isLocked) throw new ORPCError("RESUME_LOCKED", { status: 403 });

			await tx.delete(schema.resume).where(and(eq(schema.resume.id, input.id), eq(schema.resume.userId, input.userId)));
		});

		// Clean up storage files after the DB transaction succeeds
		const storageService = getStorageService();
		await Promise.allSettled([
			storageService.delete(`uploads/${input.userId}/screenshots/${input.id}`),
			storageService.delete(`uploads/${input.userId}/pdfs/${input.id}`),
		]);

		await notifyResumeUpdated({
			type: "resume.updated",
			resumeId: input.id,
			userId: input.userId,
			updatedAt: new Date().toISOString(),
			mutation: "delete",
		});
	},
};
