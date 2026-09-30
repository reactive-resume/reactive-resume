import type { CritiqueCommentStatus } from "@reactive-resume/schema/resume/critique";
import { ORPCError } from "@orpc/client";
import { compare, hash } from "bcrypt";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { generateId } from "@reactive-resume/utils/string";
import { grantCritiquerCookie, readCritiquerIdFromCookie } from "../resume/critique-access";

function needCritiqueAccess(username: string, slug: string) {
	return new ORPCError("NEED_PASSWORD", { status: 401, data: { username, slug } });
}

// Resolves a resume that is currently eligible for critique (public + critique mode on + a
// password set) by owner's username + slug. Throws NOT_FOUND for anything else — including a
// resume that exists but has critique mode off — so the endpoint doesn't disclose which case
// applies, mirroring assertCanView's NOT_FOUND-not-FORBIDDEN convention for the sharing path.
async function getCritiqueEligibleResume(username: string, slug: string) {
	const [resume] = await db
		.select({
			id: schema.resume.id,
			userId: schema.resume.userId,
			name: schema.resume.name,
			data: schema.resume.data,
			critiquePassword: schema.resume.critiquePassword,
		})
		.from(schema.resume)
		.innerJoin(schema.user, eq(schema.resume.userId, schema.user.id))
		.where(
			and(
				eq(schema.resume.slug, slug),
				eq(schema.user.username, username),
				eq(schema.resume.isPublic, true),
				eq(schema.resume.critiqueEnabled, true),
				isNotNull(schema.resume.critiquePassword),
			),
		);

	if (!resume?.critiquePassword) throw new ORPCError("NOT_FOUND");
	return { ...resume, critiquePassword: resume.critiquePassword };
}

// Resolves the calling critiquer's id from their cookie, verifying the critiquer row still
// exists for this resume (it may have been implicitly invalidated if the cookie predates a
// password rotation, or a rare bad-actor-forged id). Throws the same NEED_PASSWORD shape as a
// missing password so the public route's existing onError→redirect handling covers this too.
async function requireCritiquerId(requestHeaders: Headers, resumeId: string, critiquePasswordHash: string) {
	const cookieCritiquerId = readCritiquerIdFromCookie(requestHeaders, resumeId, critiquePasswordHash);
	if (!cookieCritiquerId) return null;

	const [critiquer] = await db
		.select({ id: schema.resumeCritiqueCritiquer.id })
		.from(schema.resumeCritiqueCritiquer)
		.where(
			and(
				eq(schema.resumeCritiqueCritiquer.id, cookieCritiquerId),
				eq(schema.resumeCritiqueCritiquer.resumeId, resumeId),
			),
		);

	return critiquer?.id ?? null;
}

