import type { AiAction } from "@reactive-resume/schema/ai-usage";
import * as pg from "drizzle-orm/pg-core";
import { generateId } from "@reactive-resume/utils/string";
import { user } from "./auth";

/** Inference transport attempts, including failures; never prompts, credentials, tokens or billing estimates. */
export const aiRequest = pg.pgTable(
	"ai_request",
	{
		id: pg.text("id").primaryKey().$defaultFn(generateId),
		userId: pg
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		operationId: pg.text("operation_id").notNull(),
		action: pg.text("action").$type<AiAction>().notNull(),
		// Connection snapshots survive removal or edits of a saved provider.
		providerId: pg.text("provider_id").notNull(),
		label: pg.text("label").notNull(),
		provider: pg.text("provider").notNull(),
		model: pg.text("model").notNull(),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [pg.index().on(t.userId, t.createdAt), pg.index().on(t.userId, t.operationId)],
);
