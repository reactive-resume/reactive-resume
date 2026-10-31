import type { ApplicationProfileData } from "@reactive-resume/schema/application-profile";
import * as pg from "drizzle-orm/pg-core";
import { user } from "./auth";

/** Kept outside Career knowledge, resume data and submitted snapshots. */
export const applicationProfile = pg.pgTable("application_profile", {
	userId: pg
		.text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
	data: pg.jsonb("data").notNull().$type<ApplicationProfileData>(),
	reviewedAt: pg.timestamp("reviewed_at", { withTimezone: true }).notNull(),
	revision: pg.text("revision").notNull(),
});