export const resumeCritiqueService = {
	setEnabled: async (input: { id: string; userId: string; critiqueEnabled: boolean }) => {
		if (input.critiqueEnabled) {
			const [resume] = await db
				.select({ isPublic: schema.resume.isPublic })
				.from(schema.resume)
				.where(and(eq(schema.resume.id, input.id), eq(schema.resume.userId, input.userId)));

			if (!resume) throw new ORPCError("NOT_FOUND");
			if (!resume.isPublic) {
				throw new ORPCError("BAD_REQUEST", { message: "Enable public access before turning on feedback mode." });
			}
		}

		const [resume] = await db
			.update(schema.resume)
			.set({ critiqueEnabled: input.critiqueEnabled })
			.where(and(eq(schema.resume.id, input.id), eq(schema.resume.userId, input.userId)))
			.returning({ critiqueEnabled: schema.resume.critiqueEnabled });

		if (!resume) throw new ORPCError("NOT_FOUND");
		return resume;
	},

	setPassword: async (input: { id: string; userId: string; password: string }) => {
		const critiquePassword = await hash(input.password, 10);

		const [resume] = await db
			.update(schema.resume)
			.set({ critiquePassword })
			.where(and(eq(schema.resume.id, input.id), eq(schema.resume.userId, input.userId)))
			.returning({ id: schema.resume.id });

		if (!resume) throw new ORPCError("NOT_FOUND");
	},

	verify: async (input: {
		username: string;
		slug: string;
		password: string;
		displayName?: string;
		requestHeaders: Headers;
		responseHeaders?: Headers;
	}) => {
		const resume = await getCritiqueEligibleResume(input.username, input.slug);

		const isValid = await compare(input.password, resume.critiquePassword);
		if (!isValid) throw new ORPCError("INVALID_PASSWORD", { status: 401 });

		const existingCritiquerId = readCritiquerIdFromCookie(input.requestHeaders, resume.id, resume.critiquePassword);

		let critiquer: { id: string; displayName: string } | undefined;

		if (existingCritiquerId) {
			[critiquer] = await db
				.update(schema.resumeCritiqueCritiquer)
				.set({ lastSeenAt: new Date() })
				.where(
					and(
						eq(schema.resumeCritiqueCritiquer.id, existingCritiquerId),
						eq(schema.resumeCritiqueCritiquer.resumeId, resume.id),
					),
				)
				.returning({ id: schema.resumeCritiqueCritiquer.id, displayName: schema.resumeCritiqueCritiquer.displayName });
		}

		if (!critiquer) {
			const displayName = input.displayName?.trim();
			if (!displayName) {
				throw new ORPCError("BAD_REQUEST", { message: "A display name is required to start critiquing this resume." });
			}

			[critiquer] = await db
				.insert(schema.resumeCritiqueCritiquer)
				.values({ id: generateId(), resumeId: resume.id, resumeOwnerUserId: resume.userId, displayName })
				.returning({ id: schema.resumeCritiqueCritiquer.id, displayName: schema.resumeCritiqueCritiquer.displayName });
		}

		if (!critiquer) throw new ORPCError("INTERNAL_SERVER_ERROR");

		if (input.responseHeaders) {
			grantCritiquerCookie(input.responseHeaders, resume.id, critiquer.id, resume.critiquePassword);
		}

		return { critiquerId: critiquer.id, displayName: critiquer.displayName };
	},

	getCritiqueView: async (input: { username: string; slug: string; requestHeaders: Headers }) => {
		const resume = await getCritiqueEligibleResume(input.username, input.slug);

		const critiquerId = await requireCritiquerId(input.requestHeaders, resume.id, resume.critiquePassword);
		if (!critiquerId) throw needCritiqueAccess(input.username, input.slug);

		const [critiquer, comments] = await Promise.all([
			db
				.select({ displayName: schema.resumeCritiqueCritiquer.displayName })
				.from(schema.resumeCritiqueCritiquer)
				.where(eq(schema.resumeCritiqueCritiquer.id, critiquerId))
				.then((rows) => rows[0]),
			db
				.select({
					id: schema.resumeCritiqueComment.id,
					resumeId: schema.resumeCritiqueComment.resumeId,
					pageNumber: schema.resumeCritiqueComment.pageNumber,
					xNormalized: schema.resumeCritiqueComment.xNormalized,
					yNormalized: schema.resumeCritiqueComment.yNormalized,
					body: schema.resumeCritiqueComment.body,
					status: schema.resumeCritiqueComment.status,
					createdAt: schema.resumeCritiqueComment.createdAt,
					updatedAt: schema.resumeCritiqueComment.updatedAt,
				})
				.from(schema.resumeCritiqueComment)
				.where(
					and(
						eq(schema.resumeCritiqueComment.resumeId, resume.id),
						eq(schema.resumeCritiqueComment.critiquerId, critiquerId),
					),
				)
				.orderBy(schema.resumeCritiqueComment.createdAt),
		]);

		if (!critiquer) throw needCritiqueAccess(input.username, input.slug);

		return {
			resumeId: resume.id,
			name: resume.name,
			data: resume.data,
			critiquerId,
			displayName: critiquer.displayName,
			comments,
		};
	},

	addComment: async (input: {
		username: string;
		slug: string;
		requestHeaders: Headers;
		pageNumber: number;
		xNormalized: number;
		yNormalized: number;
		body: string;
	}) => {
		const resume = await getCritiqueEligibleResume(input.username, input.slug);
		const critiquerId = await requireCritiquerId(input.requestHeaders, resume.id, resume.critiquePassword);
		if (!critiquerId) throw needCritiqueAccess(input.username, input.slug);

		const [comment] = await db
			.insert(schema.resumeCritiqueComment)
			.values({
				id: generateId(),
				resumeId: resume.id,
				critiquerId,
				resumeOwnerUserId: resume.userId,
				pageNumber: input.pageNumber,
				xNormalized: input.xNormalized,
				yNormalized: input.yNormalized,
				body: input.body,
			})
			.returning({
				id: schema.resumeCritiqueComment.id,
				resumeId: schema.resumeCritiqueComment.resumeId,
				pageNumber: schema.resumeCritiqueComment.pageNumber,
				xNormalized: schema.resumeCritiqueComment.xNormalized,
				yNormalized: schema.resumeCritiqueComment.yNormalized,
				body: schema.resumeCritiqueComment.body,
				status: schema.resumeCritiqueComment.status,
				createdAt: schema.resumeCritiqueComment.createdAt,
				updatedAt: schema.resumeCritiqueComment.updatedAt,
			});

		if (!comment) throw new ORPCError("INTERNAL_SERVER_ERROR");

		await db
			.update(schema.resumeCritiqueCritiquer)
			.set({ lastSeenAt: new Date() })
			.where(eq(schema.resumeCritiqueCritiquer.id, critiquerId));

		return comment;
	},

	updateOwnComment: async (input: {
		username: string;
		slug: string;
		requestHeaders: Headers;
		commentId: string;
		body: string;
	}) => {
		const resume = await getCritiqueEligibleResume(input.username, input.slug);
		const critiquerId = await requireCritiquerId(input.requestHeaders, resume.id, resume.critiquePassword);
		if (!critiquerId) throw needCritiqueAccess(input.username, input.slug);

		const [comment] = await db
			.update(schema.resumeCritiqueComment)
			.set({ body: input.body })
			.where(
				and(
					eq(schema.resumeCritiqueComment.id, input.commentId),
					eq(schema.resumeCritiqueComment.critiquerId, critiquerId),
					eq(schema.resumeCritiqueComment.status, "pending" satisfies CritiqueCommentStatus),
				),
			)
			.returning({
				id: schema.resumeCritiqueComment.id,
				resumeId: schema.resumeCritiqueComment.resumeId,
				pageNumber: schema.resumeCritiqueComment.pageNumber,
				xNormalized: schema.resumeCritiqueComment.xNormalized,
				yNormalized: schema.resumeCritiqueComment.yNormalized,
				body: schema.resumeCritiqueComment.body,
				status: schema.resumeCritiqueComment.status,
				createdAt: schema.resumeCritiqueComment.createdAt,
				updatedAt: schema.resumeCritiqueComment.updatedAt,
			});

		if (!comment) throw new ORPCError("NOT_FOUND");
		return comment;
	},

	deleteOwnComment: async (input: { username: string; slug: string; requestHeaders: Headers; commentId: string }) => {
		const resume = await getCritiqueEligibleResume(input.username, input.slug);
		const critiquerId = await requireCritiquerId(input.requestHeaders, resume.id, resume.critiquePassword);
		if (!critiquerId) throw needCritiqueAccess(input.username, input.slug);

		const [comment] = await db
			.delete(schema.resumeCritiqueComment)
			.where(
				and(
					eq(schema.resumeCritiqueComment.id, input.commentId),
					eq(schema.resumeCritiqueComment.critiquerId, critiquerId),
					eq(schema.resumeCritiqueComment.status, "pending" satisfies CritiqueCommentStatus),
				),
			)
			.returning({ id: schema.resumeCritiqueComment.id });

		if (!comment) throw new ORPCError("NOT_FOUND");
	},

	listAllComments: async (input: { resumeId: string; userId: string }) => {
		const rows = await db
			.select({
				id: schema.resumeCritiqueComment.id,
				resumeId: schema.resumeCritiqueComment.resumeId,
				critiquerId: schema.resumeCritiqueComment.critiquerId,
				pageNumber: schema.resumeCritiqueComment.pageNumber,
				xNormalized: schema.resumeCritiqueComment.xNormalized,
				yNormalized: schema.resumeCritiqueComment.yNormalized,
				body: schema.resumeCritiqueComment.body,
				status: schema.resumeCritiqueComment.status,
				createdAt: schema.resumeCritiqueComment.createdAt,
				updatedAt: schema.resumeCritiqueComment.updatedAt,
				critiquerDisplayName: schema.resumeCritiqueCritiquer.displayName,
			})
			.from(schema.resumeCritiqueComment)
			.innerJoin(
				schema.resumeCritiqueCritiquer,
				eq(schema.resumeCritiqueComment.critiquerId, schema.resumeCritiqueCritiquer.id),
			)
			.where(
				and(
					eq(schema.resumeCritiqueComment.resumeId, input.resumeId),
					eq(schema.resumeCritiqueComment.resumeOwnerUserId, input.userId),
				),
			)
			.orderBy(desc(schema.resumeCritiqueComment.createdAt));

		return rows;
	},

	updateCommentStatus: async (input: {
		resumeId: string;
		userId: string;
		commentId: string;
		status: CritiqueCommentStatus;
	}) => {
		const [comment] = await db
			.update(schema.resumeCritiqueComment)
			.set({ status: input.status })
			.where(
				and(
					eq(schema.resumeCritiqueComment.id, input.commentId),
					eq(schema.resumeCritiqueComment.resumeId, input.resumeId),
					eq(schema.resumeCritiqueComment.resumeOwnerUserId, input.userId),
				),
			)
			.returning({
				id: schema.resumeCritiqueComment.id,
				resumeId: schema.resumeCritiqueComment.resumeId,
				critiquerId: schema.resumeCritiqueComment.critiquerId,
				pageNumber: schema.resumeCritiqueComment.pageNumber,
				xNormalized: schema.resumeCritiqueComment.xNormalized,
				yNormalized: schema.resumeCritiqueComment.yNormalized,
				body: schema.resumeCritiqueComment.body,
				status: schema.resumeCritiqueComment.status,
				createdAt: schema.resumeCritiqueComment.createdAt,
				updatedAt: schema.resumeCritiqueComment.updatedAt,
			});

		if (!comment) throw new ORPCError("NOT_FOUND");
		return comment;
	},
};
