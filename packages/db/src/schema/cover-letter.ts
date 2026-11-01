import type { CoverLetterLayout, CoverLetterStyle } from "@reactive-resume/schema/cover-letter/data";
import { sql } from "drizzle-orm";
import * as pg from "drizzle-orm/pg-core";
import { generateId } from "@reactive-resume/utils/string";
import { application } from "./applications";
import { user } from "./auth";
import { resume } from "./resume";

export const coverLetter = pg.pgTable(
	"cover_letter",
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
		name: pg.text("name").notNull(),
		recipient: pg.text("recipient").notNull().default(""),
		content: pg.text("content").notNull().default(""),
		greeting: pg.text("greeting"),
		signOff: pg.text("sign_off"),
		style: pg.jsonb("style").$type<CoverLetterStyle>().notNull(),
		// Structured letters compose recipient, greeting and sign-off from these; older letters stay freeform.
		layout: pg.text("layout").$type<CoverLetterLayout>().notNull().default("freeform"),
		recipientName: pg.text("recipient_name").notNull().default(""),
		recipientCompany: pg.text("recipient_company").notNull().default(""),
		letterDate: pg.text("letter_date"),
		// Live links to the source resume: its sender details and its design, instead of the copies in `style`.
		senderLinked: pg.boolean("sender_linked").notNull().default(false),
		designLinked: pg.boolean("design_linked").notNull().default(false),
		sourceResumeId: pg.text("source_resume_id").references(() => resume.id, { onDelete: "set null" }),
		sourceApplicationId: pg.text("source_application_id").references(() => application.id, { onDelete: "set null" }),
		tags: pg.text("tags").array().notNull().default([]),
		isLocked: pg.boolean("is_locked").notNull().default(false),
		// In Trash since this moment; purged after 30 days.
		trashedAt: pg.timestamp("trashed_at", { withTimezone: true }),
		revision: pg.integer("revision").notNull().default(1),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: pg
			.timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		// When the letter's text, recipient or design last changed, for "Last edited"; existing letters were backfilled
		// from `updated_at`. A trigger in the migration keeps it. Renames, tags, locks, application links and Trash move
		// only `updated_at` and `revision`.
		editedAt: pg.timestamp("edited_at", { withTimezone: true }).defaultNow(),
	},
	(table) => [
		pg.index().on(table.userId, table.updatedAt.desc(), table.id.desc()),
		// Finds letters past Trash retention without scanning every letter.
		pg
			.index()
			.on(table.trashedAt)
			.where(sql`${table.trashedAt} is not null`),
	],
);

export const COVER_LETTER_VERSION_KINDS = ["created", "auto", "named", "before-restore", "restored", "sent"] as const;

export type CoverLetterVersionKind = (typeof COVER_LETTER_VERSION_KINDS)[number];

/** What a letter version keeps: everything that makes the letter read the way it did. */
export type CoverLetterVersionData = {
	name: string;
	recipient: string;
	content: string;
	greeting?: string | null;
	signOff?: string | null;
	style: CoverLetterStyle;
	layout: CoverLetterLayout;
	recipientName: string;
	recipientCompany: string;
	letterDate: string | null;
};

export const coverLetterVersion = pg.pgTable(
	"cover_letter_version",
	{
		id: pg
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		coverLetterId: pg
			.text("cover_letter_id")
			.notNull()
			.references(() => coverLetter.id, { onDelete: "cascade" }),
		userId: pg
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		data: pg.jsonb("data").notNull().$type<CoverLetterVersionData>(),
		kind: pg.text("kind", { enum: COVER_LETTER_VERSION_KINDS }).notNull().default("auto"),
		// The user's name for a `named` version, or the company a `sent` one went to.
		name: pg.text("name"),
		// The editing session an `auto` version belongs to (one row per session).
		sessionId: pg.text("session_id"),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		pg.index().on(t.coverLetterId, t.createdAt.desc()),
		pg
			.uniqueIndex("cover_letter_version_session_unique")
			.on(t.coverLetterId, t.sessionId)
			.where(sql`${t.kind} = 'auto'`),
	],
);
