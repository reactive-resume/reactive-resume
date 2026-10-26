import { sql } from "drizzle-orm";
import * as pg from "drizzle-orm/pg-core";
import { user } from "./auth";

/**
 * One custom domain per account, opening its primary resume once DNS proves the account owns it. Several accounts may
 * claim a host; only the one whose token DNS publishes gets verified, and a later proof moves it.
 */
export const customDomain = pg.pgTable(
	"custom_domain",
	{
		userId: pg
			.text("user_id")
			.primaryKey()
			.references(() => user.id, { onDelete: "cascade" }),
		// Lowercase ASCII (punycode), without a trailing dot.
		hostname: pg.text("hostname").notNull(),
		// The value the account publishes in a TXT record at `_rx-verify.<hostname>`.
		verificationToken: pg.text("verification_token").notNull(),
		verifiedAt: pg.timestamp("verified_at", { withTimezone: true }),
		lastCheckedAt: pg.timestamp("last_checked_at", { withTimezone: true }),
		// Since when DNS has stopped pointing here; a domain failing for a week loses its verification.
		failingSince: pg.timestamp("failing_since", { withTimezone: true }),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		pg
			.uniqueIndex("custom_domain_verified_hostname")
			.on(t.hostname)
			.where(sql`${t.verifiedAt} is not null`),
	],
);
