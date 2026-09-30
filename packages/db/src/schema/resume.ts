import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import * as pg from "drizzle-orm/pg-core";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { generateId } from "@reactive-resume/utils/string";
import { application } from "./applications";
import { user } from "./auth";

export const resume = pg.pgTable(
	"resume",
	{
		id: pg
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		name: pg.text("name").notNull(),
		slug: pg.text("slug").notNull(),
		tags: pg.text("tags").array().notNull().default([]),
		isPublic: pg.boolean("is_public").notNull().default(false),
		showDownloadButtons: pg.boolean("show_download_buttons").notNull().default(true),
		isLocked: pg.boolean("is_locked").notNull().default(false),
		password: pg.text("password"),
		// "Made for this application": Check's job match, the assistant and Copy for a job use its posting.
		// Separate from application.resume_id, the resume linked to (or sent with) an application.
		applicationId: pg.text("application_id").references((): AnyPgColumn => application.id, { onDelete: "set null" }),
		// In Trash since this moment; purged after 30 days. Trashed resumes are hidden and not shared.
		trashedAt: pg.timestamp("trashed_at", { withTimezone: true }),
		// A blank resume's name follows its headline until the user renames it.
		autoName: pg.boolean("auto_name").notNull().default(false),
		data: pg
			.jsonb("data")
			.notNull()
			.$type<ResumeData>()
			.$defaultFn(() => defaultResumeData),
		userId: pg
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: pg
			.timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date()),
	},
	(t) => [
		pg.unique().on(t.slug, t.userId),
		pg.index().on(t.createdAt.asc()),
		pg.index().on(t.userId, t.updatedAt.desc()),
		pg.index().on(t.isPublic, t.slug, t.userId),
	],
);

/**
 * What made a version: created or imported (the first entry), an editing session's autosave, a version the
 * user named, the state saved before a restore, the restore itself, an AI edit, or a sent application.
 */
export const RESUME_VERSION_KINDS = [
	"created",
	"import",
	"auto",
	"named",
	"before-restore",
	"restored",
	"ai",
	"sent",
] as const;

export type ResumeVersionKind = (typeof RESUME_VERSION_KINDS)[number];

export const resumeVersion = pg.pgTable(
	"resume_version",
	{
		id: pg
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		resumeId: pg
			.text("resume_id")
			.notNull()
			.references(() => resume.id, { onDelete: "cascade" }),
		userId: pg
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		// Snapshot of the resume data. A session's autosave is refreshed while the session lasts; the rest are immutable.
		data: pg.jsonb("data").notNull().$type<ResumeData>(),
		kind: pg.text("kind", { enum: RESUME_VERSION_KINDS }).notNull().default("auto"),
		// The user's name for a `named` version.
		name: pg.text("name"),
		// The editing session an `auto` version belongs to (one row per session).
		sessionId: pg.text("session_id"),
		// When this state was saved (a session's autosave moves forward as the session goes on).
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		pg.index().on(t.resumeId, t.createdAt.desc()),
		pg
			.uniqueIndex("resume_version_session_unique")
			.on(t.resumeId, t.sessionId)
			.where(sql`${t.kind} = 'auto'`),
	],
);

/** A resume's previous public address, kept for 30 days after a rename so shared links keep working. */
export const resumeSlugRedirect = pg.pgTable(
	"resume_slug_redirect",
	{
		id: pg
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		slug: pg.text("slug").notNull(),
		resumeId: pg
			.text("resume_id")
			.notNull()
			.references(() => resume.id, { onDelete: "cascade" }),
		userId: pg
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		expiresAt: pg.timestamp("expires_at", { withTimezone: true }).notNull(),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [pg.unique().on(t.userId, t.slug), pg.index().on(t.resumeId)],
);

export const resumeStatistics = pg.pgTable("resume_statistics", {
	id: pg
		.text("id")
		.notNull()
		.primaryKey()
		.$defaultFn(() => generateId()),
	views: pg.integer("views").notNull().default(0),
	downloads: pg.integer("downloads").notNull().default(0),
	lastViewedAt: pg.timestamp("last_viewed_at", { withTimezone: true }),
	lastDownloadedAt: pg.timestamp("last_downloaded_at", { withTimezone: true }),
	resumeId: pg
		.text("resume_id")
		.unique()
		.notNull()
		.references(() => resume.id, { onDelete: "cascade" }),
	createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: pg
		.timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow()
		.$onUpdate(() => /* @__PURE__ */ new Date()),
});

export const resumeStatisticsDaily = pg.pgTable(
	"resume_statistics_daily",
	{
		id: pg
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		date: pg.date("date", { mode: "string" }).notNull(),
		views: pg.integer("views").notNull().default(0),
		downloads: pg.integer("downloads").notNull().default(0),
		resumeId: pg
			.text("resume_id")
			.notNull()
			.references(() => resume.id, { onDelete: "cascade" }),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: pg
			.timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date()),
	},
	(t) => [pg.unique().on(t.resumeId, t.date), pg.index().on(t.resumeId, t.date.desc())],
);
