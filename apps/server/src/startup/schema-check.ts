import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "@reactive-resume/db/schema";

interface SchemaQueryable {
	query(text: string, values?: unknown[]): Promise<{ rows: { table_name: string; column_name: string }[] }>;
}

export function collectExpectedColumns() {
	const expected: { tableName: string; columnName: string }[] = [];

	for (const value of Object.values(schema)) {
		if (!is(value, PgTable)) continue;
		const config = getTableConfig(value);
		for (const column of config.columns) expected.push({ tableName: config.name, columnName: column.name });
	}

	return expected;
}

// The migration ledger (drizzle.__drizzle_migrations) only records that a migration ran; it
// cannot detect objects that were dropped or lost outside the migrator (a partial restore,
// a manual DROP TABLE, or a recreated "public" schema while the "drizzle" schema survives).
// Comparing the live catalog with the declared schema turns that silent drift into a startup
// failure instead of runtime "relation does not exist" (42P01) errors.
export async function verifyMigratedSchema(queryable: SchemaQueryable): Promise<void> {
	const expected = collectExpectedColumns();
	if (expected.length === 0) return;

	const result = await queryable.query(
		`select e.table_name, e.column_name
			from unnest($1::text[], $2::text[]) as e(table_name, column_name)
			where to_regclass(e.table_name) is null
				or not exists (
					select 1 from pg_catalog.pg_attribute a
					where a.attrelid = to_regclass(e.table_name)
						and a.attname = e.column_name
						and a.attnum > 0 and not a.attisdropped
				)
			order by e.table_name, e.column_name`,
		[expected.map((e) => e.tableName), expected.map((e) => e.columnName)],
	);
	if (result.rows.length === 0) return;

	const expectedPerTable = new Map<string, number>();
	for (const e of expected) expectedPerTable.set(e.tableName, (expectedPerTable.get(e.tableName) ?? 0) + 1);

	const missingByTable = new Map<string, Set<string>>();
	for (const row of result.rows) {
		const columns = missingByTable.get(row.table_name) ?? new Set<string>();
		columns.add(row.column_name);
		missingByTable.set(row.table_name, columns);
	}

	const missing = [...missingByTable.entries()].map(([table, columns]) =>
		columns.size === expectedPerTable.get(table)
			? `table "${table}"`
			: `column(s) ${[...columns].map((column) => `"${table}"."${column}"`).join(", ")}`,
	);

	throw new Error(
		`Database schema does not match the migration ledger: ${missing.join(", ")} ` +
			"missing even though all migrations are marked as applied. This usually means the database was " +
			"restored from a backup that did not include these objects, or they were dropped outside of " +
			"migrations. Restore a consistent backup or recreate the missing objects, then restart the server.",
	);
}
