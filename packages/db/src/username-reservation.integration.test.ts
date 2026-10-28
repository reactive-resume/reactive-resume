import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { Pool } from "pg";

describe.skipIf(!process.env.COVER_LETTER_TEST_DATABASE_URL)("serialized username claims", () => {
	const namespace = `username_test_${randomUUID().replaceAll("-", "")}`;
	let admin: Pool;
	let pool: Pool;
	beforeAll(async () => {
		admin = new Pool({ connectionString: process.env.COVER_LETTER_TEST_DATABASE_URL });
		await admin.query(`CREATE SCHEMA ${namespace}`);
		pool = new Pool({
			connectionString: process.env.COVER_LETTER_TEST_DATABASE_URL,
			options: `-c search_path=${namespace}`,
			max: 3,
		});
		await pool.query(
			'CREATE TABLE "user" (id text PRIMARY KEY, username text UNIQUE, is_anonymous boolean DEFAULT false)',
		);
		for (const migration of ["20261023064403_rapid_nehzno", "20261028045128_serialize_username_reservations"])
			await pool.query(
				await readFile(new URL(`../../../migrations/${migration}/migration.sql`, import.meta.url), "utf8"),
			);
	});
	afterAll(async () => {
		await pool?.end();
		await admin?.query(`DROP SCHEMA IF EXISTS ${namespace} CASCADE`);
		await admin?.end();
	});
	it.each(["rename", "delete"])("rejects a concurrent claim after %s commits its reservation", async (operation) => {
		const name = `owner-${operation}`;
		await pool.query('INSERT INTO "user" (id,username) VALUES ($1,$1),($2,$2)', [name, `claimant-${operation}`]);
		const release = await pool.connect();
		const claim = await pool.connect();
		try {
			await release.query("BEGIN");
			await release.query(
				operation === "rename"
					? "UPDATE \"user\" SET username = username || '-new' WHERE id=$1"
					: 'DELETE FROM "user" WHERE id=$1',
				[name],
			);
			const pid = (await claim.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
			const pending = claim.query('UPDATE "user" SET username=$1 WHERE id=$2', [name, `claimant-${operation}`]).then(
				() => null,
				(error: unknown) => error,
			);
			await expect
				.poll(async () => (await pool.query("SELECT cardinality(pg_blocking_pids($1)) AS count", [pid])).rows[0].count)
				.toBeGreaterThan(0);
			await release.query("COMMIT");
			expect(await pending).toMatchObject({ code: "23505", constraint: "user_username_unique" });
			if (operation === "rename") {
				await expect(release.query('UPDATE "user" SET username=$1 WHERE id=$1', [name])).resolves.toMatchObject({
					rowCount: 1,
				});
			} else {
				await pool.query("UPDATE released_username SET released_at = now() - interval '31 days' WHERE username=$1", [
					name,
				]);
				await expect(
					claim.query('UPDATE "user" SET username=$1 WHERE id=$2', [name, `claimant-${operation}`]),
				).resolves.toMatchObject({ rowCount: 1 });
			}
		} finally {
			await release.query("ROLLBACK");
			release.release();
			claim.release();
		}
	});
});
