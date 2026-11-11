import { describe, expect, it } from "vite-plus/test";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "./schema";

/**
 * Deleting a parent row makes PostgreSQL look up each child table by its foreign key. Without an index that starts
 * with that column, every lookup reads the whole child table. A new foreign key needs such an index, or an entry
 * here as "table.column" with the reason it can go without.
 */
const UNINDEXED_ON_PURPOSE: Record<string, string> = {
	"ai_content_report.user_id": "Small operator-reviewed table; read only by the account export.",
	"resume_writing_review.user_id": "At most one row per resume; read only by the account export.",
	"career_schedule.ai_provider_id": "Capped at 100 schedules per account; providers are rarely deleted.",
	"oauth_client.user_id": "Small table; only an account deletion looks it up.",
	"oauth_consent.client_id": "No code path deletes an OAuth client.",
	"oauth_access_token.client_id": "No code path deletes an OAuth client.",
	"oauth_refresh_token.client_id": "No code path deletes an OAuth client.",
};

function leadingColumns(table: PgTable): Set<string> {
	const config = getTableConfig(table);
	const leading = new Set<string>();
	for (const column of config.columns) if (column.primary || column.isUnique) leading.add(column.name);
	for (const key of config.primaryKeys) {
		const first = key.columns[0];
		if (first) leading.add(first.name);
	}
	for (const unique of config.uniqueConstraints) {
		const first = unique.columns[0];
		if (first) leading.add(first.name);
	}
	for (const index of config.indexes) {
		// A partial index only holds the rows its predicate matches, so it cannot back the lookup.
		if (index.config.where) continue;
		const first = index.config.columns[0];
		if (first && "name" in first && typeof first.name === "string") leading.add(first.name);
	}
	return leading;
}

describe("foreign-key indexes", () => {
	it("gives every foreign key an index that starts with its column", () => {
		const missing: string[] = [];
		const listed = new Set<string>();
		for (const value of Object.values(schema)) {
			if (!is(value, PgTable)) continue;
			const config = getTableConfig(value);
			const leading = leadingColumns(value);
			for (const foreignKey of config.foreignKeys) {
				const column = foreignKey.reference().columns[0];
				if (!column) continue;
				const key = `${config.name}.${column.name}`;
				if (leading.has(column.name)) continue;
				if (key in UNINDEXED_ON_PURPOSE) listed.add(key);
				else missing.push(key);
			}
		}
		expect(missing.sort()).toEqual([]);
		// An exception that no longer applies must be removed, so the list stays true.
		expect(Object.keys(UNINDEXED_ON_PURPOSE).sort()).toEqual([...listed].sort());
	});
});
