import type { ResumeData } from "@reactive-resume/schema/resume/data";
import * as pg from "drizzle-orm/pg-core";
import { generateId } from "@reactive-resume/utils/string";
import { user } from "./auth";
import { resume } from "./resume";

/**
 * A link the owner sends someone (a coach, a friend, a careers office) so they can read one resume, as it was when the
 * link was made, and optionally leave comments and follow chosen applications' progress. Nothing else in the account
 * is reachable through it. The link's secret isn't stored: it is signed from the ID, so the owner can copy it again.
 */
export const feedbackLink = pg.pgTable(
	"feedback_link",
	{
		id: pg
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		userId: pg
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		resumeId: pg
			.text("resume_id")
			.notNull()
			.references(() => resume.id, { onDelete: "cascade" }),
		/** Who the link is for, in the owner's words. Shown to the owner only. */
		label: pg.text("label").notNull(),
		/** The resume as it was when the link was made: comments are always about this version. */
		snapshot: pg.jsonb("snapshot").notNull().$type<ResumeData>(),
		/** The resume's name when the link was made. */
		resumeName: pg.text("resume_name").notNull(),
		allowComments: pg.boolean("allow_comments").notNull().default(true),
		/** Applications whose stage and dates the reviewer can follow. Nothing else about them is shared. */
		applicationIds: pg.text("application_ids").array().notNull().default([]),
		expiresAt: pg.timestamp("expires_at", { withTimezone: true }),
		revokedAt: pg.timestamp("revoked_at", { withTimezone: true }),
		lastViewedAt: pg.timestamp("last_viewed_at", { withTimezone: true }),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [pg.index().on(t.userId, t.createdAt.desc()), pg.index().on(t.resumeId)],
);

/** A reviewer's comment through a feedback link. It never changes the owner's documents. */
export const feedbackComment = pg.pgTable(
	"feedback_comment",
	{
		id: pg
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		linkId: pg
			.text("link_id")
			.notNull()
			.references(() => feedbackLink.id, { onDelete: "cascade" }),
		userId: pg
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		/** The name the reviewer gave. Not verified. */
		authorName: pg.text("author_name").notNull(),
		body: pg.text("body").notNull(),
		/** When the owner marked it done. */
		resolvedAt: pg.timestamp("resolved_at", { withTimezone: true }),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [pg.index().on(t.linkId, t.createdAt), pg.index().on(t.userId)],
);

export const FEEDBACK_EVENT_TYPES = ["created", "viewed", "commented", "revoked"] as const;
export type FeedbackEventType = (typeof FEEDBACK_EVENT_TYPES)[number];

/** What happened through a feedback link, for the owner's activity history. Views are kept at most once an hour. */
export const feedbackEvent = pg.pgTable(
	"feedback_event",
	{
		id: pg
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		linkId: pg
			.text("link_id")
			.notNull()
			.references(() => feedbackLink.id, { onDelete: "cascade" }),
		userId: pg
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		type: pg.text("type", { enum: FEEDBACK_EVENT_TYPES }).notNull(),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		pg.index().on(t.linkId, t.createdAt.desc()),
		// Looked up when the row it points to is deleted.
		pg.index().on(t.userId),
	],
);
