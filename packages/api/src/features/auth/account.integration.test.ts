import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { createRouterClient } from "@orpc/server";
import { symmetricDecrypt } from "better-auth/crypto";
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
			"account",
			"verification",
			"two_factor",
			"apikey",
			"oauth_access_token",
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
			"career_fact",
			"career_profile",
			"career_story",
			"resume_slug_redirect",
			"released_username",
			"storage_cleanup_job",
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

	// Two-step sign-in drives the real auth handler, carrying each browser's cookies in a jar.
	type Jar = Map<string, string>;
	const send = async (path: string, body: object, jar: Jar) => {
		const response = await auth.handler(
			new Request(`${env.APP_URL}/api/auth/${path}`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: env.APP_URL,
					cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; "),
				},
				body: JSON.stringify(body),
			}),
		);
		for (const header of response.headers.getSetCookie()) {
			const [pair = ""] = header.split(";", 1);
			const name = pair.slice(0, pair.indexOf("="));
			const value = pair.slice(pair.indexOf("=") + 1);
			if (!value || /max-age=0/i.test(header)) jar.delete(name);
			else jar.set(name, value);
		}
		return response;
	};
	const totp = async (userId: string) => {
		const [row] = await db.select().from(schema.twoFactor).where(eq(schema.twoFactor.userId, userId));
		const secret = await symmetricDecrypt({ key: (await auth.$context).secretConfig, data: row?.secret ?? "" });
		return (await auth.api.generateTOTP({ body: { secret } })).code;
	};
	const signUp = async (name: string) => {
		const credentials = { email: `${name}@example.test`, password: `${name}-password` };
		const jar: Jar = new Map();
		const signup = await send("sign-up/email", { ...credentials, name, username: name }, jar);
		expect(signup.status, await signup.clone().text()).toBe(200);
		return { id: (await signup.json()).user.id as string, credentials, jar };
	};
	const signUpWithTwoFactor = async (name: string) => {
		const account = await signUp(name);
		const enabled = await send("two-factor/enable", { password: account.credentials.password }, account.jar);
		expect(enabled.status, await enabled.clone().text()).toBe(200);
		const { backupCodes } = (await enabled.json()) as { backupCodes: string[] };
		expect((await send("two-factor/verify-totp", { code: await totp(account.id) }, account.jar)).status).toBe(200);
		return { ...account, backupCodes };
	};
	// A guest with one resume starts the password step from its own browser session.
	const startGuest = async (id: string, credentials: { email: string; password: string }) => {
		const authContext = await auth.$context;
		const guest = await authContext.internalAdapter.createUser(
			{ email: `${id}@reactive-resume.local`, name: "Guest", emailVerified: false, isAnonymous: true },
			{ method: "anonymous" },
		);
		const session = await authContext.internalAdapter.createSession(guest.id);
		const signature = createHmac("sha256", env.AUTH_SECRET).update(session.token).digest("base64");
		await pool.query(`INSERT INTO resume (id, name, slug, data, user_id) VALUES ($1, 'Guest', $1, '{}', $2)`, [
			id,
			guest.id,
		]);
		const sessionCookie = authContext.authCookies.sessionToken.name;
		const jar: Jar = new Map([[sessionCookie, encodeURIComponent(`${session.token}.${signature}`)]]);
		const challenge = await send("sign-in/email", credentials, jar);
		await expect(challenge.json()).resolves.toMatchObject({ twoFactorRedirect: true });
		expect(jar.has(sessionCookie)).toBe(false);
		const signed = jar.get(authContext.createAuthCookie("two_factor").name) ?? "";
		return { guest, session, jar, sessionCookie, challengeId: decodeURIComponent(signed).split(".")[0] ?? "" };
	};
	const resumeOwner = async (id: string) =>
		(await pool.query("SELECT user_id FROM resume WHERE id = $1", [id])).rows[0]?.user_id;
	const userExists = async (id: string) =>
		(await pool.query(`SELECT 1 FROM "user" WHERE id = $1`, [id])).rowCount === 1;

	it("moves guest work once into the account a two-step sign-in verifies, and keeps it on failure", async () => {
		await withDatabasePool(pool, async () => {
			const owner = await signUpWithTwoFactor("two-step");

			const viaTotp = await startGuest("totp-guest", owner.credentials);
			const wrongCode = String((Number(await totp(owner.id)) + 500_000) % 1_000_000).padStart(6, "0");
			expect((await send("two-factor/verify-totp", { code: wrongCode }, new Map(viaTotp.jar))).status).toBe(401);
			expect(await resumeOwner("totp-guest")).toBe(viaTotp.guest.id);
			const replayJar = new Map(viaTotp.jar);
			const verified = await send("two-factor/verify-totp", { code: await totp(owner.id) }, viaTotp.jar);
			expect(verified.status, await verified.clone().text()).toBe(200);
			expect(await resumeOwner("totp-guest")).toBe(owner.id);
			expect(await userExists(viaTotp.guest.id)).toBe(false);
			expect((await send("two-factor/verify-totp", { code: await totp(owner.id) }, replayJar)).status).toBe(401);

			const viaBackup = await startGuest("backup-guest", owner.credentials);
			const backup = await send("two-factor/verify-backup-code", { code: owner.backupCodes[0] }, viaBackup.jar);
			expect(backup.status, await backup.clone().text()).toBe(200);
			expect(await resumeOwner("backup-guest")).toBe(owner.id);
			expect(await userExists(viaBackup.guest.id)).toBe(false);

			// A failed move signs the browser back in as the guest, keeps the guest's work, and ends the new session.
			const failing = await startGuest("failed-2fa-guest", owner.credentials);
			const ownerSessions = async () =>
				(await pool.query("SELECT count(*)::int AS count FROM session WHERE user_id = $1", [owner.id])).rows[0]?.count;
			const sessionsBefore = await ownerSessions();
			setAccountLinkHook(async () => {
				throw new Error("Copy unavailable");
			});
			try {
				const failed = await send("two-factor/verify-backup-code", { code: owner.backupCodes[1] }, failing.jar);
				expect(failed.ok).toBe(false);
			} finally {
				setAccountLinkHook();
			}
			expect(failing.jar.get(failing.sessionCookie)?.startsWith(failing.session.token)).toBe(true);
			expect(await resumeOwner("failed-2fa-guest")).toBe(failing.guest.id);
			expect(await userExists(failing.guest.id)).toBe(true);
			expect(await ownerSessions()).toBe(sessionsBefore);
			expect((await pool.query("SELECT 1 FROM verification WHERE identifier LIKE 'guest-link:%'")).rowCount).toBe(0);
			await pool.query("DELETE FROM session");
		});
	});

	it("hands guest work to the challenge accepted at its deadline, only once, and only for that account", async () => {
		await withDatabasePool(pool, async () => {
			const owner = await signUpWithTwoFactor("deadline-owner");
			const expire = (challengeId: string, at: string) =>
				pool.query(`UPDATE verification SET expires_at = ${at} WHERE identifier IN ($1, $2)`, [
					challengeId,
					`guest-link:${owner.id}:${challengeId}`,
				]);

			// The deadline passes after the endpoint accepts the challenge, while its session row is being written.
			await pool.query(
				"CREATE FUNCTION delay_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.6); RETURN NEW; END $$",
			);
			await pool.query(
				"CREATE TRIGGER delay_session BEFORE INSERT ON session FOR EACH ROW EXECUTE FUNCTION delay_session()",
			);
			try {
				for (const id of ["deadline-1", "deadline-2", "deadline-3"]) {
					const pending = await startGuest(id, owner.credentials);
					const code = await totp(owner.id);
					await expire(pending.challengeId, "now() + interval '300 milliseconds'");
					const verified = await send("two-factor/verify-totp", { code }, pending.jar);
					expect(verified.status, await verified.clone().text()).toBe(200);
					expect(await resumeOwner(id)).toBe(owner.id);
					expect(await userExists(pending.guest.id)).toBe(false);
				}
			} finally {
				await pool.query("DROP TRIGGER delay_session ON session");
				await pool.query("DROP FUNCTION delay_session()");
			}

			const expired = await startGuest("expired-guest", owner.credentials);
			await expire(expired.challengeId, "now() - interval '1 second'");
			expect((await send("two-factor/verify-totp", { code: await totp(owner.id) }, expired.jar)).status).toBe(401);
			expect(await resumeOwner("expired-guest")).toBe(expired.guest.id);

			// Another account's successful verification, carrying this challenge's cookie, takes nothing.
			const pending = await startGuest("foreign-guest", owner.credentials);
			const other = await signUp("deadline-other");
			expect((await send("two-factor/enable", { password: other.credentials.password }, other.jar)).status).toBe(200);
			const mixed = new Map([...pending.jar, ...other.jar]);
			expect((await send("two-factor/verify-totp", { code: await totp(other.id) }, mixed)).status).toBe(200);
			expect(await resumeOwner("foreign-guest")).toBe(pending.guest.id);

			// Concurrent verifications of one challenge: one succeeds and moves the work once.
			const moves: string[] = [];
			setAccountLinkHook(async ({ fromUserId }) => {
				moves.push(fromUserId);
			});
			try {
				const code = await totp(owner.id);
				const responses = await Promise.all([
					send("two-factor/verify-totp", { code }, new Map(pending.jar)),
					send("two-factor/verify-totp", { code }, new Map(pending.jar)),
				]);
				expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);
			} finally {
				setAccountLinkHook();
			}
			expect(moves).toEqual([pending.guest.id]);
			expect(await resumeOwner("foreign-guest")).toBe(owner.id);
			await pool.query("DELETE FROM session");
		});
	}, 30_000);

	it("finishes an accepted guest transfer even when expiring handoff cleanup is locked", async () => {
		await withDatabasePool(pool, async () => {
			const owner = await signUpWithTwoFactor("cleanup-owner");
			const pending = await startGuest("cleanup-guest", owner.credentials);
			const identifier = `guest-link:${owner.id}:${pending.challengeId}`;
			const replay = new Map(pending.jar);
			const timedPool = new Pool({
				connectionString: process.env.OAUTH_TEST_DATABASE_URL,
				options: `-c search_path=${schemaName} -c lock_timeout=100ms`,
			});
			const locker = await pool.connect();
			await locker.query("BEGIN");
			await locker.query("SELECT id FROM verification WHERE identifier = $1 FOR UPDATE", [identifier]);
			try {
				const code = await totp(owner.id);
				const response = await withDatabasePool(timedPool, () => send("two-factor/verify-totp", { code }, pending.jar));
				expect(response.status, await response.clone().text()).toBe(200);
				expect(response.headers.getSetCookie().length).toBeGreaterThan(0);
				expect(await resumeOwner("cleanup-guest")).toBe(owner.id);
				expect(await userExists(pending.guest.id)).toBe(false);
				const headers = new Headers({
					cookie: [...pending.jar].map(([key, value]) => `${key}=${value}`).join("; "),
				});
				expect((await auth.api.getSession({ headers }))?.user.id).toBe(owner.id);
				expect((await pool.query("SELECT 1 FROM verification WHERE identifier = $1", [identifier])).rowCount).toBe(1);
				expect((await send("two-factor/verify-totp", { code: await totp(owner.id) }, replay)).status).toBe(401);
			} finally {
				await locker.query("ROLLBACK");
				locker.release();
				await timedPool.end();
				await pool.query("DELETE FROM verification WHERE identifier = $1", [identifier]);
				await pool.query("DELETE FROM session WHERE user_id IN ($1, $2)", [owner.id, pending.guest.id]);
			}
		});
	});

	it("links private profiles and reviewed answers through two-step verification without losing conflicting work", async () => {
		await withDatabasePool(pool, async () => {
			const { applicationProfileService: profiles } = await import("../application-profile/service");
			const { reviewedAnswers: answers } = await import("../career/answers");
			const { applicationProfileDataSchema } = await import("@reactive-resume/schema/application-profile");
			const owner = await signUpWithTwoFactor("private-link-owner");
			const pending = await startGuest("private-link-guest", owner.credentials);
			const guestProfile = await profiles.save(pending.guest.id, {
				data: applicationProfileDataSchema.parse({
					phone: "PRIVATE GUEST PHONE",
					workAuthorization: [{ countryCode: "DE", authorized: "unknown", needsSponsorship: "unknown" }],
				}),
				expectedRevision: null,
			});
			const ownerProfile = await profiles.save(owner.id, {
				data: applicationProfileDataSchema.parse({ phone: "PRIVATE OWNER PHONE" }),
				expectedRevision: null,
			});
			await db.insert(schema.application).values([
				{ id: "private-guest-app", userId: pending.guest.id, company: "Harbor", role: "Engineer" },
				{ id: "private-owner-app", userId: owner.id, company: "Nova", role: "Engineer" },
			]);
			const input = {
				question: "Describe your project",
				answer: "I reviewed a fictional setup checklist.",
				source: "manual" as const,
				scope: "reusable" as const,
				factIds: [],
				storyIds: [],
				expectedEvidence: [],
				reviewed: true as const,
				noEmployerWording: true,
			};
			const saved = await answers.save(pending.guest.id, { ...input, applicationId: "private-guest-app" });
			const ownerSessions = async () =>
				(await pool.query("SELECT count(*)::int AS count FROM session WHERE user_id = $1", [owner.id])).rows[0]?.count;
			const sessionsBefore = await ownerSessions();
			const verify = async () => send("two-factor/verify-totp", { code: await totp(owner.id) }, pending.jar);
			const retry = async () => {
				const response = await send("sign-in/email", owner.credentials, pending.jar);
				await expect(response.json()).resolves.toMatchObject({ twoFactorRedirect: true });
			};
			const guestIntact = async () => {
				const headers = new Headers({
					cookie: [...pending.jar].map(([key, value]) => `${key}=${value}`).join("; "),
				});
				expect((await auth.api.getSession({ headers }))?.user.id).toBe(pending.guest.id);
				expect(await profiles.get(pending.guest.id)).toEqual(guestProfile);
				expect((await answers.list(pending.guest.id, "private-guest-app"))[0]).toMatchObject({
					id: saved.id,
					answer: input.answer,
				});
				expect(await ownerSessions()).toBe(sessionsBefore);
				expect(await resumeOwner("private-link-guest")).toBe(pending.guest.id);
			};
			try {
				expect((await verify()).status).toBe(409);
				await guestIntact();
				expect(await profiles.get(owner.id)).toEqual(ownerProfile);
				await profiles.delete(owner.id, ownerProfile.revision);
				const duplicate = await answers.save(owner.id, { ...input, applicationId: "private-owner-app" });
				await retry();
				expect((await verify()).status).toBe(409);
				await guestIntact();
				expect(await profiles.get(owner.id)).toBeNull();
				await answers.delete(owner.id, duplicate.id, duplicate.revision);
				setAccountLinkHook(async () => {
					throw new Error("Synthetic copy failure");
				});
				await retry();
				expect((await verify()).status).toBe(500);
				await guestIntact();
				expect(await profiles.get(owner.id)).toBeNull();
				setAccountLinkHook();
				await retry();
				const response = await verify();
				expect(response.status, await response.clone().text()).toBe(200);
				expect(await userExists(pending.guest.id)).toBe(false);
				expect(await resumeOwner("private-link-guest")).toBe(owner.id);
				expect(await profiles.get(pending.guest.id)).toBeNull();
				const transferred = await profiles.get(owner.id);
				expect(transferred?.data).toEqual(guestProfile.data);
				expect(transferred?.revision).not.toBe(guestProfile.revision);
				expect((await answers.list(owner.id, "private-guest-app"))[0]).toMatchObject({
					id: saved.id,
					answer: input.answer,
				});
			} finally {
				setAccountLinkHook();
				await pool.query("DELETE FROM session WHERE user_id IN ($1, $2)", [owner.id, pending.guest.id]);
			}
		});
	}, 30_000);

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
				locale: null,
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
