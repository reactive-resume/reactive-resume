import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { Pool } from "pg";
import { auth } from "@reactive-resume/auth/config";
import { withDatabasePool } from "@reactive-resume/db/client";
import { env } from "@reactive-resume/env/server";

// Uses an explicitly supplied disposable, migrated database and private fixture tables.
describe.skipIf(!process.env.OAUTH_TEST_DATABASE_URL)("joined authentication reads", () => {
	const schemaName = `auth_joins_${randomUUID().replaceAll("-", "")}`;
	let admin: Pool;
	let pool: Pool;

	beforeAll(async () => {
		admin = new Pool({ connectionString: process.env.OAUTH_TEST_DATABASE_URL });
		await admin.query(`CREATE SCHEMA ${schemaName}`);
		for (const table of ["user", "session", "account"]) {
			await admin.query(`CREATE TABLE ${schemaName}."${table}" (LIKE public."${table}" INCLUDING ALL)`);
		}
		pool = new Pool({ connectionString: process.env.OAUTH_TEST_DATABASE_URL, options: `-c search_path=${schemaName}` });
		await pool.query(`INSERT INTO "user" (id,name,email,username,display_username) VALUES
			('owner','Owner','owner@example.test','owner','owner'),
			('other','Other','other@example.test','other','other')`);
		await pool.query(`INSERT INTO session (id,token,user_id,expires_at) VALUES
			('owner-session','owner-token','owner',now() + interval '7 days'),
			('other-session','other-token','other',now() + interval '7 days'),
			('expired-session','expired-token','owner',now() - interval '1 day')`);
		await pool.query(`INSERT INTO account (id,account_id,provider_id,user_id,password) VALUES
			('owner-password','owner','credential','owner','private-password-hash'),
			('owner-github','github-owner','github','owner',NULL),
			('other-github','github-other','github','other',NULL)`);
	});

	afterAll(async () => {
		await pool?.end();
		await admin?.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
		await admin?.end();
	});

	it("returns only the session owner in one query and rejects expired or deleted sessions", async () => {
		await withDatabasePool(pool, async () => {
			const context = await auth.$context;
			const getSession = async (token: string) => {
				const signature = createHmac("sha256", env.AUTH_SECRET).update(token).digest("base64");
				return auth.handler(
					new Request(`${env.APP_URL}/api/auth/get-session`, {
						headers: {
							cookie: `${context.authCookies.sessionToken.name}=${encodeURIComponent(`${token}.${signature}`)}`,
						},
					}),
				);
			};
			const queries = vi.spyOn(pool, "query");
			try {
				const response = await getSession("owner-token");
				expect(response.status).toBe(200);
				const session = await response.json();
				expect(session).toMatchObject({ session: { id: "owner-session" }, user: { id: "owner" } });
				expect(queries).toHaveBeenCalledTimes(1);
				expect(JSON.stringify(session)).not.toContain("private-password-hash");
				await expect((await getSession("expired-token")).json()).resolves.toBeNull();
				await pool.query("DELETE FROM session WHERE token = 'owner-token'");
				await expect((await getSession("owner-token")).json()).resolves.toBeNull();
			} finally {
				queries.mockRestore();
			}
		});
	});

	it("loads a user's linked accounts and resolves a provider account's owner in one query each", async () => {
		await withDatabasePool(pool, async () => {
			const { internalAdapter } = await auth.$context;
			const queries = vi.spyOn(pool, "query");
			try {
				const found = await internalAdapter.findUserByEmail("owner@example.test", { includeAccounts: true });
				expect(found?.user.id).toBe("owner");
				expect(found?.accounts.map((account) => account.id).sort()).toEqual(["owner-github", "owner-password"]);
				expect(queries).toHaveBeenCalledTimes(1);
				queries.mockClear();
				await expect(
					internalAdapter.findAccountOwnerByKey({ providerId: "github", accountId: "github-other" }),
				).resolves.toMatchObject({ kind: "owned", account: { id: "other-github" }, user: { id: "other" } });
				expect(queries).toHaveBeenCalledTimes(1);
			} finally {
				queries.mockRestore();
			}
		});
	});
});
