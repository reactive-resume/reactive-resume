import type { SQLWrapper } from "drizzle-orm";
import { and, eq, isNull, sql } from "drizzle-orm";
import { application } from "@reactive-resume/db/schema";

/** Normal workflows exclude Trash; lifecycle controls and full account exports read retained rows explicitly. */
export const activeApplications = (userId: string) =>
	and(eq(application.userId, userId), isNull(application.trashedAt));

/** Shared records stay available; application-scoped records follow their application's lifetime. */
export const availableApplicationContext = (userId: string, applicationId: SQLWrapper) =>
	sql`(${applicationId} is null or exists (select 1 from "application" active_context
		where active_context.id = ${applicationId} and active_context.user_id = ${userId} and active_context.trashed_at is null))`;
