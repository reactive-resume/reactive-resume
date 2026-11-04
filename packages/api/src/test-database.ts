import type { Pool } from "pg";

const statements = new WeakMap<Pool, Map<string, string>>();

/**
 * Empties the tables like `TRUNCATE <tables> CASCADE`, for suites that reset before every test. TRUNCATE replaces the
 * files of each of the ~50 tables that reference a user, about 200 ms per test; deleting a test's few rows takes a
 * few milliseconds. Like TRUNCATE it fires no triggers and checks no foreign keys, which needs a superuser, as the
 * local and CI test databases have. SET LOCAL ends with the transaction, so no pooled connection keeps it.
 */
export async function truncateCascade(pool: Pool, tables: string[]) {
	const cache = statements.get(pool) ?? new Map<string, string>();
	statements.set(pool, cache);
	const key = tables.join();
	let statement = cache.get(key);
	if (!statement) {
		const { rows } = await pool.query<{ name: string }>(
			`WITH RECURSIVE closure(oid) AS (
				SELECT unnest($1::regclass[])::oid
				UNION SELECT constraints.conrelid FROM pg_constraint constraints
				JOIN closure ON constraints.confrelid = closure.oid WHERE constraints.contype = 'f'
			) SELECT oid::regclass::text AS name FROM closure`,
			[tables],
		);
		statement = ["SET LOCAL session_replication_role = replica", ...rows.map((row) => `DELETE FROM ${row.name}`)].join(
			";\n",
		);
		cache.set(key, statement);
	}
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		await client.query(statement);
		await client.query("COMMIT");
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}
