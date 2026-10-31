import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { auth, linkAnonymousAccount, setAccountLinkHook } from "@reactive-resume/auth/config";
import { db, withDatabasePool } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { env } from "@reactive-resume/env/server";
import { authRouter } from "./router";

// Like the OAuth CI checks, this uses a disposable, migrated database, with isolated fixture tables.
describe.skipIf(!process.env.OAUTH_TEST_DATABASE_URL)("account wrapper ownership", () => {
	const schemaName = `account_test_${randomUUID().replaceAll("-", "")}`;
	let admin: Pool;
	let pool: Pool;

	beforeAll(async () => {
		admin = new Pool({ connectionString: process.env.OAUTH_TEST_DATABASE_URL });
		await admin.query(`CREATE SCHEMA ${schemaName}`);
		for (const table of [
			"user",
			"session",
			"apikey",
			"oauth_resource",
			"jwks",
			"resume",
			"resume_version",
			"cover_letter",
			"cover_letter_version",
			"application",
			"application_lane",
			"application_pipeline",
			"application_profile",
			"career_answer",
			"resume_slug_redirect",
			"released_username",
		]) {
			await admin.query(`CREATE TABLE ${schemaName}."${table}" (LIKE public."${table}" INCLUDING ALL)`);
		}
		pool = new Pool({
			connectionString: process.env.OAUTH_TEST_DATABASE_URL,
			options: `-c search_path=${schemaName}`,
		});
		for (const id of ["link-guest", "link-owner", "failed-guest", "race-guest"]) {
			await pool.query(
				`INSERT INTO "user" (id,name,email,username,display_username) VALUES ($1,$1,$1 || '@example.test',$1,$1)`,
				[id],
			);
		}
	});

	afterAll(async () => {
		await pool?.end();
		await admin?.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
		await admin?.end();
	});

	it("links guest documents, versions, attachments and redirects without changing destination assets", async () => {
		const oldUrl = "https://resume.example/api/uploads/link-guest/pictures/photo.png";
		const newUrl = "https://resume.example/api/uploads/link-owner/pictures/photo.png";
		await pool.query(
			`INSERT INTO resume (id, name, slug, data, user_id) VALUES
			('guest-resume', 'Guest', 'shared', $1, 'link-guest'),
			('owner-resume', 'Owner', 'shared', $2, 'link-owner')`,
			[JSON.stringify({ picture: oldUrl, nested: [oldUrl] }), JSON.stringify({ picture: "existing" })],
		);
		await pool.query(
			`INSERT INTO resume_version (id, resume_id, user_id, data) VALUES ('guest-version', 'guest-resume', 'link-guest', $1)`,
			[JSON.stringify({ picture: oldUrl })],
		);
		await pool.query(
			`INSERT INTO cover_letter (id, name, user_id, style) VALUES ('guest-letter', 'Guest', 'link-guest', $1)`,
			[JSON.stringify({ picture: oldUrl })],
		);
		await pool.query(
			`INSERT INTO cover_letter_version (id, cover_letter_id, user_id, data) VALUES ('guest-letter-version', 'guest-letter', 'link-guest', $1)`,
			[JSON.stringify({ style: { picture: oldUrl } })],
		);
		await pool.query(
			`INSERT INTO application (id, user_id, company, role, resume_file_url, cover_letter_url) VALUES ('guest-application', 'link-guest', 'Example', 'Engineer', $1, NULL)`,
			[oldUrl],
		);
		await pool.query(`INSERT INTO resume_slug_redirect (id, user_id, resume_id, slug, expires_at) VALUES
			('guest-redirect', 'link-guest', 'guest-resume', 'old', now() + interval '1 day'),
			('guest-conflict', 'link-guest', 'guest-resume', 'conflict', now() + interval '1 day'),
			('owner-redirect', 'link-owner', 'owner-resume', 'conflict', now() + interval '1 day')`);

		await withDatabasePool(pool, () => linkAnonymousAccount({ fromUserId: "link-guest", toUserId: "link-owner" }));

		expect((await pool.query("SELECT user_id, slug, data FROM resume WHERE id = 'guest-resume'")).rows).toEqual([
			{ user_id: "link-owner", slug: "shared-resume", data: { picture: newUrl, nested: [newUrl] } },
		]);
		expect((await pool.query("SELECT data FROM resume WHERE id = 'owner-resume'")).rows[0]?.data).toEqual({
			picture: "existing",
		});
		for (const [table, column, value] of [
			["resume_version", "data", { picture: newUrl }],
			["cover_letter", "style", { picture: newUrl }],
			["cover_letter_version", "data", { style: { picture: newUrl } }],
		] as const) {
			expect((await pool.query(`SELECT user_id, ${column} AS value FROM ${table}`)).rows).toEqual([
				{ user_id: "link-owner", value },
			]);
		}
		expect((await pool.query("SELECT user_id, resume_file_url, cover_letter_url FROM application")).rows).toEqual([
			{ user_id: "link-owner", resume_file_url: newUrl, cover_letter_url: null },
		]);
		expect((await pool.query("SELECT id, user_id FROM resume_slug_redirect ORDER BY id")).rows).toEqual([
			{ id: "guest-redirect", user_id: "link-owner" },
			{ id: "owner-redirect", user_id: "link-owner" },
		]);
	});

	it("transfers a guest profile intact and refuses to overwrite a destination profile", async () => {
		const data = { email: "guest-private@example.test" };
		await pool.query(
			`INSERT INTO application_profile (user_id,data,reviewed_at,revision) VALUES ('link-guest',$1,'2030-01-01T00:00:00Z','guest-revision')`,
			[JSON.stringify(data)],
		);
		await withDatabasePool(pool, () => linkAnonymousAccount({ fromUserId: "link-guest", toUserId: "link-owner" }));
		const transferred = (
			await pool.query(`SELECT user_id,data,reviewed_at,revision FROM application_profile WHERE user_id='link-owner'`)
		).rows[0];
		expect(transferred).toMatchObject({ user_id: "link-owner", data, reviewed_at: new Date("2030-01-01T00:00:00Z") });
		expect(transferred.revision).not.toBe("guest-revision");
		await pool.query(
			`INSERT INTO application_profile (user_id,data,reviewed_at,revision) VALUES ('link-guest','{}',now(),'second-profile')`,
		);
		await expect(
			withDatabasePool(pool, () => linkAnonymousAccount({ fromUserId: "link-guest", toUserId: "link-owner" })),
		).rejects.toThrow("Both accounts have a private application profile");
		expect((await pool.query(`SELECT user_id FROM application_profile ORDER BY user_id`)).rows).toEqual([
			{ user_id: "link-guest" },
			{ user_id: "link-owner" },
		]);
		expect((await pool.query(`SELECT data FROM application_profile WHERE user_id='link-owner'`)).rows[0].data).toEqual(
			data,
		);
		await pool.query("DELETE FROM application_profile");
	});

	it("rolls back ownership and URLs when upload copying fails", async () => {
		const data = { picture: "https://resume.example/api/uploads/failed-guest/pictures/a.png" };
		await pool.query(
			`INSERT INTO resume (id, name, slug, data, user_id) VALUES ('failed-resume', 'Guest', 'failed', $1, 'failed-guest')`,
			[JSON.stringify(data)],
		);
		setAccountLinkHook(async () => {
			throw new Error("Copy unavailable");
		});
		try {
			await expect(
				withDatabasePool(pool, () => linkAnonymousAccount({ fromUserId: "failed-guest", toUserId: "link-owner" })),
			).rejects.toThrow("Copy unavailable");
		} finally {
			setAccountLinkHook();
		}
		expect((await pool.query("SELECT user_id, data FROM resume WHERE id = 'failed-resume'")).rows).toEqual([
			{ user_id: "failed-guest", data },
		]);
	});

	it("blocks guest saves while copying and rejects stale ownership after commit", async () => {
		const data = { picture: "https://resume.example/api/uploads/race-guest/pictures/a.png" };
		await pool.query(
			`INSERT INTO resume (id, name, slug, data, user_id) VALUES ('race-resume', 'Guest', 'race', $1, 'race-guest')`,
			[JSON.stringify(data)],
		);
		const copying = Promise.withResolvers<void>();
		const resumeCopy = Promise.withResolvers<void>();
		setAccountLinkHook(async () => {
			copying.resolve();
			await resumeCopy.promise;
		});
		const client = await pool.connect();
		const linking = withDatabasePool(pool, () =>
			linkAnonymousAccount({ fromUserId: "race-guest", toUserId: "link-owner" }),
		);
		try {
			await copying.promise;
			await client.query("SET lock_timeout = '100ms'");
			await expect(
				client.query("UPDATE resume SET data = '{}' WHERE id = 'race-resume' AND user_id = 'race-guest'"),
			).rejects.toMatchObject({ code: "55P03" });
		} finally {
			resumeCopy.resolve();
			await linking;
			setAccountLinkHook();
			await client.query("RESET lock_timeout");
			client.release();
		}
		expect(
			(await pool.query("UPDATE resume SET data = '{}' WHERE id = 'race-resume' AND user_id = 'race-guest'")).rowCount,
		).toBe(0);
		expect((await pool.query("SELECT user_id, data FROM resume WHERE id = 'race-resume'")).rows).toEqual([
			{ user_id: "link-owner", data: { picture: "https://resume.example/api/uploads/link-owner/pictures/a.png" } },
		]);
	});

	it("reads only the authenticated profile, ignoring supplied identity and excluding private columns", async () => {
		await withDatabasePool(pool, async () => {
			const [owner, other] = await db
				.insert(schema.user)
				.values([
					{
						id: "profile-owner",
						name: "Profile owner",
						email: "profile@example.test",
						username: "profile-owner",
						displayUsername: "ProfileOwner",
						timezone: "Europe/Berlin",
						role: "admin",
						banReason: "Private",
					},
					{
						id: "profile-other",
						name: "Other",
						email: "other-profile@example.test",
						username: "profile-other",
						displayUsername: "ProfileOther",
					},
				])
				.returning();
			if (!owner || !other) throw new Error("Missing profile fixtures");
			const client = createRouterClient(authRouter, {
				context: {
					locale: "en-US",
					reqHeaders: new Headers(),
					resHeaders: new Headers(),
					authentication: {
						user: { ...owner, name: "Stale session name" },
						method: "bearer",
						permissions: ["read", "write", "delete"],
					},
				},
			});
			const suppliedIdentity = { userId: other.id };
			await expect(Reflect.apply(client.getProfile, undefined, [suppliedIdentity])).resolves.toEqual({
				id: owner.id,
				name: owner.name,
				username: owner.username,
				displayUsername: owner.displayUsername,
				image: null,
				email: owner.email,
				emailVerified: false,
				timezone: "Europe/Berlin",
			});
			const anonymous = createRouterClient(authRouter, {
				context: {
					locale: "en-US",
					reqHeaders: new Headers(),
					resHeaders: new Headers(),
				},
			});
			await expect(anonymous.getProfile()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		});
	});

	it("persists a validated timezone through the account bridge without changing another user", async () => {
		await withDatabasePool(pool, async () => {
			const [owner, other] = await db
				.insert(schema.user)
				.values([
					{
						id: "timezone-owner",
						name: "Timezone owner",
						email: "timezone@example.test",
						username: "timezone-owner",
						displayUsername: "TimezoneOwner",
					},
					{
						id: "timezone-other",
						name: "Other",
						email: "other-timezone@example.test",
						username: "timezone-other",
						displayUsername: "TimezoneOther",
					},
				])
				.returning();
			if (!owner || !other) throw new Error("Missing timezone fixtures");
			const client = createRouterClient(authRouter, {
				context: {
					locale: "en-US",
					reqHeaders: new Headers(),
					resHeaders: new Headers(),
					authentication: { user: owner, method: "bearer", permissions: ["read", "write", "delete"] },
				},
			});
			await expect(client.updateProfile({ timezone: "Asia/Kolkata" })).resolves.toEqual({ status: true });
			const [saved] = await db
				.select({ timezone: schema.user.timezone })
				.from(schema.user)
				.where(eq(schema.user.id, owner.id));
			expect(saved?.timezone).toBe("Asia/Kolkata");
			await expect(client.updateProfile({ timezone: "Not/A_Timezone" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
			const [untouched] = await db
				.select({ timezone: schema.user.timezone })
				.from(schema.user)
				.where(eq(schema.user.id, other.id));
			expect(untouched?.timezone).toBe("UTC");
		});
	});

	it("confines concurrent account calls to their authenticated users, despite another user's cookie", async () => {
		await withDatabasePool(pool, async () => {
			const methods = ["session", "bearer", "apiKey"] as const;
			const users = await db
				.insert(schema.user)
				.values(
					["foreign", ...methods].map((id) => ({
						id,
						name: id,
						email: `${id}@example.test`,
						username: id.toLowerCase(),
						displayUsername: id.toLowerCase(),
					})),
				)
				.returning();
			const foreign = users[0];
			if (!foreign) throw new Error("Missing foreign-user fixture");
			const authContext = await auth.$context;
			const session = await authContext.internalAdapter.createSession(foreign.id);
			const signature = createHmac("sha256", env.AUTH_SECRET).update(session.token).digest("base64");
			const cookie = `${authContext.authCookies.sessionToken.name}=${encodeURIComponent(`${session.token}.${signature}`)}`;
			const headers = new Headers({ cookie });
			expect((await auth.api.getSession({ headers }))?.user.id).toBe(foreign.id);
			const foreignKey = await auth.api.createApiKey({ body: { userId: foreign.id, name: "Foreign" } });

			await Promise.all(
				methods.map(async (method, index) => {
					const user = users[index + 1];
					if (!user) throw new Error(`Missing ${method} fixture`);
					const ownKey = await auth.api.createApiKey({ body: { userId: user.id, name: method } });
					const resHeaders = new Headers();
					const client = createRouterClient(authRouter, {
						context: {
							locale: "en-US",
							reqHeaders: headers,
							resHeaders,
							authentication: { user, method, permissions: ["read", "write", "delete"] },
						},
					});
					const username = `saved-${method.toLowerCase()}`;
					await expect(client.updateProfile({ name: "Saved", username, image: null })).resolves.toEqual({
						status: true,
					});
					await expect(client.updateProfile({ username: foreign.username })).rejects.toMatchObject({
						code: "USERNAME_IS_ALREADY_TAKEN",
						status: 400,
					});
					const listed = await client.apiKeys.list();
					expect(listed.total).toBe(1);
					expect(listed.apiKeys.map((key) => key.id)).toEqual([ownKey.id]);
					expect(listed.apiKeys[0]).not.toHaveProperty("key");
					expect(listed.apiKeys[0]).not.toHaveProperty("metadata");
					expect(JSON.stringify(listed)).not.toContain(ownKey.key);
					await expect(client.apiKeys.delete({ keyId: foreignKey.id })).rejects.toMatchObject({ status: 404 });
					await expect(client.apiKeys.delete({ keyId: ownKey.id })).resolves.toEqual({ success: true });
					expect((await client.apiKeys.list()).apiKeys).toEqual([]);
					expect(resHeaders.has("set-cookie")).toBe(false);
				}),
			);
			const saved = await db.select().from(schema.user);
			expect(saved.find((user) => user.id === foreign.id)?.name).toBe("foreign");
			for (const method of methods) {
				expect(saved.find((user) => user.id === method)).toMatchObject({
					name: "Saved",
					username: `saved-${method.toLowerCase()}`,
					displayUsername: `saved-${method.toLowerCase()}`,
				});
			}
			expect((await db.select().from(schema.apikey)).map((key) => key.id)).toEqual([foreignKey.id]);
			expect(await db.select().from(schema.session)).toHaveLength(1);
			await expect(auth.api.listApiKeys({})).rejects.toMatchObject({ statusCode: 401 });
			const response = await auth.handler(
				new Request(`${env.APP_URL}/api/auth/update-user`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ name: "Must not save" }),
				}),
			);
			expect(response.status).toBe(401);
		});
	});
});
