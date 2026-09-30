import type { ResumeData } from "@reactive-resume/schema/resume/data";
import * as pg from "drizzle-orm/pg-core";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { generateId } from "@reactive-resume/utils/string";
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
		// Separate feedback/comment-mode toggle and password, gated on isPublic (see resume-critique.ts
		// for the critiquer identity + comment tables this unlocks).
		critiqueEnabled: pg.boolean("critique_enabled").notNull().default(false),
		critiquePassword: pg.text("critique_password"),
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
		// Immutable snapshot of the resume data at a milestone (template change, import, AI edit, manual save).
		data: pg.jsonb("data").notNull().$type<ResumeData>(),
		label: pg.text("label").notNull(),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [pg.index().on(t.resumeId, t.createdAt.desc())],
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
