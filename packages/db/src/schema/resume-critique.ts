import type { CritiqueCommentStatus } from "@reactive-resume/schema/resume/critique";
import * as pg from "drizzle-orm/pg-core";
import { generateId } from "@reactive-resume/utils/string";
import { user } from "./auth";
import { resume } from "./resume";

// One row per anonymous person who has opened a resume's critique link. Identity is a
// display name they enter once; a signed cookie (see critique-access.ts in the API package)
// recognizes them on return visits so their comments stay theirs across sessions.
export const resumeCritiqueCritiquer = pg.pgTable(
	"resume_critique_critiquer",
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
		// Denormalized for fast owner-scoped queries, same rationale as resumeVersion.userId.
		resumeOwnerUserId: pg
			.text("resume_owner_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		displayName: pg.text("display_name").notNull(),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		lastSeenAt: pg.timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [pg.index().on(t.resumeId, t.createdAt.desc())],
);

// A single inline comment pinned to an exact point on the rendered resume PDF.
export const resumeCritiqueComment = pg.pgTable(
	"resume_critique_comment",
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
		critiquerId: pg
			.text("critiquer_id")
			.notNull()
			.references(() => resumeCritiqueCritiquer.id, { onDelete: "cascade" }),
		// Denormalized (immutable) for owner-scoped queries without a join.
		resumeOwnerUserId: pg
			.text("resume_owner_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		pageNumber: pg.integer("page_number").notNull(),
		// Relative to the rendered page (0..1), not raw pixels — the PDF.js viewer renders at a
		// "page-width" scale that varies with viewport, so pins must be resolution-independent.
		xNormalized: pg.doublePrecision("x_normalized").notNull(),
		yNormalized: pg.doublePrecision("y_normalized").notNull(),
		body: pg.text("body").notNull(),
		// Fixed status enum (see critiqueCommentStatusSchema); stored as text per repo convention.
		status: pg.text("status").$type<CritiqueCommentStatus>().notNull().default("pending"),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: pg
			.timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date()),
	},
	(t) => [
		// Owner "all comments grouped by critiquer" view.
		pg.index().on(t.resumeId, t.critiquerId, t.createdAt.asc()),
		// Owner "pending review queue" view.
		pg.index().on(t.resumeId, t.status),
	],
);
