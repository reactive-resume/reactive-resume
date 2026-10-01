import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { is } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import * as schema from "./schema";

const migrationsFolder = fileURLToPath(new URL("../../../migrations", import.meta.url));
const v6Migration = "20261001042749_v6_release";

// Needs CREATE DATABASE permission; owns and deletes two disposable databases, never the supplied database.
describe.skipIf(!process.env.COVER_LETTER_TEST_DATABASE_URL)("database migrations", () => {
	it("creates the current schema, preserves v5 documents on upgrade, and supports retries and rollback", async () => {
		const databaseUrl = process.env.COVER_LETTER_TEST_DATABASE_URL;
		if (!databaseUrl) throw new Error("COVER_LETTER_TEST_DATABASE_URL is required");
		const admin = new Pool({ connectionString: databaseUrl });
		const baselineFolder = await mkdtemp(path.join(tmpdir(), "rr-v5-migrations-"));
		try {
			for (const name of await readdir(migrationsFolder)) {
				if (name < v6Migration) await symlink(path.join(migrationsFolder, name), path.join(baselineFolder, name));
			}
			for (const upgrade of [false, true]) {
				const databaseName = `migration_test_${randomUUID().replaceAll("-", "")}`;
				await admin.query(`CREATE DATABASE "${databaseName}"`);
				const url = new URL(databaseUrl);
				url.pathname = `/${databaseName}`;
				const pool = new Pool({ connectionString: url.toString(), max: 1 });
				const db = drizzle({ client: pool });
				const data = {
					basics: { name: "Migration fixture" },
					picture: {},
					metadata: { notes: "private", layout: { pages: [{ main: ["letter", "keep"], sidebar: ["letter"] }] } },
					customSections: [
						{ id: "keep", type: "custom", items: [] },
						{
							id: "letter",
							type: "cover-letter",
							hidden: true,
							items: [{ id: "item", recipient: "Acme", content: "<p>Keep this letter</p>" }],
						},
					],
				};
				try {
					if (upgrade) {
						await migrate(db, { migrationsFolder: baselineFolder });
						await pool.query(
							`INSERT INTO "user" (id,name,email,username,display_username) VALUES ('owner','Owner','owner@example.test','owner','owner')`,
						);
						await pool.query(
							`INSERT INTO resume (id,user_id,name,slug,data) VALUES ('resume','owner','Resume','resume',$1)`,
							[data],
						);
						await pool.query(
							`INSERT INTO application (id,user_id,company,role,resume_id,status,activity) VALUES ('rejected','owner','Acme','Engineer','resume','rejected','[{"type":"stage","stage":"saved"},{"type":"stage","stage":"rejected"}]')`,
						);
						await pool.query(
							`INSERT INTO application (id,user_id,company,role,status,archived) VALUES ('archived','owner','Other','Engineer','interviewing',true),('active','owner','Other','Engineer','saved',false)`,
						);
						await pool.query(
							`INSERT INTO cover_letter (id,user_id,name,content,style,source_application_id) VALUES ('library','owner','Library','Existing letter','{}','active')`,
						);
						for (const label of ["Imported", "AI edit", "Before restore", "Restored version", "Manual save"]) {
							await pool.query(
								`INSERT INTO resume_version (id,resume_id,user_id,data,label) VALUES ($1,'resume','owner',$2,$1)`,
								[label, data],
							);
						}
					}
					await migrate(db, { migrationsFolder });
					const actual = await pool.query(
						`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,column_name`,
					);
					const expected = Object.values(schema)
						.filter((value) => is(value, PgTable))
						.flatMap((table) => {
							const config = getTableConfig(table);
							return config.columns.map((column) => ({ table_name: config.name, column_name: column.name }));
						})
						.sort((a, b) => a.table_name.localeCompare(b.table_name) || a.column_name.localeCompare(b.column_name));
					expect(actual.rows).toEqual(expected);
					if (upgrade) {
						expect((await pool.query("SELECT id,status,closed_reason FROM application ORDER BY id")).rows).toEqual([
							{ id: "active", status: "saved", closed_reason: null },
							{ id: "archived", status: "closed", closed_reason: null },
							{ id: "rejected", status: "closed", closed_reason: "not-selected" },
						]);
						expect((await pool.query("SELECT activity FROM application WHERE id='rejected'")).rows[0].activity).toEqual(
							[
								{ type: "stage", stage: "saved" },
								{ type: "stage", stage: "closed" },
							],
						);
						expect((await pool.query("SELECT id,kind,data FROM resume_version ORDER BY id")).rows).toEqual([
							{ id: "AI edit", kind: "ai", data },
							{ id: "Before restore", kind: "before-restore", data },
							{ id: "Imported", kind: "import", data },
							{ id: "Manual save", kind: "auto", data },
							{ id: "Restored version", kind: "restored", data },
						]);
						const letters = (await pool.query("SELECT * FROM cover_letter ORDER BY name")).rows;
						expect(letters).toHaveLength(2);
						expect(letters[0]).toMatchObject({
							id: "library",
							content: "Existing letter",
							layout: "freeform",
							sender_linked: false,
							design_linked: false,
						});
						expect(letters[1]).toMatchObject({
							recipient: "Acme",
							content: "<p>Keep this letter</p>",
							source_resume_id: "resume",
							source_application_id: "rejected",
							sender_linked: true,
							design_linked: true,
							style: { basics: data.basics, picture: {}, metadata: {}, sectionId: "letter", itemId: "item" },
						});
						expect(
							(
								await pool.query(
									"SELECT id,cover_letter_id FROM application WHERE cover_letter_id IS NOT NULL ORDER BY id",
								)
							).rows,
						).toEqual([
							{ id: "active", cover_letter_id: "library" },
							{ id: "rejected", cover_letter_id: letters[1].id },
						]);
						expect((await pool.query("SELECT kind,data FROM cover_letter_version")).rows).toEqual([
							{
								kind: "created",
								data: {
									name: letters[1].name,
									recipient: "Acme",
									content: "<p>Keep this letter</p>",
									style: letters[1].style,
									layout: "freeform",
									recipientName: "",
									recipientCompany: "",
									letterDate: null,
								},
							},
						]);
						expect((await pool.query("SELECT data FROM resume")).rows[0].data).toEqual({
							...data,
							customSections: [data.customSections[0]],
							metadata: { notes: "private", layout: { pages: [{ main: ["keep"], sidebar: [] }] } },
						});
					}
					const before = (await pool.query("SELECT * FROM drizzle.__drizzle_migrations ORDER BY id")).rows;
					await migrate(db, { migrationsFolder });
					expect((await pool.query("SELECT * FROM drizzle.__drizzle_migrations ORDER BY id")).rows).toEqual(before);
					if (upgrade) {
						expect((await pool.query("SELECT count(*)::integer AS count FROM cover_letter")).rows[0].count).toBe(2);
						await pool.query(await readFile(path.join(migrationsFolder, v6Migration, "rollback.sql"), "utf8"));
						expect((await pool.query("SELECT status FROM application WHERE id='rejected'")).rows[0].status).toBe(
							"rejected",
						);
						expect((await pool.query("SELECT archived FROM application WHERE id='archived'")).rows[0].archived).toBe(
							true,
						);
						expect((await pool.query("SELECT label FROM resume_version WHERE id='Imported'")).rows[0].label).toBe(
							"Imported",
						);
						expect((await pool.query("SELECT data FROM resume")).rows[0].data.customSections).toContainEqual(
							expect.objectContaining({
								id: "letter",
								type: "cover-letter",
								items: [expect.objectContaining({ content: "<p>Keep this letter</p>" })],
							}),
						);
					}
				} finally {
					await pool.end();
					await admin.query(`DROP DATABASE "${databaseName}"`);
				}
			}
		} finally {
			await rm(baselineFolder, { recursive: true, force: true });
			await admin.end();
		}
	}, 30_000);
});
