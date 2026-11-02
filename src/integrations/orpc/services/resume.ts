import { ORPCError } from "@orpc/client";
import { and, arrayContains, asc, desc, eq, isNotNull, or, sql } from "drizzle-orm";
import { get } from "es-toolkit/compat";
import type { Operation } from "fast-json-patch";
import { match } from "ts-pattern";
import { schema } from "@/integrations/drizzle";
import { db } from "@/integrations/drizzle/client";
import type { ResumeData } from "@/schema/resume/data";
import { defaultResumeData } from "@/schema/resume/data";
import { env } from "@/utils/env";
import type { Locale } from "@/utils/locale";
import { hashPassword, verifyPassword } from "@/utils/password";
import { applyResumePatches, ResumePatchError } from "@/utils/resume/patch";
import { generateId } from "@/utils/string";
import { grantResumeAccess, hasResumeAccess } from "../helpers/resume-access";
import { getStorageService } from "./storage";

/**
 * Record a student edit made while a reviewer is waiting on changes, for the "Modified" report.
 *
 * Deliberately swallows its own errors: this is an audit row, and the save it describes has
 * already succeeded. Letting it throw here would turn a logging problem into a student losing
 * their work.
 */
async function noteStudentEdit(resume?: { id: string; reviewStatus: string | null }) {
	if (!resume) return;
	try {
		const { recordStudentEditAfterRevision } = await import("@/integrations/drizzle/services/resume-feedback.service");
		await recordStudentEditAfterRevision(resume.id, resume.reviewStatus);
	} catch (error) {
		console.error("[resume] could not record student edit", error);
	}
}

const tags = {
	list: async (input: { userId: string }) => {
		const result = await db
			.select({ tags: schema.resume.tags })
			.from(schema.resume)
			.where(eq(schema.resume.userId, input.userId));

		const uniqueTags = new Set(result.flatMap((tag) => tag.tags));
		const sortedTags = Array.from(uniqueTags).sort((a, b) => a.localeCompare(b));

		return sortedTags;
	},
};

const statistics = {
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

		// Deleted, missing or someone else's resume: 404, not a 500 from reading `undefined`.
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

		await db
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
	},
};

/**
 * Trims `picture.url`, then inlines the image as base64 when possible (printer iframe).
 * If the server cannot fetch the file (missing asset, wrong host, 403/404), clears the URL
 * so the UI matches "no visible photo" and ATS scoring does not false-positive on a dead link.
 */
async function normalizeResumePictureForPreview(data: ResumeData): Promise<void> {
	const pic = data.picture;
	pic.url = (pic.url ?? "").trim();
	if (pic.hidden || !pic.url) return;

	try {
		const url = pic.url.replace(env.APP_URL, "http://localhost:3000");
		const res = await fetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const buffer = await res.arrayBuffer();
		const base64 = Buffer.from(buffer).toString("base64");
		pic.url = `data:image/jpeg;base64,${base64}`;
	} catch {
		pic.url = "";
	}
}

