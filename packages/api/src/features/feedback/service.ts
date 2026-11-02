import type { FeedbackEventType } from "@reactive-resume/db/schema";
import type { ApplicationTimelineEntry } from "@reactive-resume/schema/applications/data";
import { ORPCError } from "@orpc/server";
import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { FEEDBACK_MAX_APPLICATIONS, FEEDBACK_MAX_COMMENTS } from "../../dto/feedback";
import { ownerIsNotBanned, redactResumeForViewer } from "../resume/access-policy";
import { parseStoredResumeData } from "../resume/resume-data-validation";
import { feedbackLinkIdFromToken, feedbackUrl } from "./token";

/** Most links an account can have open at once; revoked and expired ones don't count. */
export const FEEDBACK_MAX_ACTIVE_LINKS = 50;
const VIEW_EVENT_GAP_MS = 60 * 60 * 1000;

type LinkRow = typeof schema.feedbackLink.$inferSelect;

const statusOf = (
	link: Pick<LinkRow, "revokedAt" | "expiresAt">,
	now = Date.now(),
): "active" | "expired" | "revoked" =>
	link.revokedAt ? "revoked" : link.expiresAt && link.expiresAt.getTime() <= now ? "expired" : "active";

const isActive = sql`${schema.feedbackLink.revokedAt} is null and (${schema.feedbackLink.expiresAt} is null or ${schema.feedbackLink.expiresAt} > now())`;

async function commentCounts(linkIds: string[]) {
	if (linkIds.length === 0) return new Map<string, { all: number; open: number }>();
	const rows = await db
		.select({
			linkId: schema.feedbackComment.linkId,
			all: count(),
			open: sql<number>`count(*) filter (where ${schema.feedbackComment.resolvedAt} is null)`.mapWith(Number),
		})
		.from(schema.feedbackComment)
		.where(inArray(schema.feedbackComment.linkId, linkIds))
		.groupBy(schema.feedbackComment.linkId);
	return new Map(rows.map((row) => [row.linkId, { all: row.all, open: row.open }]));
}

const toSummary = (link: LinkRow, counts: { all: number; open: number } | undefined) => ({
	id: link.id,
	resumeId: link.resumeId,
	resumeName: link.resumeName,
	label: link.label,
	url: feedbackUrl(link.id),
	status: statusOf(link),
	allowComments: link.allowComments,
	applicationIds: link.applicationIds,
	expiresAt: link.expiresAt,
	revokedAt: link.revokedAt,
	lastViewedAt: link.lastViewedAt,
	createdAt: link.createdAt,
	commentCount: counts?.all ?? 0,
	openCommentCount: counts?.open ?? 0,
});

const record = (link: Pick<LinkRow, "id" | "userId">, type: FeedbackEventType) =>
	db.insert(schema.feedbackEvent).values({ linkId: link.id, userId: link.userId, type });

async function ownedLink(id: string, userId: string) {
	const [link] = await db
		.select()
		.from(schema.feedbackLink)
		.where(and(eq(schema.feedbackLink.id, id), eq(schema.feedbackLink.userId, userId)));
	if (!link) throw new ORPCError("NOT_FOUND");
	return link;
}

/** The link a token opens, with its owner's name, or why it doesn't open. Unknown and forged tokens read as missing. */
async function linkForToken(token: string) {
	const id = feedbackLinkIdFromToken(token);
	if (!id) throw new ORPCError("NOT_FOUND");
	const [row] = await db
		.select({ link: schema.feedbackLink, ownerName: schema.user.name })
		.from(schema.feedbackLink)
		.innerJoin(schema.user, eq(schema.user.id, schema.feedbackLink.userId))
		.innerJoin(schema.resume, eq(schema.resume.id, schema.feedbackLink.resumeId))
		// A resume in Trash, or a banned owner, shares nothing, as on the public page.
		.where(and(eq(schema.feedbackLink.id, id), isNull(schema.resume.trashedAt), ownerIsNotBanned()));
	if (!row) throw new ORPCError("NOT_FOUND");
	const status = statusOf(row.link);
	if (status !== "active")
		throw new ORPCError("NOT_FOUND", {
			message: status === "revoked" ? "This feedback link was turned off." : "This feedback link has expired.",
			data: { reason: status },
		});
	return row;
}

