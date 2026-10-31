import { sql } from "drizzle-orm";
import * as pg from "drizzle-orm/pg-core";
import { generateId } from "@reactive-resume/utils/string";

export const STORAGE_CLEANUP_STATUSES = ["pending", "abandoned"] as const;
export type StorageCleanupStatus = (typeof STORAGE_CLEANUP_STATUSES)[number];

/**
 * Durable work left after a document or account is deleted. Work is written in the same transaction as the row delete,
 * then removed only after the storage prefix is verified empty. There is deliberately no user foreign key: deleting an
 * account must not cascade away the erasure targets that account still needs. `claimToken` fences late acknowledgments
 * from a worker whose lease expired.
 */
export const storageCleanupJob = pg.pgTable(
	"storage_cleanup_job",
	{
		id: pg
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		ownerId: pg.text("owner_id").notNull(),
		storageKey: pg.text("storage_key").notNull(),
		status: pg.text("status").$type<StorageCleanupStatus>().notNull().default("pending"),
		attempts: pg.integer("attempts").notNull().default(0),
		claimToken: pg.text("claim_token"),
		nextAttemptAt: pg.timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
		lastError: pg.text("last_error"),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: pg
			.timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date()),
	},
	(t) => [
		pg.unique("storage_cleanup_job_owner_key_unique").on(t.ownerId, t.storageKey),
		pg
			.index("storage_cleanup_job_due_index")
			.on(t.status, t.nextAttemptAt)
			.where(sql`${t.status} = 'pending'`),
	],
);
