import * as pg from "drizzle-orm/pg-core";
import { user } from "./auth";

export const firecrawlCredential = pg.pgTable("firecrawl_credentials", {
	userId: pg
		.text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
	encryptedApiKey: pg.text("encrypted_api_key").notNull(),
});