export const resumeService = {
	tags,
	statistics,

	list: async (input: { userId: string; tags: string[]; sort: "lastUpdatedAt" | "createdAt" | "name" }) => {
		return await db
			.select({
				id: schema.resume.id,
				name: schema.resume.name,
				slug: schema.resume.slug,
				tags: schema.resume.tags,
				data: schema.resume.data,
				isPublic: schema.resume.isPublic,
				isLocked: schema.resume.isLocked,
				isPrimary: schema.resume.isPrimary,
				reviewStatus: schema.resume.reviewStatus,
				createdAt: schema.resume.createdAt,
				updatedAt: schema.resume.updatedAt,
			})
			.from(schema.resume)
			.where(
				and(
					eq(schema.resume.userId, input.userId),
					match(input.tags.length)
						.with(0, () => undefined)
						.otherwise(() => arrayContains(schema.resume.tags, input.tags)),
				),
			)
			.orderBy(
				match(input.sort)
					.with("lastUpdatedAt", () => desc(schema.resume.updatedAt))
					.with("createdAt", () => asc(schema.resume.createdAt))
					.with("name", () => asc(schema.resume.name))
					.exhaustive(),
			);
	},

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
				isPrimary: schema.resume.isPrimary,
				reviewStatus: schema.resume.reviewStatus,
				unlockReason: schema.resume.unlockReason,
				hasPassword: sql<boolean>`${schema.resume.password} IS NOT NULL`,
			})
			.from(schema.resume)
			.where(and(eq(schema.resume.id, input.id), eq(schema.resume.userId, input.userId)));

		if (!resume) throw new ORPCError("NOT_FOUND");

		return resume;
	},

	normalizePictureForPreview: normalizeResumePictureForPreview,

	getByIdForPrinter: async (input: { id: string }) => {
		const [resume] = await db
			.select({
				id: schema.resume.id,
				name: schema.resume.name,
				slug: schema.resume.slug,
				tags: schema.resume.tags,
				data: schema.resume.data,
				userId: schema.resume.userId,
				isLocked: schema.resume.isLocked,
				reviewStatus: schema.resume.reviewStatus,
				updatedAt: schema.resume.updatedAt,
			})
			.from(schema.resume)
			.where(eq(schema.resume.id, input.id));

		if (!resume) throw new ORPCError("NOT_FOUND");

		await normalizeResumePictureForPreview(resume.data);

		return resume;
	},

	getBySlug: async (input: { username: string; slug: string; currentUserId?: string }) => {
		const [resume] = await db
			.select({
				id: schema.resume.id,
				name: schema.resume.name,
				slug: schema.resume.slug,
				tags: schema.resume.tags,
				data: schema.resume.data,
				isPublic: schema.resume.isPublic,
				isLocked: schema.resume.isLocked,
				isPrimary: schema.resume.isPrimary,
				reviewStatus: schema.resume.reviewStatus,
				unlockReason: schema.resume.unlockReason,
				passwordHash: schema.resume.password,
				hasPassword: sql<boolean>`${schema.resume.password} IS NOT NULL`,
			})
			.from(schema.resume)
			.innerJoin(schema.user, eq(schema.resume.userId, schema.user.id))
			.where(
				and(
					eq(schema.resume.slug, input.slug),
					eq(schema.user.username, input.username),
					input.currentUserId
						? or(eq(schema.resume.isPublic, true), eq(schema.resume.userId, input.currentUserId))
						: eq(schema.resume.isPublic, true),
				),
			);

		if (!resume) throw new ORPCError("NOT_FOUND");

		if (!resume.hasPassword) {
			await resumeService.statistics.increment({ id: resume.id, views: true });

			return {
				id: resume.id,
				name: resume.name,
				slug: resume.slug,
				tags: resume.tags,
				data: resume.data,
				isPublic: resume.isPublic,
				isLocked: resume.isLocked,
				isPrimary: resume.isPrimary,
				reviewStatus: resume.reviewStatus,
				unlockReason: resume.unlockReason,
				hasPassword: false as const,
			};
		}

		if (hasResumeAccess(resume.id, resume.passwordHash)) {
			await resumeService.statistics.increment({ id: resume.id, views: true });

			return {
				id: resume.id,
				name: resume.name,
				slug: resume.slug,
				tags: resume.tags,
				data: resume.data,
				isPublic: resume.isPublic,
				isLocked: resume.isLocked,
				isPrimary: resume.isPrimary,
				reviewStatus: resume.reviewStatus,
				unlockReason: resume.unlockReason,
				hasPassword: true as const,
			};
		}

		throw new ORPCError("NEED_PASSWORD", {
			status: 401,
			data: { username: input.username, slug: input.slug },
		});
	},

	create: async (input: {
		userId: string;
		name: string;
		slug: string;
		tags: string[];
		locale: Locale;
		data?: ResumeData;
	}) => {
		const id = generateId();

		input.data = input.data ?? defaultResumeData;
		input.data.metadata.page.locale = input.locale;

		try {
			// `resume.tenant_id` / `organisation_id` are NOT NULL without a Postgres DEFAULT,
			// so we must send values explicitly on insert. Source them from the user row.
			const [userRow] = await db
				.select({ tenantId: schema.user.tenantId, organisationId: schema.user.organisationId })
				.from(schema.user)
				.where(eq(schema.user.id, input.userId))
				.limit(1);

			if (!userRow) throw new Error(`User ${input.userId} not found while creating resume`);

			const now = new Date();
			await db.insert(schema.resume).values({
				id,
				name: input.name,
				slug: input.slug,
				tags: input.tags,
				userId: input.userId,
				data: input.data,
				tenantId: userRow.tenantId,
				organisationId: userRow.organisationId,
				createdAt: now,
				updatedAt: now,
			});

			return id;
		} catch (error) {
			const constraint = get(error, "cause.constraint") as string | undefined;

			if (constraint === "resume_slug_user_id_unique") {
				throw new ORPCError("RESUME_SLUG_ALREADY_EXISTS", { status: 400 });
			}

			throw error;
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
	}) => {
		const [resume] = await db
			.select({ isLocked: schema.resume.isLocked })
			.from(schema.resume)
			.where(and(eq(schema.resume.id, input.id), eq(schema.resume.userId, input.userId)));

		if (resume?.isLocked) throw new ORPCError("RESUME_LOCKED");

		const updateData: Partial<typeof schema.resume.$inferSelect> = {
			name: input.name,
			slug: input.slug,
			tags: input.tags,
			data: input.data,
			isPublic: input.isPublic,
		};

		try {
			const [resume] = await db
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
					isPrimary: schema.resume.isPrimary,
					reviewStatus: schema.resume.reviewStatus,
					unlockReason: schema.resume.unlockReason,
					hasPassword: sql<boolean>`${schema.resume.password} IS NOT NULL`,
				});

			await noteStudentEdit(resume);
			return resume;
		} catch (error) {
			if (get(error, "cause.constraint") === "resume_slug_user_id_unique") {
				throw new ORPCError("RESUME_SLUG_ALREADY_EXISTS", { status: 400 });
			}

			throw error;
		}
	},

	patch: async (input: { id: string; userId: string; operations: Operation[] }) => {
		const [existing] = await db
			.select({ data: schema.resume.data, isLocked: schema.resume.isLocked })
			.from(schema.resume)
			.where(and(eq(schema.resume.id, input.id), eq(schema.resume.userId, input.userId)));

		if (!existing) throw new ORPCError("NOT_FOUND");
		if (existing.isLocked) throw new ORPCError("RESUME_LOCKED");

		let patchedData: ResumeData;

		try {
			patchedData = applyResumePatches(existing.data, input.operations);
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

		const [resume] = await db
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
				isPrimary: schema.resume.isPrimary,
				reviewStatus: schema.resume.reviewStatus,
				unlockReason: schema.resume.unlockReason,
				hasPassword: sql<boolean>`${schema.resume.password} IS NOT NULL`,
			});

		await noteStudentEdit(resume);
		return resume;
	},

	setLocked: async (input: { id: string; userId: string; isLocked: boolean }) => {
		// If trying to unlock, check whether the resume is in a PO-controlled state.
		// Students are not permitted to unlock resumes that the placement officer owns.
		if (!input.isLocked) {
			const PO_LOCKED_STATUSES = new Set(["FINALIZED_BY_FACULTY", "RESUBMITTED_TO_PO", "PO_VERIFIED", "APPROVED"]);

			const [current] = await db
				.select({ reviewStatus: schema.resume.reviewStatus })
				.from(schema.resume)
				.where(and(eq(schema.resume.id, input.id), eq(schema.resume.userId, input.userId)));

			if (current && PO_LOCKED_STATUSES.has(current.reviewStatus)) {
				throw new ORPCError("FORBIDDEN", {
					message:
						"This resume has been locked by the Placement Officer and cannot be unlocked. Contact your placement officer if you need changes.",
				});
			}
		}

		await db
			.update(schema.resume)
			.set({ isLocked: input.isLocked })
			.where(and(eq(schema.resume.id, input.id), eq(schema.resume.userId, input.userId)));
	},

	setPassword: async (input: { id: string; userId: string; password: string }) => {
		const hashedPassword = await hashPassword(input.password);

		await db
			.update(schema.resume)
			.set({ password: hashedPassword })
			.where(and(eq(schema.resume.id, input.id), eq(schema.resume.userId, input.userId)));
	},

	verifyPassword: async (input: { slug: string; username: string; password: string }) => {
		const [resume] = await db
			.select({ id: schema.resume.id, password: schema.resume.password })
			.from(schema.resume)
			.innerJoin(schema.user, eq(schema.resume.userId, schema.user.id))
			.where(
				and(
					isNotNull(schema.resume.password),
					eq(schema.resume.slug, input.slug),
					eq(schema.user.username, input.username),
				),
			);

		if (!resume) throw new ORPCError("NOT_FOUND");

		const passwordHash = resume.password as string;
		const isValid = await verifyPassword(input.password, passwordHash);

		if (!isValid) throw new ORPCError("INVALID_PASSWORD");

		grantResumeAccess(resume.id, passwordHash);

		return true;
	},

	removePassword: async (input: { id: string; userId: string }) => {
		await db
			.update(schema.resume)
			.set({ password: null })
			.where(and(eq(schema.resume.id, input.id), eq(schema.resume.userId, input.userId)));
	},

	delete: async (input: { id: string; userId: string }) => {
		const storageService = getStorageService();

		const deleteResumePromise = db
			.delete(schema.resume)
			.where(
				and(eq(schema.resume.id, input.id), eq(schema.resume.isLocked, false), eq(schema.resume.userId, input.userId)),
			);

		// Delete screenshots and PDFs using the new key format
		const deleteScreenshotsPromise = storageService.delete(`uploads/${input.userId}/screenshots/${input.id}`);
		const deletePdfsPromise = storageService.delete(`uploads/${input.userId}/pdfs/${input.id}`);

		await Promise.allSettled([deleteResumePromise, deleteScreenshotsPromise, deletePdfsPromise]);
	},

	setPrimary: async (input: { id: string; userId: string }) => {
		await db.transaction(async (tx) => {
			// Unset current primary resume
			await tx
				.update(schema.resume)
				.set({ isPrimary: false })
				.where(and(eq(schema.resume.userId, input.userId), eq(schema.resume.isPrimary, true)));

			// Set new primary resume
			await tx
				.update(schema.resume)
				.set({ isPrimary: true })
				.where(and(eq(schema.resume.id, input.id), eq(schema.resume.userId, input.userId)));
		});
	},
};
