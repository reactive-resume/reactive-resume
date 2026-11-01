import * as pg from "drizzle-orm/pg-core";
import { user } from "./auth";

/**
 * The request behind a resume or application saved under an ID the client chose (`newId`), written in the same
 * transaction as the row. A retry with that ID is only a retry when it is the same request: the same ID sent with
 * anything else is refused, so a reused ID never returns, links or changes a row it didn't make.
 */
export const createRequest = pg.pgTable(
	"create_request",
	{
		/** The client-chosen ID, which is also the ID of the row it created. */
		id: pg.text("id").primaryKey(),
		userId: pg
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		/** SHA-256 of what the request asked for, not of what the row later becomes, so later edits don't matter. */
		fingerprint: pg.text("fingerprint").notNull(),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [pg.index().on(t.userId)],
);
