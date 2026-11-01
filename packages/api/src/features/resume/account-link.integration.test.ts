import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as tables from "@reactive-resume/db/schema";

const fixture = vi.hoisted(() => ({ db: undefined as ReturnType<typeof drizzle> | undefined }));

vi.mock("@reactive-resume/db/client", () => ({
	get db() {
		return fixture.db;
	},
}));
vi.mock("./events", () => ({ publishResumeUpdated: vi.fn().mockResolvedValue(undefined) }));
// The real link owner and its real transaction, against the test database. The Better Auth instance itself is not
// needed for a direct call and would need a live auth secret.
vi.mock("@reactive-resume/auth/config", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	auth: { $context: Promise.resolve({ secretConfig: { key: "synthetic-test-key" } }) },
	isCustomOAuthProviderEnabled: () => false,
}));
vi.mock("@reactive-resume/pdf/server", () => ({ createResumePdfFile: vi.fn() }));

const databaseUrl = process.env.INTEGRATIONS_TEST_DATABASE_URL ?? process.env.COVER_LETTER_TEST_DATABASE_URL;

// Real PostgreSQL, opt-in only, in a schema of its own built from the shipped migrations: the primary unique index,
// its savepoints and concurrent transactions are what's under test.
describe.skipIf(!databaseUrl)("moving a guest's work into an existing account", () => {
	let resumes: typeof import("./service").resumeService;
	let linkAnonymousAccount: typeof import("@reactive-resume/auth/config").linkAnonymousAccount;
	let admin: Pool;
	let pool: Pool;
	const schemaName = `resume_link_${randomUUID().replaceAll("-", "")}`;
	const db = () => {
		if (!fixture.db) throw new Error("Test database is not initialized.");
		return fixture.db;
	};

	beforeAll(async () => {
		admin = new Pool({ connectionString: databaseUrl });
		await admin.query(`CREATE SCHEMA ${schemaName}`);
		pool = new Pool({
			connectionString: databaseUrl,
			max: 6,
			application_name: schemaName,
			options: `-c search_path=${schemaName}`,
		});
		fixture.db = drizzle({ client: pool });
		const migrations = new URL("../../../../../migrations/", import.meta.url);
		const directories = (await readdir(migrations, { withFileTypes: true }))
			.filter((entry) => entry.isDirectory() && /^\d+_/.test(entry.name))
			.map((entry) => entry.name)
			.sort();
		for (const directory of directories) {
			const file = new URL(`${directory}/migration.sql`, migrations);
			if (!existsSync(file)) continue;
			await pool.query((await readFile(file, "utf8")).replaceAll('"public".', ""));
		}
		resumes = (await import("./service")).resumeService;
		({ linkAnonymousAccount } = await import("@reactive-resume/auth/config"));
	}, 30_000);

	afterAll(async () => {
		await pool?.end();
		await admin?.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
		await admin?.end();
	});

	beforeEach(async () => {
		await pool.query('TRUNCATE released_username, storage_cleanup_job, "user" CASCADE');
		await db()
			.insert(tables.user)
			.values(
				[
					{ id: "priya", username: "priya" },
					{ id: "guest", username: "guest-1" },
				].map(({ id, username }) => ({
					id,
					name: id,
					email: `${id}@example.test`,
					username,
					displayUsername: username,
				})),
			);
	});

	const create = (userId: string, name: string) => resumes.create({ userId, name, tags: [], locale: "en-US" });
	const read = (id: string, userId = "priya") => resumes.getById({ id, userId });
	const ownership = async (id: string) => {
		const [row] = await db()
			.select({ userId: tables.resume.userId, isPrimary: tables.resume.isPrimary })
			.from(tables.resume)
			.where(eq(tables.resume.id, id));
		return row;
	};
	const publish = (id: string, userId: string, isPrimary?: boolean) =>
		resumes.update({ id, userId, isPublic: true, ...(isPrimary === undefined ? {} : { isPrimary }) });
	const primaryRows = () =>
		db()
			.select({ id: tables.resume.id })
			.from(tables.resume)
			.where(and(eq(tables.resume.userId, "priya"), eq(tables.resume.isPrimary, true)));
	const waitForLocks = async (count: number) => {
		for (let attempt = 0; attempt < 400; attempt++) {
			const { rows } = await admin.query<{ count: number }>(
				"SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'",
				[schemaName],
			);
			if ((rows[0]?.count ?? 0) >= count) return;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		throw new Error(`Expected ${count} writers to wait on the held row.`);
	};

	it("keeps the target account's primary when the guest published", async () => {
		const main = await create("priya", "Main");
		await publish(main, "priya");
		expect((await read(main)).isPrimary).toBe(true);
		const guestCv = await create("guest", "Guest CV");
		await expect(publish(guestCv, "guest")).resolves.toMatchObject({ isPrimary: true });

		await expect(linkAnonymousAccount({ fromUserId: "guest", toUserId: "priya" })).resolves.toBeUndefined();

		expect(await ownership(guestCv)).toEqual({ userId: "priya", isPrimary: false });
		expect((await read(main)).isPrimary).toBe(true);
		expect(await primaryRows()).toEqual([{ id: main }]);
	});

	it("still moves a guest who declined primary, keeping the target's primary", async () => {
		const main = await create("priya", "Main");
		await publish(main, "priya");
		const guestCv = await create("guest", "Guest CV");
		await expect(publish(guestCv, "guest", false)).resolves.toMatchObject({ isPrimary: false });

		await expect(linkAnonymousAccount({ fromUserId: "guest", toUserId: "priya" })).resolves.toBeUndefined();

		expect(await read(guestCv)).toMatchObject({ isPrimary: false });
		expect(await primaryRows()).toEqual([{ id: main }]);
	});

	it("makes the guest's published resume primary when the target has none", async () => {
		const privateCopy = await create("priya", "Private copy");
		const guestCv = await create("guest", "Guest CV");
		await publish(guestCv, "guest");

		await expect(linkAnonymousAccount({ fromUserId: "guest", toUserId: "priya" })).resolves.toBeUndefined();

		expect(await read(guestCv)).toMatchObject({ isPrimary: true });
		expect((await read(privateCopy)).isPrimary).toBe(false);
		expect(await primaryRows()).toEqual([{ id: guestCv }]);
	});

	it("moves several guest resumes with only the guest's primary, never the target's role", async () => {
		const main = await create("priya", "Main");
		await publish(main, "priya");
		const notes = await create("guest", "Notes");
		const guestCv = await create("guest", "Guest CV");
		await publish(guestCv, "guest");

		await expect(linkAnonymousAccount({ fromUserId: "guest", toUserId: "priya" })).resolves.toBeUndefined();

		expect(await ownership(notes)).toEqual({ userId: "priya", isPrimary: false });
		expect(await ownership(guestCv)).toEqual({ userId: "priya", isPrimary: false });
		expect(await primaryRows()).toEqual([{ id: main }]);
	});

	it("keeps exactly one primary when another first publish claims the role during the move", async () => {
		const claimed = await create("priya", "Claimed");
		const guestCv = await create("guest", "Guest CV");
		await publish(guestCv, "guest");
		const holder = await admin.connect();
		let linked: ReturnType<typeof linkAnonymousAccount> | undefined;
		try {
			await holder.query("BEGIN");
			// Another first publish's exact conditional claim, not yet committed when the move reaches the role.
			await holder.query(
				`UPDATE ${schemaName}.resume SET is_primary = true, is_public = true WHERE id = $1 AND user_id = 'priya' AND NOT EXISTS (SELECT 1 FROM ${schemaName}.resume o WHERE o.user_id = 'priya' AND o.is_primary)`,
				[claimed],
			);
			linked = linkAnonymousAccount({ fromUserId: "guest", toUserId: "priya" });
			await waitForLocks(1);
			await holder.query("COMMIT");
		} finally {
			await holder.query("ROLLBACK").catch(() => {});
			holder.release();
		}

		await expect(linked).resolves.toBeUndefined();
		expect(await ownership(guestCv)).toEqual({ userId: "priya", isPrimary: false });
		expect(await primaryRows()).toEqual([{ id: claimed }]);
	});
});
