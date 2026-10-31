import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as tables from "@reactive-resume/db/schema";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";

const fixture = vi.hoisted(() => ({ db: undefined as ReturnType<typeof drizzle> | undefined }));

vi.mock("@reactive-resume/db/client", () => ({
	get db() {
		return fixture.db;
	},
}));
vi.mock("./events", () => ({ publishResumeUpdated: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@reactive-resume/auth/config", () => ({
	auth: { $context: Promise.resolve({ secretConfig: { key: "synthetic-test-key" } }) },
	isCustomOAuthProviderEnabled: () => false,
}));
vi.mock("@reactive-resume/pdf/server", () => ({ createResumePdfFile: vi.fn() }));

const databaseUrl = process.env.INTEGRATIONS_TEST_DATABASE_URL ?? process.env.COVER_LETTER_TEST_DATABASE_URL;

// Real PostgreSQL, opt-in only, in a schema of its own built from the shipped migrations: savepoints, the unique
// slug and primary indexes, and concurrent transactions are what's under test.
describe.skipIf(!databaseUrl)("resume addresses and the primary resume", () => {
	let resumes: typeof import("./service").resumeService;
	let documents: typeof import("../documents/service").documentsService;
	let findResume: typeof import("./slugs").findResume;
	let checkSlug: typeof import("./slugs").checkSlug;
	let admin: Pool;
	let pool: Pool;
	const schemaName = `resume_address_${randomUUID().replaceAll("-", "")}`;
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
		documents = (await import("../documents/service")).documentsService;
		findResume = (await import("./slugs")).findResume;
		checkSlug = (await import("./slugs")).checkSlug;
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
				["priya", "other"].map((id) => ({
					id,
					name: id,
					email: `${id}@example.test`,
					username: id,
					displayUsername: id,
				})),
			);
	});

	const create = (name: string, extra: { autoName?: boolean; slug?: string; userId?: string } = {}) =>
		resumes.create({ userId: "priya", name, tags: [], locale: "en-US", ...extra });
	const read = (id: string) => resumes.getById({ id, userId: "priya" });
	const withHeadline = async (id: string, headline: string) => {
		const current = await read(id);
		const data = structuredClone(current.data);
		data.basics.headline = headline;
		return resumes.update({ id, userId: "priya", data, expectedUpdatedAt: current.updatedAt });
	};
	const publish = (id: string, extra: { isPrimary?: boolean } = {}) =>
		resumes.update({ id, userId: "priya", isPublic: true, ...extra });
	// What a visitor's address opens: as the public web page looks it up, published resumes only.
	const opensAt = async (match: { slug: string } | { primary: true }) =>
		(await findResume({ username: "priya", ...match }, { id: tables.resume.id }, eq(tables.resume.isPublic, true)))?.id;

	const waitForLocks = async (count: number) => {
		for (let attempt = 0; attempt < 400; attempt++) {
			const { rows } = await admin.query<{ count: number }>(
				"SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'",
				[schemaName],
			);
			if ((rows[0]?.count ?? 0) >= count) return;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		throw new Error(`Expected ${count} address writes to wait on the held row.`);
	};
	// One statement is running and it is the one blocked by the holder: any concurrent unblocked read has finished.
	const waitForOnlyBlockedStatement = async () => {
		for (let attempt = 0; attempt < 400; attempt++) {
			const { rows } = await admin.query<{ total: number; blocked: number }>(
				"SELECT count(*)::int AS total, count(*) filter (where wait_event_type = 'Lock')::int AS blocked FROM pg_stat_activity WHERE application_name = $1 AND state = 'active'",
				[schemaName],
			);
			if (rows[0]?.total === 1 && rows[0]?.blocked === 1) return;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		throw new Error("Expected only the blocked statement to remain active.");
	};
	const settle = <T>(write: Promise<T>) =>
		write.then(
			(value) => ({ ok: true as const, value }),
			(error: unknown) => ({ ok: false as const, error }),
		);

	describe("an app-made address follows the name until the resume is published", () => {
		it("starts a blank resume at a neutral address, whatever language its default name is in", async () => {
			const english = await create("Untitled resume", { autoName: true });
			const arabic = await create("سيرة ذاتية بدون عنوان", { autoName: true });
			expect((await read(english)).slug).toBe("resume");
			expect((await read(arabic)).slug).toBe("resume-2");
		});

		it("keeps the neutral address when a headline has no writable characters", async () => {
			const id = await create("Untitled resume", { autoName: true });
			await expect(withHeadline(id, "计算机科学学生")).resolves.toMatchObject({
				name: "计算机科学学生",
				slug: "resume",
			});
			await expect(withHeadline(id, "🚀🚀")).resolves.toMatchObject({ name: "🚀🚀", slug: "resume" });
		});

		it("suggests another free address, never the requesting resume's own current one", async () => {
			const mine = await create("Mine", { slug: "foo-2" });
			await create("Holder", { slug: "foo" });
			await expect(checkSlug({ userId: "priya", resumeId: mine, slug: "foo" })).resolves.toEqual({
				status: "taken",
				takenBy: "Holder",
				suggestion: "foo-3",
			});
			// An invalid spelling that normalizes to the requesting resume's own address also moves past it.
			await expect(checkSlug({ userId: "priya", resumeId: mine, slug: "Foo 2" })).resolves.toMatchObject({
				status: "invalid",
				suggestion: "foo-2-2",
			});
		});

		it("names the address after the headline, then keeps it once published, and the address opens the page", async () => {
			const id = await create("Untitled resume", { autoName: true });
			expect(await opensAt({ slug: "resume" })).toBeUndefined();
			const followed = await withHeadline(id, "Computer science student");
			expect(followed).toMatchObject({ name: "Computer science student", slug: "computer-science-student" });
			// The returned version is the stored one, so the editor's next save passes its version check.
			await expect(withHeadline(id, "Computer science student, final year")).resolves.toMatchObject({
				slug: "computer-science-student-final-year",
			});

			const published = await publish(id);
			expect(published.slug).toBe("computer-science-student-final-year");
			expect(await opensAt({ slug: "computer-science-student-final-year" })).toBe(id);

			const renamed = await withHeadline(id, "Software engineer");
			expect(renamed).toMatchObject({ name: "Software engineer", slug: "computer-science-student-final-year" });
			// Unpublishing doesn't make it follow again: someone may still have the link.
			await resumes.update({ id, userId: "priya", isPublic: false });
			await expect(withHeadline(id, "Data analyst")).resolves.toMatchObject({
				slug: "computer-science-student-final-year",
			});
		});

		it("follows a hand-typed rename of a private copy, from the editor or the library", async () => {
			const id = await create("Game dev base (Copy)");
			expect((await read(id)).slug).toBe("game-dev-base-copy");

			await documents.rename({ type: "resume", id, userId: "priya", name: "Valve tools engineer" });
			expect(await read(id)).toMatchObject({ name: "Valve tools engineer", slug: "valve-tools-engineer" });
			await expect(resumes.update({ id, userId: "priya", name: "Valve tools lead" })).resolves.toMatchObject({
				slug: "valve-tools-lead",
			});
			// Nobody was sent a private resume's address, so no redirect is kept for it.
			const redirects = await db()
				.select()
				.from(tables.resumeSlugRedirect)
				.where(eq(tables.resumeSlugRedirect.resumeId, id));
			expect(redirects).toEqual([]);
		});

		it("keeps an address chosen by hand, and every address made before this policy", async () => {
			const chosen = await create("Untitled resume", { autoName: true });
			await resumes.update({ id: chosen, userId: "priya", slug: "priya-cv" });
			await expect(withHeadline(chosen, "Computer science student")).resolves.toMatchObject({ slug: "priya-cv" });

			const given = await create("Portfolio", { slug: "portfolio-2026" });
			await expect(resumes.update({ id: given, userId: "priya", name: "Design" })).resolves.toMatchObject({
				slug: "portfolio-2026",
			});

			const older = await create("Older resume");
			await db().update(tables.resume).set({ autoSlug: false }).where(eq(tables.resume.id, older));
			await expect(resumes.update({ id: older, userId: "priya", name: "Renamed" })).resolves.toMatchObject({
				slug: "older-resume",
			});
		});

		it("never takes an address that another resume, or another resume's old link, still opens", async () => {
			const moved = await create("Mover", { slug: "computer-science-student" });
			await resumes.update({ id: moved, userId: "priya", slug: "moved-on" });
			const holder = await create("Holder", { slug: "computer-science-student-2" });
			await Promise.all([publish(moved), publish(holder)]);

			const id = await create("Untitled resume", { autoName: true });
			await expect(withHeadline(id, "Computer science student")).resolves.toMatchObject({
				slug: "computer-science-student-3",
			});
			// The earlier link still reaches the resume that moved; the taken one still opens its holder.
			expect(await opensAt({ slug: "computer-science-student" })).toBe(moved);
			expect(await opensAt({ slug: "computer-science-student-2" })).toBe(holder);
			// Another account's addresses don't count.
			await resumes.create({ userId: "other", name: "Data analyst", tags: [], locale: "en-US" });
			await expect(withHeadline(id, "Data analyst")).resolves.toMatchObject({ slug: "data-analyst" });
		});

		it("never takes an address that becomes another resume's old link as both change at once", async () => {
			const mover = await create("Mover", { slug: "data-analyst" });
			await publish(mover);
			const { recordSlugChange } = await import("./slugs");
			const holderPool = new Pool({ connectionString: databaseUrl, max: 1, options: `-c search_path=${schemaName}` });
			const holderDb = drizzle({ client: holderPool, relations: tables.authRelations });
			let created: ReturnType<typeof settle<string>> | undefined;
			try {
				await holderDb.transaction(async (tx) => {
					// Hold the resume table so the generated-address reads run against one fixed point in time.
					await tx.execute(sql.raw(`LOCK TABLE ${schemaName}.resume IN ACCESS EXCLUSIVE MODE`));
					created = settle(create("Data analyst"));
					// The redirect read, if it runs before the resume read, is now finished; the resume read is waiting.
					await waitForOnlyBlockedStatement();
					// The owner hand-changes the mover's address while the create is waiting.
					await tx.update(tables.resume).set({ slug: "moved-on", autoSlug: false }).where(eq(tables.resume.id, mover));
					await recordSlugChange(tx, { userId: "priya", resumeId: mover, from: "data-analyst", to: "moved-on" });
				});
			} finally {
				await holderPool.end();
			}
			if (!created) throw new Error("The generated-address write did not start.");
			const result = await created;
			if (!result.ok) throw result.error;
			// The new address must not shadow the mover's 30-day link.
			expect((await read(result.value)).slug).toBe("data-analyst-2");
			await publish(result.value);
			expect(await opensAt({ slug: "data-analyst" })).toBe(mover);
			expect(await opensAt({ slug: "data-analyst-2" })).toBe(result.value);
		});

		it.each(["publish", "choose"] as const)(
			"keeps an address frozen by a concurrent %s when the library renames the resume",
			async (operation) => {
				const id = await create("Untitled resume", { autoName: true });
				const holder = await admin.connect();
				const writes: Promise<unknown>[] = [];
				try {
					await holder.query("BEGIN");
					await holder.query(`SELECT id FROM ${schemaName}.resume WHERE id = $1 FOR UPDATE`, [id]);
					const frozen = settle(
						resumes.update({
							id,
							userId: "priya",
							...(operation === "publish" ? { isPublic: true } : { slug: "priya-cv" }),
						}),
					);
					writes.push(frozen);
					await waitForLocks(1);
					const renamed = settle(documents.rename({ type: "resume", id, userId: "priya", name: "Data analyst" }));
					writes.push(renamed);
					await waitForLocks(2);
					await holder.query("COMMIT");
					const [saved, rename] = await Promise.all([frozen, renamed]);
					if (!saved.ok) throw saved.error;
					if (!rename.ok) throw rename.error;
					expect(await read(id)).toMatchObject({ name: "Data analyst", slug: saved.value.slug });
					if (operation === "publish") expect(await opensAt({ slug: saved.value.slug })).toBe(id);
					else expect(saved.value.slug).toBe("priya-cv");
				} finally {
					await holder.query("ROLLBACK");
					holder.release();
					await Promise.all(writes);
				}
			},
		);

		it("lets two resumes that follow the same name at once both save", async () => {
			const first = await create("Untitled resume", { autoName: true });
			const second = await create("Untitled resume", { autoName: true });
			const saved = await Promise.all([withHeadline(first, "Nurse"), withHeadline(second, "Nurse")]);

			expect(saved.map((resume) => resume.name)).toEqual(["Nurse", "Nurse"]);
			const slugs = saved.map((resume) => resume.slug);
			expect(new Set(slugs).size).toBe(2);
			expect(slugs.some((slug) => slug === "nurse" || slug === "nurse-2")).toBe(true);
		});
	});

	describe("publishing makes the account's first web page its primary resume", () => {
		it("opens the only published resume at the short link", async () => {
			const id = await create("Untitled resume", { autoName: true });
			expect(await opensAt({ primary: true })).toBeUndefined();
			await expect(publish(id)).resolves.toMatchObject({ isPublic: true, isPrimary: true });
			expect(await opensAt({ primary: true })).toBe(id);

			// Unpublished, it stays primary and the short link says it isn't shared.
			await expect(resumes.update({ id, userId: "priya", isPublic: false })).resolves.toMatchObject({
				isPrimary: true,
			});
		});

		it("leaves an existing primary in place, published or not", async () => {
			const first = await create("First");
			await publish(first);
			const second = await create("Second");
			await expect(publish(second)).resolves.toMatchObject({ isPrimary: false });

			await resumes.update({ id: first, userId: "priya", isPublic: false });
			const third = await create("Third");
			await expect(publish(third)).resolves.toMatchObject({ isPrimary: false });
			expect(await opensAt({ primary: true })).toBeUndefined();
			expect((await read(first)).isPrimary).toBe(true);
		});

		it("respects an explicit choice and only acts when a resume is first published", async () => {
			const declined = await create("Declined");
			await expect(publish(declined, { isPrimary: false })).resolves.toMatchObject({ isPrimary: false });
			// Already public: saving it again isn't a publish, so the switch the owner left off stays off.
			await expect(publish(declined)).resolves.toMatchObject({ isPrimary: false });

			const turnedOff = await create("Turned off");
			await publish(turnedOff);
			await resumes.update({ id: turnedOff, userId: "priya", isPrimary: false });
			await expect(publish(turnedOff)).resolves.toMatchObject({ isPrimary: false });
		});

		it("gives the role to exactly one of two resumes published at once", async () => {
			const ids = await Promise.all([create("One"), create("Two"), create("Three")]);
			const published = await Promise.all(ids.map((id) => publish(id)));

			expect(published.every((resume) => resume.isPublic)).toBe(true);
			expect(published.filter((resume) => resume.isPrimary)).toHaveLength(1);
			const rows = await db()
				.select({ id: tables.resume.id })
				.from(tables.resume)
				.where(and(eq(tables.resume.userId, "priya"), eq(tables.resume.isPrimary, true)));
			expect(rows).toHaveLength(1);
		});

		it("answers Make primary with a retryable conflict, not a 500, when a first publish claims at the same moment", async () => {
			const chosen = await create("Chosen");
			await publish(chosen, { isPrimary: false });
			const claimed = await create("Claimed");
			const holder = await admin.connect();
			let explicit: ReturnType<typeof settle<unknown>> | undefined;
			try {
				await holder.query("BEGIN");
				// Another first publish's exact conditional claim, not yet committed.
				await holder.query(
					`UPDATE ${schemaName}.resume SET is_primary = true, is_public = true WHERE id = $1 AND user_id = 'priya' AND NOT EXISTS (SELECT 1 FROM ${schemaName}.resume o WHERE o.user_id = 'priya' AND o.is_primary)`,
					[claimed],
				);
				explicit = settle(resumes.update({ id: chosen, userId: "priya", isPrimary: true }));
				await waitForLocks(1);
				await holder.query("COMMIT");
			} finally {
				await holder.query("ROLLBACK").catch(() => {});
				holder.release();
			}

			if (!explicit) throw new Error("The explicit primary write did not start.");
			const result = await explicit;
			expect(result.ok).toBe(false);
			if (result.ok) throw new Error("Expected the explicit primary change to lose the unique-index race.");
			expect(result.error).toMatchObject({ code: "RESUME_PRIMARY_CONFLICT", status: 409 });
			// Nothing was written, so trying again takes the role from the resume that won.
			await expect(resumes.update({ id: chosen, userId: "priya", isPrimary: true })).resolves.toMatchObject({
				isPrimary: true,
			});
			const rows = await db()
				.select({ id: tables.resume.id })
				.from(tables.resume)
				.where(and(eq(tables.resume.userId, "priya"), eq(tables.resume.isPrimary, true)));
			expect(rows).toEqual([{ id: chosen }]);
		});

		it("doesn't count another account's primary, or touch another account's resume", async () => {
			const theirs = await resumes.create({ userId: "other", name: "Theirs", tags: [], locale: "en-US" });
			await resumes.update({ id: theirs, userId: "other", isPublic: true });
			const mine = await create("Mine");
			await expect(publish(mine)).resolves.toMatchObject({ isPrimary: true });
			await expect(resumes.update({ id: mine, userId: "other", isPublic: true })).rejects.toMatchObject({
				code: "NOT_FOUND",
			});
		});
	});

	it("starts copies and resumes from files with an address that follows the name", async () => {
		const original = await create("Base");
		const copy = await resumes.create({
			userId: "priya",
			name: "Base (Copy)",
			tags: [],
			locale: "en-US",
			data: structuredClone(defaultResumeData),
		});
		expect((await read(original)).slug).toBe("base");
		expect((await read(copy)).slug).toBe("base-copy");
		await documents.rename({ type: "resume", id: copy, userId: "priya", name: "Base" });
		expect((await read(copy)).slug).toBe("base-2");
	});
});
