import * as pg from "drizzle-orm/pg-core";
import { user } from "./auth";

/** One selected web connection; Firecrawl's old table is retained only for rollback. */
export const webAccessCredential = pg.pgTable("web_access_credentials", {
	userId: pg
		.text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
	provider: pg.text("provider", { enum: ["firecrawl", "tavily", "exa"] }).notNull(),
	encryptedApiKey: pg.text("encrypted_api_key").notNull(),
});
