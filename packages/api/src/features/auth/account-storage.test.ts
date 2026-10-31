import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vite-plus/test";
import { Pool } from "pg";
import { withDatabasePool } from "@reactive-resume/db/client";
import { getStorageService } from "../storage/service";
import { authService } from "./service";

const settings = vi.hoisted(() => ({ STORAGE_BACKEND: "local", LOCAL_STORAGE_PATH: "" }));
vi.mock("@reactive-resume/env/server", () => ({ env: settings }));
vi.mock("@reactive-resume/auth/config", () => ({ auth: { $context: { secretConfig: "fixture" } } }));
vi.mock("../applications/lanes", () => ({ applicationLaneService: {} }));
vi.mock("../career/service", () => ({ careerService: {} }));
vi.mock("../cover-letters/service", () => ({ coverLetterService: {} }));

// Uses the same disposable, migrated database as the account wrapper suite; real deletion runs its erasure trigger.
const databaseUrl = process.env.OAUTH_TEST_DATABASE_URL;
it.skipIf(!databaseUrl)(
	"account deletion erases retained photo uploads, including unreferenced photos, without touching another account",
	async () => {
		const pool = new Pool({ connectionString: databaseUrl });
		const owner = `storage-${randomUUID()}`;
		const neighborOwner = `${owner}-other`;
		settings.LOCAL_STORAGE_PATH = await mkdtemp(join(tmpdir(), "resume-account-storage-"));
		try {
			await withDatabasePool(pool, async () => {
				for (const id of [owner, neighborOwner])
					await pool.query(
						`INSERT INTO "user" (id,name,email,username,display_username) VALUES ($1,$1,$1 || '@example.test',$1,$1)`,
						[id],
					);
				const storage = getStorageService();
				const owned = [
					`uploads/${owner}/pictures/shared.jpeg`,
					`uploads/${owner}/pictures/removed.jpeg`,
					`uploads/${owner}/screenshots/resume.webp`,
					`uploads/${owner}/pdfs/resume.pdf`,
				];
				const neighbor = `uploads/${neighborOwner}/pictures/photo.jpeg`;
				for (const key of [...owned, neighbor])
					await storage.write({ key, data: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" });
				await authService.deleteAccount({ userId: owner });
				for (const key of owned) expect(await storage.read(key)).toBeNull();
				expect((await storage.read(neighbor))?.data).toEqual(Buffer.from([1, 2, 3]));
				expect((await pool.query('SELECT id FROM "user" WHERE id=$1', [owner])).rows).toEqual([]);
				expect((await pool.query("SELECT id FROM storage_cleanup_job WHERE owner_id=$1", [owner])).rows).toEqual([]);
			});
		} finally {
			await pool.query('DELETE FROM "user" WHERE id = ANY($1::text[])', [[owner, neighborOwner]]);
			await rm(settings.LOCAL_STORAGE_PATH, { recursive: true, force: true });
			await pool.query("DELETE FROM storage_cleanup_job WHERE owner_id = ANY($1::text[])", [[owner, neighborOwner]]);
			await pool.end();
		}
	},
);