/** The chosen applications' stages and dates, live. Deleted ones drop out; notes, contacts and pay never leave. */
async function sharedApplications(link: LinkRow) {
	if (link.applicationIds.length === 0) return [];
	const applications = await db
		.select({
			id: schema.application.id,
			company: schema.application.company,
			role: schema.application.role,
			status: schema.application.status,
			laneId: schema.application.laneId,
			closedReason: schema.application.closedReason,
			appliedAt: schema.application.appliedAt,
			activity: schema.application.activity,
		})
		.from(schema.application)
		.where(and(eq(schema.application.userId, link.userId), inArray(schema.application.id, link.applicationIds)));
	const lanes = await db
		.select({ id: schema.applicationLane.id, label: schema.applicationLane.label })
		.from(schema.applicationLane)
		.where(eq(schema.applicationLane.userId, link.userId));
	const laneLabel = new Map(lanes.map((lane) => [lane.id, lane.label ?? null]));
	const order = new Map(link.applicationIds.map((id, index) => [id, index]));
	return applications
		.toSorted((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
		.map((application) => ({
			company: application.company,
			role: application.role,
			status: application.status,
			stageLabel: application.laneId ? (laneLabel.get(application.laneId) ?? null) : null,
			closedReason: application.status === "closed" ? application.closedReason : null,
			appliedAt: application.status === "saved" ? null : application.appliedAt,
			stages: application.activity
				.filter((entry): entry is Extract<ApplicationTimelineEntry, { type: "stage" }> => entry.type === "stage")
				.toSorted((a, b) => a.at.getTime() - b.at.getTime())
				.map((entry) => ({
					status: entry.stage,
					stageLabel: entry.laneLabel ?? (entry.laneId ? (laneLabel.get(entry.laneId) ?? null) : null),
					at: entry.at,
					dateUnknown: entry.dateUnknown ?? false,
				})),
		}));
}

export const feedbackService = {
	list: async (input: { userId: string; resumeId?: string | undefined }) => {
		const links = await db
			.select()
			.from(schema.feedbackLink)
			.where(
				and(
					eq(schema.feedbackLink.userId, input.userId),
					input.resumeId ? eq(schema.feedbackLink.resumeId, input.resumeId) : undefined,
				),
			)
			.orderBy(desc(schema.feedbackLink.createdAt))
			.limit(200);
		const counts = await commentCounts(links.map((link) => link.id));
		return links.map((link) => toSummary(link, counts.get(link.id)));
	},

	create: async (input: {
		userId: string;
		resumeId: string;
		label: string;
		allowComments: boolean;
		applicationIds: string[];
		expiresAt: Date | null;
	}) => {
		if (input.expiresAt && input.expiresAt.getTime() <= Date.now())
			throw new ORPCError("BAD_REQUEST", { message: "Choose an expiry in the future." });
		const [resume] = await db
			.select({ name: schema.resume.name, data: schema.resume.data })
			.from(schema.resume)
			.where(
				and(
					eq(schema.resume.id, input.resumeId),
					eq(schema.resume.userId, input.userId),
					isNull(schema.resume.trashedAt),
				),
			);
		if (!resume) throw new ORPCError("NOT_FOUND");
		const applicationIds = [...new Set(input.applicationIds)].slice(0, FEEDBACK_MAX_APPLICATIONS);
		if (applicationIds.length > 0) {
			const owned = await db
				.select({ id: schema.application.id })
				.from(schema.application)
				.where(and(eq(schema.application.userId, input.userId), inArray(schema.application.id, applicationIds)));
			if (owned.length !== applicationIds.length)
				throw new ORPCError("BAD_REQUEST", { message: "One of the chosen applications wasn't found." });
		}
		const [{ active } = { active: 0 }] = await db
			.select({ active: count() })
			.from(schema.feedbackLink)
			.where(and(eq(schema.feedbackLink.userId, input.userId), isActive));
		if (active >= FEEDBACK_MAX_ACTIVE_LINKS)
			throw new ORPCError("BAD_REQUEST", {
				message: `You can have up to ${FEEDBACK_MAX_ACTIVE_LINKS} feedback links open. Revoke one you no longer need.`,
			});
		// The reviewer reads the resume as the owner wrote it, without private notes, hidden items or check results.
		const snapshot = redactResumeForViewer(
			{ name: resume.name, data: parseStoredResumeData(resume.data), hideContactDetails: false },
			false,
		).data;
		const [link] = await db
			.insert(schema.feedbackLink)
			.values({
				userId: input.userId,
				resumeId: input.resumeId,
				label: input.label,
				snapshot,
				resumeName: resume.name,
				allowComments: input.allowComments,
				applicationIds,
				expiresAt: input.expiresAt,
			})
			.returning();
		if (!link) throw new ORPCError("INTERNAL_SERVER_ERROR");
		await record(link, "created");
		return toSummary(link, undefined);
	},

	get: async (input: { id: string; userId: string }) => {
		const link = await ownedLink(input.id, input.userId);
		const comments = await db
			.select({
				id: schema.feedbackComment.id,
				linkId: schema.feedbackComment.linkId,
				authorName: schema.feedbackComment.authorName,
				body: schema.feedbackComment.body,
				resolvedAt: schema.feedbackComment.resolvedAt,
				createdAt: schema.feedbackComment.createdAt,
			})
			.from(schema.feedbackComment)
			.where(eq(schema.feedbackComment.linkId, link.id))
			.orderBy(asc(schema.feedbackComment.createdAt));
		const events = await db
			.select({
				id: schema.feedbackEvent.id,
				type: schema.feedbackEvent.type,
				createdAt: schema.feedbackEvent.createdAt,
			})
			.from(schema.feedbackEvent)
			.where(eq(schema.feedbackEvent.linkId, link.id))
			.orderBy(desc(schema.feedbackEvent.createdAt))
			.limit(200);
		const open = comments.filter((comment) => !comment.resolvedAt).length;
		return { ...toSummary(link, { all: comments.length, open }), comments, events };
	},

	revoke: async (input: { id: string; userId: string }) => {
		const link = await ownedLink(input.id, input.userId);
		if (link.revokedAt) return toSummary(link, (await commentCounts([link.id])).get(link.id));
		const [revoked] = await db
			.update(schema.feedbackLink)
			.set({ revokedAt: new Date() })
			.where(and(eq(schema.feedbackLink.id, link.id), isNull(schema.feedbackLink.revokedAt)))
			.returning();
		const result = revoked ?? (await ownedLink(input.id, input.userId));
		if (revoked) await record(revoked, "revoked");
		return toSummary(result, (await commentCounts([result.id])).get(result.id));
	},

	resolveComment: async (input: { id: string; commentId: string; resolved: boolean; userId: string }) => {
		const [comment] = await db
			.update(schema.feedbackComment)
			.set({ resolvedAt: input.resolved ? new Date() : null })
			.where(
				and(
					eq(schema.feedbackComment.id, input.commentId),
					eq(schema.feedbackComment.linkId, input.id),
					eq(schema.feedbackComment.userId, input.userId),
				),
			)
			.returning({
				id: schema.feedbackComment.id,
				linkId: schema.feedbackComment.linkId,
				authorName: schema.feedbackComment.authorName,
				body: schema.feedbackComment.body,
				resolvedAt: schema.feedbackComment.resolvedAt,
				createdAt: schema.feedbackComment.createdAt,
			});
		if (!comment) throw new ORPCError("NOT_FOUND");
		return comment;
	},

	view: async (input: { token: string; viewerId?: string | undefined }) => {
		const { link, ownerName } = await linkForToken(input.token);
		// The owner checking their own link isn't a view.
		if (input.viewerId !== link.userId) {
			const now = new Date();
			const [updated] = await db
				.update(schema.feedbackLink)
				.set({ lastViewedAt: now })
				.where(eq(schema.feedbackLink.id, link.id))
				.returning({ id: schema.feedbackLink.id });
			if (updated && (!link.lastViewedAt || now.getTime() - link.lastViewedAt.getTime() >= VIEW_EVENT_GAP_MS))
				await record(link, "viewed");
		}
		const comments = await db
			.select({
				id: schema.feedbackComment.id,
				linkId: schema.feedbackComment.linkId,
				authorName: schema.feedbackComment.authorName,
				body: schema.feedbackComment.body,
				createdAt: schema.feedbackComment.createdAt,
			})
			.from(schema.feedbackComment)
			.where(eq(schema.feedbackComment.linkId, link.id))
			.orderBy(asc(schema.feedbackComment.createdAt));
		return {
			resumeName: link.resumeName,
			ownerName,
			sharedAt: link.createdAt,
			data: parseStoredResumeData(link.snapshot),
			allowComments: link.allowComments,
			expiresAt: link.expiresAt,
			applications: await sharedApplications(link),
			comments,
		};
	},

	comment: async (input: { token: string; authorName: string; body: string }) => {
		const { link } = await linkForToken(input.token);
		if (!link.allowComments)
			throw new ORPCError("FORBIDDEN", { message: "This feedback link is read-only.", data: { reason: "read-only" } });
		const [{ total } = { total: 0 }] = await db
			.select({ total: count() })
			.from(schema.feedbackComment)
			.where(eq(schema.feedbackComment.linkId, link.id));
		if (total >= FEEDBACK_MAX_COMMENTS)
			throw new ORPCError("BAD_REQUEST", { message: "This link has reached its comment limit." });
		const [comment] = await db
			.insert(schema.feedbackComment)
			.values({ linkId: link.id, userId: link.userId, authorName: input.authorName, body: input.body })
			.returning({
				id: schema.feedbackComment.id,
				linkId: schema.feedbackComment.linkId,
				authorName: schema.feedbackComment.authorName,
				body: schema.feedbackComment.body,
				createdAt: schema.feedbackComment.createdAt,
			});
		if (!comment) throw new ORPCError("INTERNAL_SERVER_ERROR");
		await record(link, "commented");
		return comment;
	},

	/** Everything the account's feedback links hold, for the data export. */
	exportData: async (userId: string) => ({
		links: (await db.select().from(schema.feedbackLink).where(eq(schema.feedbackLink.userId, userId))).map(
			({ userId: _userId, ...link }) => link,
		),
		comments: (await db.select().from(schema.feedbackComment).where(eq(schema.feedbackComment.userId, userId))).map(
			({ userId: _userId, ...comment }) => comment,
		),
		events: (await db.select().from(schema.feedbackEvent).where(eq(schema.feedbackEvent.userId, userId))).map(
			({ userId: _userId, ...event }) => event,
		),
	}),
};
