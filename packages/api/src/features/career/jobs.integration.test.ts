import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as tables from "@reactive-resume/db/schema";
import { careerScheduleInputSchema } from "@reactive-resume/schema/career";

const fixture = vi.hoisted(() => ({
	db: undefined as ReturnType<typeof drizzle> | undefined,
	search: vi.fn<typeof import("../applications/posting").searchJobPostings>(),
	read: vi.fn<typeof import("../applications/posting").readOpenPosting>(),
	email: vi.fn<typeof import("@reactive-resume/email/transport").sendCareerNotification>(),
	generate: vi.fn<typeof import("./generate").generateCareer>(),
	smtp: false,
	env: { CRON_SECRET: undefined as string | undefined },
}));
vi.mock("@reactive-resume/db/client", () => ({
	get db() {
		return fixture.db;
	},
}));
vi.mock("@reactive-resume/env/server", async () => {
	const actual = await vi.importActual<typeof import("@reactive-resume/env/server")>("@reactive-resume/env/server");
	return {
		...actual,
		env: {
			...actual.env,
			APP_URL: "http://localhost:3000",
			CLOUDFLARE: false,
			get CRON_SECRET() {
				return fixture.env.CRON_SECRET;
			},
			get SMTP_HOST() {
				return fixture.smtp ? "smtp.example.test" : undefined;
			},
			get SMTP_USER() {
				return fixture.smtp ? "rx106-test" : undefined;
			},
			get SMTP_PASS() {
				return fixture.smtp ? "synthetic-only" : undefined;
			},
			get SMTP_FROM() {
				return fixture.smtp ? "rx106@example.test" : undefined;
			},
		},
	};
});
// The external-service boundary is deterministic; queue ownership and all persistence remain real.
vi.mock("../applications/posting", () => ({ searchJobPostings: fixture.search, readOpenPosting: fixture.read }));
vi.mock("../web-access/credentials", () => ({
	webAccessService: {
		canSearch: () => true,
		resolve: async () => ({ provider: "tavily", apiKey: "synthetic-web-key" }),
	},
}));
vi.mock("@reactive-resume/email/transport", () => ({ sendCareerNotification: fixture.email }));
// No live AI: the briefing writer is the boundary; the provider check only has to find the connection.
vi.mock("./generate", () => ({ generateCareer: fixture.generate }));
vi.mock("../ai-providers/service", () => ({
	aiProvidersService: { getRunnableById: async () => ({ recipientVersion: "fixture-revision" }) },
}));

function getDb() {
	if (!fixture.db) throw new Error("Test database is not initialized.");
	return fixture.db;
}

const databaseUrl = process.env.INTEGRATIONS_TEST_DATABASE_URL ?? process.env.COVER_LETTER_TEST_DATABASE_URL;
const results = [
	{
		title: "Reliability engineer",
		url: "https://example.test/jobs/42?utm_source=search#details",
		description: "Maintain reliable services.",
	},
	{
		title: "Reliability engineer",
		url: "https://example.test/jobs/42?fbclid=tracking",
		description: "Maintain reliable services.",
	},
];
const posting = {
	page: {
		role: "Reliability engineer",
		company: "ACME",
		location: "Berlin",
		description: "Maintain reliable services.",
		language: "",
		closesAt: "",
	},
	text: "Maintain reliable services.",
	company: "",
};

describe.skipIf(!databaseUrl)("durable career scheduling", () => {
	let jobs: typeof import("./jobs").careerJobs;
	let run: typeof import("./jobs").runCareerJobs;
	let admin: Pool;
	let pool: Pool;
	const schemaName = `career_jobs_test_${randomUUID().replaceAll("-", "")}`;

	beforeAll(async () => {
		admin = new Pool({ connectionString: databaseUrl });
		await admin.query(`CREATE SCHEMA ${schemaName}`);
		pool = new Pool({
			connectionString: databaseUrl,
			options: `-c search_path=${schemaName} -c statement_timeout=10000`,
		});
		fixture.db = drizzle({ client: pool });
		const migrations = new URL("../../../../../migrations/", import.meta.url);
		const directories = (await readdir(migrations, { withFileTypes: true }))
			.filter((entry) => entry.isDirectory() && /^\d+_/.test(entry.name))
			.map((entry) => entry.name)
			.sort();
		for (const directory of directories) {
			const file = new URL(`${directory}/migration.sql`, migrations);
			if (existsSync(file)) await pool.query((await readFile(file, "utf8")).replaceAll('"public".', ""));
		}
		({ careerJobs: jobs, runCareerJobs: run } = await import("./jobs"));
	}, 30_000);

	afterAll(async () => {
		await pool?.end();
		await admin?.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
		await admin?.end();
	});

	beforeEach(async () => {
		vi.stubEnv("VERCEL", "");
		fixture.env.CRON_SECRET = undefined;
		fixture.smtp = false;
		fixture.search.mockReset().mockResolvedValue(results);
		fixture.read.mockReset().mockResolvedValue(posting);
		fixture.email.mockReset().mockResolvedValue(true);
		fixture.generate.mockReset().mockResolvedValue({ item: null, answer: null });
		await pool.query('TRUNCATE "user" CASCADE');
		await getDb()
			.insert(tables.user)
			.values({
				id: "alice",
				name: "Alice Example",
				email: "alice@example.test",
				username: `${schemaName}-alice`,
				displayUsername: `${schemaName}-alice`,
				emailVerified: true,
			});
	});

	it("creates an inactive follow-up when the deployment has no career runner", async () => {
		vi.stubEnv("VERCEL", "1");
		const { applicationService } = await import("../applications/service");
		const id = await applicationService.create({
			userId: "alice",
			company: "No runner",
			role: "Engineer",
			followUpAt: due(),
		});
		expect(await jobs.list("alice")).toMatchObject([{ applicationId: id, enabled: false }]);
	});

	it("enforces the account schedule cap atomically for application follow-ups", async () => {
		await getDb()
			.insert(tables.careerSchedule)
			.values(
				Array.from({ length: 99 }, (_, index) => ({
					userId: "alice",
					kind: "discovery" as const,
					query: `Search ${index}`,
					timezone: "UTC",
					nextRunAt: due(),
					enabled: false,
				})),
			);
		const { applicationService } = await import("../applications/service");
		const attempts = await Promise.allSettled(
			["One", "Two"].map((company) =>
				applicationService.create({ userId: "alice", company, role: "Engineer", followUpAt: due() }),
			),
		);
		expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
		expect(attempts.find((attempt) => attempt.status === "rejected")).toMatchObject({
			reason: { code: "BAD_REQUEST" },
		});
		expect(await jobs.list("alice")).toHaveLength(100);
		expect(await getDb().select().from(tables.application)).toHaveLength(1);
	});

	it.each(["failed", "canceled"] as const)(
		"owner migration retains older completed logical-day delivery behind newer %s history",
		async (status) => {
			const { applicationService } = await import("../applications/service");
			const day = new Date("2026-10-30T00:00:00Z");
			const id = await applicationService.create({
				userId: "alice",
				company: "Completed history",
				role: "Engineer",
				followUpAt: day,
				followUpDateOnly: true,
			});
			const [schedule] = await jobs.list("alice");
			if (!schedule) throw new Error("Missing follow-up");
			await getDb()
				.update(tables.careerSchedule)
				.set({ nextRunAt: new Date("2026-10-30T08:00:00Z"), lastQueuedAt: new Date("2026-10-30T08:00:00Z") })
				.where(eq(tables.careerSchedule.id, schedule.id));
			await getDb()
				.insert(tables.careerJob)
				.values([
					{
						id: "older-completed",
						userId: "alice",
						scheduleId: schedule.id,
						dueAt: new Date("2026-10-30T08:00:00Z"),
						status: "completed",
						createdAt: new Date("2026-10-30T08:00:00Z"),
					},
					{
						id: "newer-history",
						userId: "alice",
						scheduleId: schedule.id,
						dueAt: new Date("2026-10-30T09:00:00Z"),
						status,
						createdAt: new Date("2026-10-30T09:00:00Z"),
					},
				]);
			const history = await getDb().select().from(tables.careerJob).orderBy(tables.careerJob.id);
			const sql = await readFile(
				new URL("../../../../../migrations/20261031160926_rx106_follow_up_owner/migration.sql", import.meta.url),
				"utf8",
			);
			await pool.query(sql.slice(sql.indexOf("--> statement-breakpoint") + "--> statement-breakpoint".length));
			expect(await jobs.list("alice")).toMatchObject([
				{ applicationId: id, lastQueuedAt: new Date("2026-10-30T09:00:00Z") },
			]);
			expect(await getDb().select().from(tables.careerJob).orderBy(tables.careerJob.id)).toEqual(history);
			await run();
			expect(await getDb().select().from(tables.careerJob).orderBy(tables.careerJob.id)).toEqual(history);
		},
	);

	it("recovery cancels pending duplicates behind completed history while preserving a distinct explicit time", async () => {
		const { applicationService } = await import("../applications/service");
		for (const dateOnly of [true, false]) {
			const at = new Date(dateOnly ? "2026-10-30T00:00:00Z" : "2026-10-30T16:00:00Z");
			const id = await applicationService.create({
				userId: "alice",
				company: String(dateOnly),
				role: "Engineer",
				followUpAt: at,
				followUpDateOnly: dateOnly,
			});
			const schedule = (await jobs.list("alice")).find((row) => row.applicationId === id);
			if (!schedule) throw new Error("Missing follow-up");
			await getDb()
				.update(tables.careerSchedule)
				.set({ lastQueuedAt: dateOnly ? null : at })
				.where(eq(tables.careerSchedule.id, schedule.id));
			await getDb()
				.insert(tables.careerJob)
				.values([
					{
						id: `done-${dateOnly}`,
						userId: "alice",
						scheduleId: schedule.id,
						dueAt: new Date("2026-10-30T08:00:00Z"),
						status: "completed",
						createdAt: new Date("2026-10-30T08:00:00Z"),
					},
					{
						id: `queued-${dateOnly}`,
						userId: "alice",
						scheduleId: schedule.id,
						dueAt: schedule.nextRunAt,
						status: "queued",
						createdAt: new Date("2026-10-30T09:00:00Z"),
					},
				]);
		}
		const sql = await readFile(
			new URL(
				"../../../../../migrations/20261101090000_rx106_follow_up_watermark_recovery/migration.sql",
				import.meta.url,
			),
			"utf8",
		);
		await pool.query(sql);
		expect(
			await getDb()
				.select({ id: tables.careerJob.id, status: tables.careerJob.status })
				.from(tables.careerJob)
				.orderBy(tables.careerJob.id),
		).toEqual([
			{ id: "done-false", status: "completed" },
			{ id: "done-true", status: "completed" },
			{ id: "queued-false", status: "queued" },
			{ id: "queued-true", status: "canceled" },
		]);
		const rows = await jobs.list("alice");
		expect(rows.find((row) => row.nextRunAt.getUTCHours() === 9)?.lastQueuedAt).toEqual(
			new Date("2026-10-30T09:00:00Z"),
		);
		expect(rows.find((row) => row.nextRunAt.getUTCHours() === 16)?.lastQueuedAt).toBeNull();
		const snapshot = await getDb().select().from(tables.careerJob).orderBy(tables.careerJob.id);
		await pool.query(sql);
		expect(await getDb().select().from(tables.careerJob).orderBy(tables.careerJob.id)).toEqual(snapshot);
	});

	it("note-only edits preserve completed follow-up occurrence, email and job history", async () => {
		fixture.smtp = true;
		const { applicationService } = await import("../applications/service");
		const id = await applicationService.create({
			userId: "alice",
			company: "Review Repeat",
			role: "Engineer",
			status: "applied",
		});
		const at = due();
		await jobs.save(
			"alice",
			careerScheduleInputSchema.parse({
				kind: "follow-up",
				applicationId: id,
				nextRunAt: at,
				timezone: "UTC",
				query: "Original note",
			}),
		);
		await getDb().update(tables.careerSchedule).set({ email: true }).where(eq(tables.careerSchedule.applicationId, id));
		await run();
		const beforeJobs = await getDb().select().from(tables.careerJob);
		expect(await jobs.notifications("alice")).toHaveLength(1);
		await applicationService.update({ userId: "alice", id, followUpNote: "Original note" });
		await run();
		expect(await jobs.notifications("alice")).toHaveLength(1);
		await applicationService.update({ userId: "alice", id, followUpNote: "Corrected note" });
		const [schedule] = await jobs.list("alice");
		if (!schedule) throw new Error("Missing completed schedule");
		await jobs.save("alice", {
			...careerScheduleInputSchema.parse(schedule),
			id: schedule.id,
			query: "Today note edit",
		});
		await run();
		const notices = await jobs.notifications("alice");
		const afterJobs = await getDb().select().from(tables.careerJob);
		expect(fixture.email).toHaveBeenCalledTimes(1);
		expect(afterJobs).toEqual(beforeJobs);
		expect(notices).toHaveLength(1);
		expect(afterJobs.map((row) => row.id)).toContain(beforeJobs[0]?.id);
	});
	it("old-client unchanged exact-midnight echo preserves discriminator", async () => {
		const { applicationService } = await import("../applications/service");
		await getDb().update(tables.user).set({ timezone: "Pacific/Honolulu" }).where(eq(tables.user.id, "alice"));
		const at = new Date("2030-01-03T00:00:00Z");
		const id = await applicationService.create({
			userId: "alice",
			company: "Exact midnight",
			role: "Engineer",
			followUpAt: at,
			followUpDateOnly: false,
		});
		await applicationService.update({ userId: "alice", id, followUpAt: at, followUpNote: "Old client note edit" });
		const application = await applicationService.getById({ userId: "alice", id });

		expect(application.followUpDateOnly).toBe(false);
		expect((await jobs.list("alice"))[0]?.nextRunAt).toEqual(at);
	});

	it("logical-day delivery follows account timezone without moving exact times", async () => {
		const { applicationService } = await import("../applications/service");
		await getDb().update(tables.user).set({ timezone: "Asia/Tokyo" }).where(eq(tables.user.id, "alice"));
		const at = new Date("2030-01-03T00:00:00Z");
		const logical = await applicationService.create({
			userId: "alice",
			company: "Logical",
			role: "Engineer",
			followUpAt: at,
			followUpDateOnly: true,
		});
		const exact = await applicationService.create({
			userId: "alice",
			company: "Exact",
			role: "Engineer",
			followUpAt: at,
			followUpDateOnly: false,
		});
		const original = (await jobs.list("alice")).find((row) => row.applicationId === logical);
		if (!original) throw new Error("Missing logical-day schedule");
		await getDb()
			.insert(tables.careerJob)
			.values({
				id: "clock-running",
				userId: "alice",
				scheduleId: original.id,
				dueAt: at,
				status: "running",
				lease: "clock-lease",
				leaseUntil: new Date(Date.now() + 60000),
			});
		await getDb()
			.update(tables.careerSchedule)
			.set({ lastQueuedAt: at })
			.where(eq(tables.careerSchedule.id, original.id));
		await getDb().update(tables.user).set({ timezone: "Pacific/Honolulu" }).where(eq(tables.user.id, "alice"));
		const rows = await jobs.list("alice");
		expect(rows.find((row) => row.applicationId === logical)).toMatchObject({
			nextRunAt: new Date("2030-01-03T19:00:00Z"),
			timezone: "Pacific/Honolulu",
			lastQueuedAt: null,
		});
		expect(rows.find((row) => row.applicationId === exact)).toMatchObject({ nextRunAt: at, timezone: "Asia/Tokyo" });
		expect(await applicationService.getById({ userId: "alice", id: logical })).toMatchObject({
			followUpAt: at,
			followUpDateOnly: true,
		});
		expect((await getDb().select().from(tables.careerJob))[0]).toMatchObject({
			id: "clock-running",
			status: "canceled",
			lease: null,
		});
	});
	it("account clock changes retain a completed logical-day occurrence through repeated timezone changes", async () => {
		const { applicationService } = await import("../applications/service");
		const raw = new Date();
		raw.setUTCHours(0, 0, 0, 0);
		raw.setUTCDate(raw.getUTCDate() - 1);
		const id = await applicationService.create({
			userId: "alice",
			company: "Delivered day",
			role: "Engineer",
			status: "applied",
			followUpAt: raw,
			followUpDateOnly: true,
		});
		await run();
		const history = await getDb().select().from(tables.careerJob);
		expect(history).toHaveLength(1);
		expect(history[0]?.status).toBe("completed");
		for (const timezone of ["Pacific/Honolulu", "Asia/Tokyo", "UTC"]) {
			await getDb().update(tables.user).set({ timezone }).where(eq(tables.user.id, "alice"));
			await applicationService.update({ userId: "alice", id, followUpNote: "Updated metadata" });
			await run();
			expect(await jobs.notifications("alice")).toHaveLength(1);
			expect(await getDb().select().from(tables.careerJob)).toEqual(history);
		}
	});
	it.each(["queued", "running"] as const)(
		"note-only edits retain %s occurrence and lease, then deliver updated note once",
		async (status) => {
			fixture.smtp = true;
			const { applicationService } = await import("../applications/service");
			const id = await applicationService.create({
				userId: "alice",
				company: "Pending note",
				role: "Engineer",
				status: "applied",
			});
			const at = due();
			const saved = await jobs.save(
				"alice",
				careerScheduleInputSchema.parse({
					kind: "follow-up",
					applicationId: id,
					nextRunAt: at,
					timezone: "UTC",
					query: "Original",
					email: true,
				}),
			);
			await getDb()
				.update(tables.careerSchedule)
				.set({ lastQueuedAt: at })
				.where(eq(tables.careerSchedule.id, saved.id));
			await getDb()
				.insert(tables.careerJob)
				.values({
					id: "kept-job",
					userId: "alice",
					scheduleId: saved.id,
					dueAt: at,
					status,
					lease: status === "running" ? "kept-lease" : null,
					leaseUntil: status === "running" ? new Date(Date.now() + 60000) : null,
				});
			const before = await getDb().select().from(tables.careerJob);
			await applicationService.update({ userId: "alice", id, followUpNote: "Latest note" });
			await jobs.save("alice", { ...careerScheduleInputSchema.parse(saved), id: saved.id, query: "Latest note" });
			expect(await getDb().select().from(tables.careerJob)).toEqual(before);
			expect((await jobs.list("alice"))[0]).toMatchObject({ query: "Latest note", lastQueuedAt: at });
			if (status === "running")
				await getDb()
					.update(tables.careerJob)
					.set({ leaseUntil: expired() })
					.where(eq(tables.careerJob.id, "kept-job"));
			await run();
			await run();
			expect(await jobs.notifications("alice")).toMatchObject([
				{ key: "kept-job", notice: { type: "followup", note: "Latest note" } },
			]);
			expect(fixture.email).toHaveBeenCalledTimes(1);
			expect((await getDb().select().from(tables.careerJob))[0]).toMatchObject({ id: "kept-job", status: "completed" });
		},
	);

	it("publication reads the note that won under application locks even after an earlier schedule read", async () => {
		const { applicationService } = await import("../applications/service");
		const id = await applicationService.create({
			userId: "alice",
			company: "In-flight metadata",
			role: "Engineer",
			status: "applied",
		});
		const at = due();
		await jobs.save(
			"alice",
			careerScheduleInputSchema.parse({
				kind: "follow-up",
				applicationId: id,
				nextRunAt: at,
				timezone: "UTC",
				query: "Stale snapshot",
			}),
		);
		let release = () => {};
		let observed = () => {};
		const barrier = new Promise<void>((resolve) => {
			release = resolve;
		});
		const read = new Promise<void>((resolve) => {
			observed = resolve;
		});
		const original = pool.query;
		let paused = false;
		const spy = vi.spyOn(pool, "query").mockImplementation(((...args: unknown[]) => {
			const result = Reflect.apply(original, pool, args);
			const query = args[0] as { text?: string } | string;
			const text = typeof query === "string" ? query : (query.text ?? "");
			if (!paused && text.includes('from "career_schedule"') && !text.includes("for update")) {
				paused = true;
				return Promise.resolve(result).then(async (rows) => {
					observed();
					await barrier;
					return rows;
				});
			}
			return result;
		}) as typeof pool.query);
		let running: Promise<unknown> | undefined;
		try {
			running = run();
			await read;
			expect((await getDb().select().from(tables.careerJob))[0]?.status).toBe("running");
			await applicationService.update({ userId: "alice", id, followUpNote: "Winning note" });
			release();
			await running;
			expect(await jobs.notifications("alice")).toMatchObject([{ notice: { type: "followup", note: "Winning note" } }]);
		} finally {
			release();
			await running;
			spy.mockRestore();
		}
	});
	it("timezone writes reject nonexistent logical days atomically", async () => {
		const { applicationService } = await import("../applications/service");
		const id = await applicationService.create({
			userId: "alice",
			company: "Missing local day",
			role: "Engineer",
			followUpAt: new Date("2011-12-30T00:00:00Z"),
			followUpDateOnly: true,
		});
		const original = await jobs.list("alice");
		await expect(
			getDb().update(tables.user).set({ timezone: "Pacific/Apia" }).where(eq(tables.user.id, "alice")),
		).rejects.toThrow();
		expect((await getDb().select().from(tables.user).where(eq(tables.user.id, "alice")))[0]?.timezone).toBe("UTC");
		expect(await jobs.list("alice")).toEqual(original);
		expect((await applicationService.getById({ userId: "alice", id })).followUpDateOnly).toBe(true);
	});

	it.each(["queued", "running"] as const)(
		"account clock moves %s logical-day delivery without losing or duplicating occurrence",
		async (status) => {
			fixture.smtp = true;
			const { applicationService } = await import("../applications/service");
			await getDb().update(tables.user).set({ timezone: "Asia/Tokyo" }).where(eq(tables.user.id, "alice"));
			const raw = new Date();
			raw.setUTCHours(0, 0, 0, 0);
			raw.setUTCDate(raw.getUTCDate() - 1);
			await applicationService.create({
				userId: "alice",
				company: "Moving clock",
				role: "Engineer",
				status: "applied",
				followUpAt: raw,
				followUpDateOnly: true,
				followUpNote: "Current note",
			});
			const [saved] = await jobs.list("alice");
			if (!saved) throw new Error("Missing schedule");
			await getDb()
				.update(tables.careerSchedule)
				.set({ email: true, lastQueuedAt: raw })
				.where(eq(tables.careerSchedule.id, saved.id));
			await getDb()
				.insert(tables.careerJob)
				.values({
					id: "previous-clock",
					userId: "alice",
					scheduleId: saved.id,
					dueAt: raw,
					status,
					lease: status === "running" ? "previous-lease" : null,
					leaseUntil: status === "running" ? new Date(Date.now() + 60000) : null,
				});
			await getDb().update(tables.user).set({ timezone: "Pacific/Honolulu" }).where(eq(tables.user.id, "alice"));
			await jobs.save("alice", { ...careerScheduleInputSchema.parse(saved), id: saved.id, email: true });
			expect((await getDb().select().from(tables.application))[0]?.followUpDateOnly).toBe(true);
			await run();
			await run();
			const history = await getDb().select().from(tables.careerJob);
			expect(history).toHaveLength(2);
			expect(history.find((row) => row.id === "previous-clock")).toMatchObject({
				status: "canceled",
				lease: null,
				dueAt: raw,
			});
			const expected = new Date(raw.getTime() + 19 * 3600000);
			expect(history.find((row) => row.status === "completed")).toMatchObject({ dueAt: expected });
			expect(await jobs.notifications("alice")).toMatchObject([{ notice: { type: "followup", note: "Current note" } }]);
			expect(fixture.email).toHaveBeenCalledTimes(1);
			await getDb().update(tables.user).set({ timezone: "Asia/Tokyo" }).where(eq(tables.user.id, "alice"));
			await run();
			expect(await jobs.notifications("alice")).toHaveLength(1);
			expect(await getDb().select().from(tables.careerJob)).toEqual(history);
		},
	);

	it("Today note-only edits preserve logical-day intent and completed occurrence across account clocks", async () => {
		const { applicationService } = await import("../applications/service");
		const raw = new Date();
		raw.setUTCHours(0, 0, 0, 0);
		raw.setUTCDate(raw.getUTCDate() - 1);
		const id = await applicationService.create({
			userId: "alice",
			company: "Logical Today note",
			role: "Engineer",
			status: "applied",
			followUpAt: raw,
			followUpDateOnly: true,
		});
		await run();
		const history = await getDb().select().from(tables.careerJob);
		const [schedule] = await jobs.list("alice");
		if (!schedule) throw new Error("Missing logical schedule");
		await jobs.save("alice", {
			...careerScheduleInputSchema.parse(schedule),
			id: schedule.id,
			query: "Today-only note",
		});
		expect(await applicationService.getById({ userId: "alice", id })).toMatchObject({
			followUpAt: raw,
			followUpDateOnly: true,
			followUpNote: "Today-only note",
		});
		await getDb().update(tables.user).set({ timezone: "Pacific/Honolulu" }).where(eq(tables.user.id, "alice"));
		await jobs.save("alice", {
			...careerScheduleInputSchema.parse(schedule),
			id: schedule.id,
			query: "Old-clock note edit",
		});
		expect(await applicationService.getById({ userId: "alice", id })).toMatchObject({
			followUpAt: raw,
			followUpDateOnly: true,
			followUpNote: "Old-clock note edit",
		});
		await run();
		expect(await jobs.notifications("alice")).toHaveLength(1);
		expect(await getDb().select().from(tables.careerJob)).toEqual(history);
	});

	const due = () => new Date(Date.now() - 60_000);
	afterEach(() => vi.unstubAllEnvs());
	const expired = () => new Date(Date.now() - 3_600_000);
	async function schedule(applicationId: string | null = null) {
		return jobs.save(
			"alice",
			careerScheduleInputSchema.parse({
				applicationId,
				kind: "discovery",
				query: "Reliability engineering roles",
				enabled: true,
				timezone: "Europe/Berlin",
				nextRunAt: due(),
				intervalDays: 1,
			}),
		);
	}

	it("lists each schedule with its latest run, so a failed run doesn't read as done (L6-11)", async () => {
		const saved = await schedule();
		expect(await jobs.list("alice")).toMatchObject([{ id: saved.id, lastRun: null }]);
		await getDb()
			.insert(tables.careerJob)
			.values([
				// Queued first for a later time, then the schedule moved earlier and queued again: the newer run counts.
				{
					id: "earlier-completed",
					userId: "alice",
					scheduleId: saved.id,
					dueAt: new Date("2026-10-31T08:00:00Z"),
					status: "completed",
					createdAt: new Date("2026-10-29T08:00:00Z"),
				},
				{
					id: "latest-failed",
					userId: "alice",
					scheduleId: saved.id,
					dueAt: new Date("2026-10-30T08:00:00Z"),
					status: "failed",
					error: "This schedule failed.",
					createdAt: new Date("2026-10-30T08:00:00Z"),
				},
			]);
		expect(await jobs.list("alice")).toMatchObject([
			{ id: saved.id, lastRun: { status: "failed", error: "This schedule failed." } },
		]);
		expect(await jobs.list("bob")).toEqual([]);
	});

	it("uses the application's single follow-up for schedule creation, edits, pause, deletion and owner checks", async () => {
		const { applicationService } = await import("../applications/service");
		const id = await applicationService.create({ userId: "alice", company: "Fictional Acme", role: "Engineer" });
		const at = new Date(Date.now() + 86400000);
		const saved = await jobs.save(
			"alice",
			careerScheduleInputSchema.parse({
				kind: "follow-up",
				applicationId: id,
				nextRunAt: at,
				timezone: "Europe/Berlin",
				query: "Ask about the timeline",
			}),
		);
		expect(await applicationService.getById({ userId: "alice", id })).toMatchObject({
			followUpAt: at,
			followUpNote: "Ask about the timeline",
		});
		const later = new Date(at.getTime() + 86400000);
		await applicationService.update({ userId: "alice", id, followUpAt: later, followUpNote: "Confirm the next round" });
		expect((await jobs.list("alice")).filter((row) => row.kind === "follow-up")).toMatchObject([
			{ id: saved.id, nextRunAt: later, query: "Confirm the next round", timezone: "Europe/Berlin" },
		]);
		const repeated = await jobs.save(
			"alice",
			careerScheduleInputSchema.parse({
				kind: "follow-up",
				applicationId: id,
				nextRunAt: later,
				timezone: "Europe/Berlin",
				query: "New note",
			}),
		);
		expect(repeated.id).toBe(saved.id);
		expect((await jobs.list("alice")).filter((row) => row.kind === "follow-up")).toHaveLength(1);
		await getDb()
			.insert(tables.careerJob)
			.values({
				id: "old-follow-up-job",
				userId: "alice",
				scheduleId: saved.id,
				dueAt: later,
				status: "running",
				lease: "old-lease",
				leaseUntil: new Date(Date.now() + 60000),
			});
		await getDb()
			.update(tables.careerSchedule)
			.set({ lastQueuedAt: later })
			.where(eq(tables.careerSchedule.id, saved.id));
		const longNote = "Follow-up detail. ".repeat(100);
		await applicationService.update({ userId: "alice", id, followUpNote: longNote });
		const [canceled] = await getDb()
			.select()
			.from(tables.careerJob)
			.where(eq(tables.careerJob.id, "old-follow-up-job"));
		expect(canceled).toMatchObject({ status: "running", lease: "old-lease" });
		const current = (await jobs.list("alice")).find((row) => row.id === saved.id);
		expect(current).toMatchObject({ query: longNote, lastQueuedAt: later });
		await jobs.save("alice", { ...careerScheduleInputSchema.parse(current), id: saved.id });
		expect(await applicationService.getById({ userId: "alice", id })).toMatchObject({ followUpNote: longNote.trim() });

		await getDb()
			.insert(tables.user)
			.values({ id: "bob", name: "Bob Example", email: "bob@example.test", username: "bob", displayUsername: "bob" });
		await jobs.delete("bob", saved.id);
		expect(await applicationService.getById({ userId: "alice", id })).toMatchObject({ followUpAt: later });
		await jobs.delete("alice", saved.id);
		expect(await applicationService.getById({ userId: "alice", id })).toMatchObject({
			followUpAt: null,
			followUpNote: null,
		});
	});

	it("adopts legacy follow-ups without deleting duplicate reminder or job history", async () => {
		const { applicationService } = await import("../applications/service");
		const id = await applicationService.create({ userId: "alice", company: "Legacy Example", role: "Engineer" });
		const older = new Date("2030-01-01T09:00:00Z");
		const newer = new Date("2030-01-02T09:00:00Z");
		for (const [name, at] of [
			["legacy-old", older],
			["legacy-new", newer],
		] as const) {
			await getDb().insert(tables.careerSchedule).values({
				id: name,
				userId: "alice",
				applicationId: id,
				kind: "follow-up",
				query: name,
				enabled: true,
				nextRunAt: at,
				createdAt: at,
				updatedAt: at,
			});
			await getDb()
				.insert(tables.careerJob)
				.values({ id: `job-${name}`, userId: "alice", scheduleId: name, dueAt: at, status: "completed" });
		}
		const dateOnly = await applicationService.create({ userId: "alice", company: "Legacy Date", role: "Engineer" });
		await getDb().update(tables.user).set({ timezone: "Pacific/Honolulu" }).where(eq(tables.user.id, "alice"));
		await getDb()
			.update(tables.application)
			.set({ followUpAt: new Date("2030-01-03T00:00:00Z") })
			.where(eq(tables.application.id, dateOnly));
		await pool.query(
			await readFile(
				new URL("../../../../../migrations/20261031160926_rx106_follow_up_owner/migration.sql", import.meta.url),
				"utf8",
			).then((sql) => sql.slice(sql.indexOf("--> statement-breakpoint") + "--> statement-breakpoint".length)),
		);
		expect(await applicationService.getById({ userId: "alice", id })).toMatchObject({
			followUpAt: newer,
			followUpNote: "legacy-new",
		});
		expect(await getDb().select().from(tables.careerSchedule)).toHaveLength(3);
		expect(await getDb().select().from(tables.careerJob)).toHaveLength(2);
		expect((await jobs.list("alice")).find((row) => row.applicationId === id)).toMatchObject({
			id: "legacy-new",
			enabled: true,
			nextRunAt: newer,
		});
		expect(await applicationService.getById({ userId: "alice", id: dateOnly })).toMatchObject({
			followUpAt: new Date("2030-01-03T00:00:00Z"),
			followUpDateOnly: true,
		});
		expect((await jobs.list("alice")).find((row) => row.applicationId === dateOnly)?.nextRunAt).toEqual(
			new Date("2030-01-03T19:00:00Z"),
		);
	});

	// Stages the shipped migrations so the two follow-up migrations run against a populated pre-patch schema. Drizzle
	// migrations are forward-only here, so the safety property to prove is repeatability and preservation, not a down
	// migration: re-running the same backfills must leave the upgraded rows byte-for-byte unchanged.
	it("upgrades legacy reminders without duplicating or dropping occurrences", async () => {
		const isolated = `rx106_upgrade_${randomUUID().replaceAll("-", "")}`;
		await admin.query(`CREATE SCHEMA ${isolated}`);
		const upgrade = new Pool({
			connectionString: databaseUrl,
			max: 1,
			options: `-c search_path=${isolated} -c statement_timeout=10000`,
		});
		const scheduleRows = async () =>
			(
				await upgrade.query(
					"SELECT id,next_run_at,last_queued_at,timezone,enabled,query FROM career_schedule ORDER BY id",
				)
			).rows.map((row) => ({
				id: row.id as string,
				next: (row.next_run_at as Date).toISOString(),
				queued: row.last_queued_at === null ? null : (row.last_queued_at as Date).toISOString(),
				timezone: row.timezone as string,
				enabled: row.enabled as boolean,
				query: row.query as string,
			}));
		const jobRows = async () =>
			(await upgrade.query("SELECT * FROM career_job ORDER BY due_at, id")).rows.map((row) => ({
				id: row.id as string,
				scheduleId: row.schedule_id as string,
				dueAt: (row.due_at as Date).toISOString(),
				status: row.status as string,
			}));
		const wholeJob = async (id: string) => (await upgrade.query("SELECT * FROM career_job WHERE id=$1", [id])).rows[0];
		const wholeSnapshot = async () => ({
			schedules: (await upgrade.query("SELECT * FROM career_schedule ORDER BY id")).rows,
			jobs: (await upgrade.query("SELECT * FROM career_job ORDER BY due_at, id")).rows,
			notifications: (await upgrade.query("SELECT * FROM career_notification ORDER BY id")).rows,
			applications: (await upgrade.query("SELECT * FROM application ORDER BY id")).rows,
		});
		const notifications = async () =>
			(await upgrade.query("SELECT key,application_id FROM career_notification ORDER BY key")).rows.map((row) => ({
				key: row.key as string,
				applicationId: row.application_id as string | null,
			}));
		try {
			const migrations = new URL("../../../../../migrations/", import.meta.url);
			const directories = (await readdir(migrations, { withFileTypes: true }))
				.filter((entry) => entry.isDirectory() && /^\d+_/.test(entry.name))
				.map((entry) => entry.name)
				.sort();
			const owner = "20261031160926_rx106_follow_up_owner";
			const apply = async (name: string) => {
				const file = new URL(`${name}/migration.sql`, migrations);
				await upgrade.query((await readFile(file, "utf8")).replaceAll('"public".', ""));
			};
			for (const directory of directories) {
				if (directory === owner) break;
				await apply(directory);
			}

			// Valid pre-patch state: every reminder already ran at 08:00. The application's own follow-up is a separate
			// surface: a logical-day date on the same day, a different day, a pending one, and two explicit times.
			await upgrade.query(`
				INSERT INTO "user"(id,name,email,username,display_username,timezone,email_verified)
				VALUES('upgrade','Fictional Upgrade','upgrade@example.test','upgrade','upgrade','UTC',true);
				INSERT INTO application(id,user_id,company,role,status,follow_up_at,follow_up_note) VALUES
				 ('same-day','upgrade','Same Day Labs','Engineer','applied','2026-10-30T00:00:00Z','Already delivered'),
				 ('other-day','upgrade','Other Day Labs','Engineer','applied','2026-10-28T00:00:00Z','New logical day'),
				 ('pending','upgrade','Pending Labs','Engineer','applied','2026-10-30T00:00:00Z','Still pending'),
				 ('explicit-later','upgrade','Explicit Later Labs','Engineer','applied','2026-10-30T16:00:00Z','Distinct exact time'),
				 ('explicit-same','upgrade','Explicit Same Labs','Engineer','applied','2026-10-30T08:00:00Z','Already delivered'),
				 ('explicit-delivered','upgrade','Explicit Delivered Labs','Engineer','applied','2026-10-30T16:00:00Z','Delivered at this instant');
				INSERT INTO career_schedule(id,user_id,application_id,kind,query,timezone,enabled,next_run_at,last_queued_at) VALUES
				 ('same-day','upgrade','same-day','follow-up','Already delivered','UTC',true,'2026-10-30T08:00:00Z','2026-10-30T08:00:00Z'),
				 ('other-day','upgrade','other-day','follow-up','Earlier delivery','UTC',true,'2026-10-27T08:00:00Z','2026-10-27T08:00:00Z'),
				 ('pending','upgrade','pending','follow-up','Still pending','UTC',true,'2026-10-30T08:00:00Z','2026-10-30T08:00:00Z'),
				 ('explicit-later','upgrade','explicit-later','follow-up','Distinct exact time','UTC',true,'2026-10-30T08:00:00Z','2026-10-30T08:00:00Z'),
				 ('explicit-same','upgrade','explicit-same','follow-up','Already delivered','UTC',true,'2026-10-30T08:00:00Z','2026-10-30T08:00:00Z'),
				 ('explicit-delivered','upgrade','explicit-delivered','follow-up','Delivered at this instant','UTC',true,'2026-10-30T17:00:00Z','2026-10-30T16:00:00Z');
				INSERT INTO career_job(id,user_id,schedule_id,due_at,status,attempts) VALUES
				 ('job-same-day','upgrade','same-day','2026-10-30T08:00:00Z','completed',1),
				 ('job-other-day','upgrade','other-day','2026-10-27T08:00:00Z','completed',1),
				 ('job-pending','upgrade','pending','2026-10-30T08:00:00Z','queued',0),
				 ('job-explicit-later','upgrade','explicit-later','2026-10-30T08:00:00Z','completed',1),
				 ('job-explicit-same','upgrade','explicit-same','2026-10-30T08:00:00Z','completed',1),
				 ('job-explicit-delivered','upgrade','explicit-delivered','2026-10-30T16:00:00Z','completed',1);
				INSERT INTO career_notification(id,user_id,application_id,key,notice) VALUES
				 ('notice-same-day','upgrade','same-day','job-same-day','{"type":"followup","company":"Same Day Labs","role":"Engineer","note":"Already delivered"}'),
				 ('notice-other-day','upgrade','other-day','job-other-day','{"type":"followup","company":"Other Day Labs","role":"Engineer","note":"Earlier delivery"}'),
				 ('notice-explicit-later','upgrade','explicit-later','job-explicit-later','{"type":"followup","company":"Explicit Later Labs","role":"Engineer","note":"Distinct exact time"}'),
				 ('notice-explicit-same','upgrade','explicit-same','job-explicit-same','{"type":"followup","company":"Explicit Same Labs","role":"Engineer","note":"Already delivered"}'),
				 ('notice-explicit-delivered','upgrade','explicit-delivered','job-explicit-delivered','{"type":"followup","company":"Explicit Delivered Labs","role":"Engineer","note":"Delivered at this instant"}');
			`);

			const before = {
				sameDay: await wholeJob("job-same-day"),
				otherDay: await wholeJob("job-other-day"),
				explicitLater: await wholeJob("job-explicit-later"),
				explicitSame: await wholeJob("job-explicit-same"),
				explicitDelivered: await wholeJob("job-explicit-delivered"),
			};
			expect(await scheduleRows()).toEqual([
				{
					id: "explicit-delivered",
					next: "2026-10-30T17:00:00.000Z",
					queued: "2026-10-30T16:00:00.000Z",
					timezone: "UTC",
					enabled: true,
					query: "Delivered at this instant",
				},
				{
					id: "explicit-later",
					next: "2026-10-30T08:00:00.000Z",
					queued: "2026-10-30T08:00:00.000Z",
					timezone: "UTC",
					enabled: true,
					query: "Distinct exact time",
				},
				{
					id: "explicit-same",
					next: "2026-10-30T08:00:00.000Z",
					queued: "2026-10-30T08:00:00.000Z",
					timezone: "UTC",
					enabled: true,
					query: "Already delivered",
				},
				{
					id: "other-day",
					next: "2026-10-27T08:00:00.000Z",
					queued: "2026-10-27T08:00:00.000Z",
					timezone: "UTC",
					enabled: true,
					query: "Earlier delivery",
				},
				{
					id: "pending",
					next: "2026-10-30T08:00:00.000Z",
					queued: "2026-10-30T08:00:00.000Z",
					timezone: "UTC",
					enabled: true,
					query: "Still pending",
				},
				{
					id: "same-day",
					next: "2026-10-30T08:00:00.000Z",
					queued: "2026-10-30T08:00:00.000Z",
					timezone: "UTC",
					enabled: true,
					query: "Already delivered",
				},
			]);
			expect(await notifications()).toHaveLength(5);

			// Apply the rest of the shipped chain in order, including the clock, RX-98's schema migration and the
			// forward correction, so this populated upgrade runs against the same composed schema as production.
			for (const directory of directories.filter((name) => name >= owner)) await apply(directory);

			expect(await scheduleRows()).toEqual([
				{
					id: "explicit-delivered",
					next: "2026-10-30T16:00:00.000Z",
					queued: "2026-10-30T16:00:00.000Z",
					timezone: "UTC",
					enabled: true,
					query: "Delivered at this instant",
				},
				{
					id: "explicit-later",
					next: "2026-10-30T16:00:00.000Z",
					queued: null,
					timezone: "UTC",
					enabled: true,
					query: "Distinct exact time",
				},
				{
					id: "explicit-same",
					next: "2026-10-30T08:00:00.000Z",
					queued: "2026-10-30T08:00:00.000Z",
					timezone: "UTC",
					enabled: true,
					query: "Already delivered",
				},
				{
					id: "other-day",
					next: "2026-10-28T09:00:00.000Z",
					queued: null,
					timezone: "UTC",
					enabled: true,
					query: "New logical day",
				},
				{
					id: "pending",
					next: "2026-10-30T09:00:00.000Z",
					queued: null,
					timezone: "UTC",
					enabled: true,
					query: "Still pending",
				},
				{
					id: "same-day",
					next: "2026-10-30T09:00:00.000Z",
					queued: "2026-10-30T09:00:00.000Z",
					timezone: "UTC",
					enabled: true,
					query: "Already delivered",
				},
			]);
			expect(await wholeJob("job-same-day")).toEqual(before.sameDay);
			expect(await wholeJob("job-other-day")).toEqual(before.otherDay);
			expect(await wholeJob("job-explicit-later")).toEqual(before.explicitLater);
			expect(await wholeJob("job-explicit-delivered")).toEqual(before.explicitDelivered);
			expect(await wholeJob("job-explicit-same")).toEqual(before.explicitSame);
			expect(await jobRows()).toEqual([
				{ id: "job-other-day", scheduleId: "other-day", dueAt: "2026-10-27T08:00:00.000Z", status: "completed" },
				{
					id: "job-explicit-later",
					scheduleId: "explicit-later",
					dueAt: "2026-10-30T08:00:00.000Z",
					status: "completed",
				},
				{
					id: "job-explicit-same",
					scheduleId: "explicit-same",
					dueAt: "2026-10-30T08:00:00.000Z",
					status: "completed",
				},
				{ id: "job-pending", scheduleId: "pending", dueAt: "2026-10-30T08:00:00.000Z", status: "canceled" },
				{ id: "job-same-day", scheduleId: "same-day", dueAt: "2026-10-30T08:00:00.000Z", status: "completed" },
				{
					id: "job-explicit-delivered",
					scheduleId: "explicit-delivered",
					dueAt: "2026-10-30T16:00:00.000Z",
					status: "completed",
				},
			]);

			const oldDb = fixture.db;
			fixture.db = drizzle({ client: upgrade });
			try {
				// One worker serves one job per account per tick: explicit-later, other-day and pending are due.
				await run();
				await run();
				await run();
				await run();
			} finally {
				fixture.db = oldDb;
			}

			const delivered = await jobRows();
			const forSchedule = (id: string) => delivered.filter((row) => row.scheduleId === id);
			expect(forSchedule("same-day")).toEqual([
				{ id: "job-same-day", scheduleId: "same-day", dueAt: "2026-10-30T08:00:00.000Z", status: "completed" },
			]);
			expect(forSchedule("explicit-same")).toEqual([
				{
					id: "job-explicit-same",
					scheduleId: "explicit-same",
					dueAt: "2026-10-30T08:00:00.000Z",
					status: "completed",
				},
			]);
			expect(forSchedule("explicit-delivered")).toEqual([
				{
					id: "job-explicit-delivered",
					scheduleId: "explicit-delivered",
					dueAt: "2026-10-30T16:00:00.000Z",
					status: "completed",
				},
			]);
			expect(forSchedule("explicit-later")).toEqual([
				{
					id: "job-explicit-later",
					scheduleId: "explicit-later",
					dueAt: "2026-10-30T08:00:00.000Z",
					status: "completed",
				},
				{
					id: expect.any(String),
					scheduleId: "explicit-later",
					dueAt: "2026-10-30T16:00:00.000Z",
					status: "completed",
				},
			]);
			expect(forSchedule("other-day")).toEqual([
				{ id: "job-other-day", scheduleId: "other-day", dueAt: "2026-10-27T08:00:00.000Z", status: "completed" },
				{ id: expect.any(String), scheduleId: "other-day", dueAt: "2026-10-28T09:00:00.000Z", status: "completed" },
			]);
			expect(forSchedule("pending")).toEqual([
				{ id: "job-pending", scheduleId: "pending", dueAt: "2026-10-30T08:00:00.000Z", status: "canceled" },
				{ id: expect.any(String), scheduleId: "pending", dueAt: "2026-10-30T09:00:00.000Z", status: "completed" },
			]);
			const notices = await notifications();
			expect(notices).toHaveLength(8);
			expect(notices.filter((row) => row.key === "job-same-day")).toHaveLength(1);
			expect(notices.filter((row) => row.key === "job-explicit-same")).toHaveLength(1);
			expect(notices.filter((row) => row.key === "job-explicit-later")).toHaveLength(1);
			expect(notices.filter((row) => row.key === "job-explicit-delivered")).toHaveLength(1);
			expect(notices.filter((row) => row.applicationId === "explicit-later")).toHaveLength(2);
			expect(await wholeJob("job-same-day")).toEqual(before.sameDay);
			expect(await wholeJob("job-explicit-same")).toEqual(before.explicitSame);
			expect(await wholeJob("job-explicit-later")).toEqual(before.explicitLater);
			expect(await wholeJob("job-explicit-delivered")).toEqual(before.explicitDelivered);

			// Re-running the same forward-only backfills is safe: history, watermarks and deliveries hold.
			const beforeRepeat = await wholeSnapshot();
			const ownerSql = await readFile(new URL(`${owner}/migration.sql`, migrations), "utf8");
			await upgrade.query(
				ownerSql.slice(ownerSql.indexOf("--> statement-breakpoint") + "--> statement-breakpoint".length),
			);
			await upgrade.query(
				'UPDATE "user" SET timezone=timezone WHERE EXISTS (SELECT 1 FROM application a WHERE a.user_id="user".id AND a.follow_up_date_only AND a.follow_up_at IS NOT NULL)',
			);
			fixture.db = drizzle({ client: upgrade });
			try {
				await run();
				await run();
			} finally {
				fixture.db = oldDb;
			}
			expect(await wholeSnapshot()).toEqual(beforeRepeat);
		} finally {
			await upgrade.end();
			await admin.query(`DROP SCHEMA IF EXISTS ${isolated} CASCADE`);
		}
	});
	// Exact owner migrations shipped by the earlier repair rounds. Installations that recorded one of these names never
	// re-run the edited SQL, so the forward correction must repair the state they leave behind.
	const V2_OWNER_SQL = `ALTER TABLE "application" ADD COLUMN "follow_up_date_only" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Preserve legacy raw dates; discriminator keeps their calendar day separate from exact reminder times.
UPDATE application SET follow_up_date_only=true WHERE follow_up_at IS NOT NULL AND follow_up_at=date_trunc('day',follow_up_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
--> statement-breakpoint
-- Adopt the newest existing reminder only when the application has no follow-up.
-- Existing application dates/notes stay authoritative. Duplicate delivery rows are consolidated.
WITH newest AS (
 SELECT DISTINCT ON (s.user_id, s.application_id) s.* FROM career_schedule s
 JOIN application a ON a.id=s.application_id AND a.user_id=s.user_id
 WHERE s.kind='follow-up'
 ORDER BY s.user_id,s.application_id,s.updated_at DESC,s.id DESC
)
UPDATE application a SET follow_up_at=n.next_run_at, follow_up_note=COALESCE(a.follow_up_note,NULLIF(n.query,''))
FROM newest n WHERE a.id=n.application_id AND a.user_id=n.user_id AND a.follow_up_at IS NULL;
--> statement-breakpoint
-- Keep duplicate reminders and job history in account exports, but only the newest row delivers.
UPDATE career_schedule s SET enabled=false FROM career_schedule newer
WHERE s.kind='follow-up' AND newer.kind='follow-up' AND s.user_id=newer.user_id
AND s.application_id=newer.application_id AND (s.updated_at,s.id)<(newer.updated_at,newer.id);
--> statement-breakpoint
UPDATE career_job j SET status='canceled',lease=NULL,lease_until=NULL
FROM career_schedule s JOIN application a ON a.id=s.application_id AND a.user_id=s.user_id
WHERE j.schedule_id=s.id AND s.kind='follow-up' AND j.status IN ('queued','running')
AND ((CASE WHEN a.follow_up_date_only THEN ((a.follow_up_at AT TIME ZONE 'UTC')::date + time '09:00') AT TIME ZONE s.timezone ELSE a.follow_up_at END) IS DISTINCT FROM s.next_run_at OR NOT s.enabled);
--> statement-breakpoint
UPDATE career_schedule s SET next_run_at=CASE WHEN a.follow_up_date_only THEN ((a.follow_up_at AT TIME ZONE 'UTC')::date + time '09:00') AT TIME ZONE s.timezone ELSE a.follow_up_at END,query=COALESCE(a.follow_up_note,''),
last_queued_at=CASE WHEN s.next_run_at=CASE WHEN a.follow_up_date_only THEN ((a.follow_up_at AT TIME ZONE 'UTC')::date + time '09:00') AT TIME ZONE s.timezone ELSE a.follow_up_at END THEN s.last_queued_at ELSE NULL END
FROM application a WHERE s.application_id=a.id AND s.user_id=a.user_id AND s.kind='follow-up' AND a.follow_up_at IS NOT NULL
AND NOT EXISTS(SELECT 1 FROM career_schedule newer WHERE newer.user_id=s.user_id AND newer.application_id=s.application_id AND newer.kind='follow-up' AND (newer.updated_at,newer.id)>(s.updated_at,s.id));
--> statement-breakpoint
INSERT INTO career_schedule(id,user_id,application_id,kind,query,timezone,enabled,next_run_at)
SELECT 'follow-up:'||a.id,a.user_id,a.id,'follow-up',COALESCE(a.follow_up_note,''),u.timezone,true,CASE WHEN a.follow_up_date_only THEN ((a.follow_up_at AT TIME ZONE 'UTC')::date + time '09:00') AT TIME ZONE u.timezone ELSE a.follow_up_at END
FROM application a JOIN "user" u ON u.id=a.user_id WHERE a.follow_up_at IS NOT NULL
AND NOT EXISTS(SELECT 1 FROM career_schedule s WHERE s.user_id=a.user_id AND s.application_id=a.id AND s.kind='follow-up');
`;
	const V3_OWNER_SQL = `ALTER TABLE "application" ADD COLUMN "follow_up_date_only" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Preserve legacy raw dates; discriminator keeps their calendar day separate from exact reminder times.
UPDATE application SET follow_up_date_only=true WHERE follow_up_at IS NOT NULL AND follow_up_at=date_trunc('day',follow_up_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
--> statement-breakpoint
-- Adopt the newest existing reminder only when the application has no follow-up.
-- Existing application dates/notes stay authoritative. Duplicate delivery rows are consolidated.
WITH newest AS (
 SELECT DISTINCT ON (s.user_id, s.application_id) s.* FROM career_schedule s
 JOIN application a ON a.id=s.application_id AND a.user_id=s.user_id
 WHERE s.kind='follow-up'
 ORDER BY s.user_id,s.application_id,s.updated_at DESC,s.id DESC
)
UPDATE application a SET follow_up_at=n.next_run_at, follow_up_note=COALESCE(a.follow_up_note,NULLIF(n.query,''))
FROM newest n WHERE a.id=n.application_id AND a.user_id=n.user_id AND a.follow_up_at IS NULL;
--> statement-breakpoint
-- Keep duplicate reminders and job history in account exports, but only the newest row delivers.
UPDATE career_schedule s SET enabled=false FROM career_schedule newer
WHERE s.kind='follow-up' AND newer.kind='follow-up' AND s.user_id=newer.user_id
AND s.application_id=newer.application_id AND (s.updated_at,s.id)<(newer.updated_at,newer.id);
--> statement-breakpoint
UPDATE career_job j SET status='canceled',lease=NULL,lease_until=NULL
FROM career_schedule s JOIN application a ON a.id=s.application_id AND a.user_id=s.user_id
WHERE j.schedule_id=s.id AND s.kind='follow-up' AND j.status IN ('queued','running')
AND ((CASE WHEN a.follow_up_date_only THEN ((a.follow_up_at AT TIME ZONE 'UTC')::date + time '09:00') AT TIME ZONE s.timezone ELSE a.follow_up_at END) IS DISTINCT FROM s.next_run_at OR NOT s.enabled);
--> statement-breakpoint
-- Move the delivery index to the projected clock. A completed occurrence on the same logical day stays delivered: its
-- watermark follows the projected instant, so the scheduler does not treat the new time as an undelivered occurrence.
-- Completed history keeps its original due time; only pending queued/running work moves to the projected clock.
WITH projected AS (
 SELECT s.id,s.last_queued_at,s.next_run_at AS current_at,
  CASE WHEN a.follow_up_date_only THEN ((a.follow_up_at AT TIME ZONE 'UTC')::date + time '09:00') AT TIME ZONE s.timezone ELSE a.follow_up_at END AS at,
  COALESCE((SELECT j.status='completed' FROM career_job j WHERE j.schedule_id=s.id ORDER BY j.created_at DESC,j.id DESC LIMIT 1),false) AS completed,
  a.follow_up_note
 FROM career_schedule s JOIN application a ON a.id=s.application_id AND a.user_id=s.user_id
 WHERE s.kind='follow-up' AND a.follow_up_at IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM career_schedule newer WHERE newer.user_id=s.user_id AND newer.application_id=s.application_id AND newer.kind='follow-up' AND (newer.updated_at,newer.id)>(s.updated_at,s.id))
)
UPDATE career_schedule s SET next_run_at=p.at,query=COALESCE(p.follow_up_note,''),
last_queued_at=CASE
 WHEN p.at IS NOT DISTINCT FROM p.current_at THEN s.last_queued_at
 WHEN s.last_queued_at IS NOT NULL AND p.completed
  AND (p.at AT TIME ZONE s.timezone)::date=(s.last_queued_at AT TIME ZONE s.timezone)::date
 THEN p.at
 ELSE NULL END
FROM projected p WHERE s.id=p.id;
--> statement-breakpoint
INSERT INTO career_schedule(id,user_id,application_id,kind,query,timezone,enabled,next_run_at)
SELECT 'follow-up:'||a.id,a.user_id,a.id,'follow-up',COALESCE(a.follow_up_note,''),u.timezone,true,CASE WHEN a.follow_up_date_only THEN ((a.follow_up_at AT TIME ZONE 'UTC')::date + time '09:00') AT TIME ZONE u.timezone ELSE a.follow_up_at END
FROM application a JOIN "user" u ON u.id=a.user_id WHERE a.follow_up_at IS NOT NULL
AND NOT EXISTS(SELECT 1 FROM career_schedule s WHERE s.user_id=a.user_id AND s.application_id=a.id AND s.kind='follow-up');
`;

	it("forward correction repairs installations recorded with an earlier owner migration", async () => {
		const schemas: string[] = [];
		const pools: Pool[] = [];
		const normalized = async (pool: Pool) => {
			const snapshot = {
				schedules: (
					(await pool.query("SELECT id,next_run_at,last_queued_at,enabled,query FROM career_schedule ORDER BY id"))
						.rows as Array<Record<string, unknown>>
				).map((row) => ({
					id: row.id,
					next: (row.next_run_at as Date).toISOString(),
					queued: row.last_queued_at === null ? null : (row.last_queued_at as Date).toISOString(),
					enabled: row.enabled,
					query: row.query,
				})),
				jobs: [] as Array<Record<string, unknown>>,
				notifications: [] as Array<Record<string, unknown>>,
			};
			const jobRows = (
				(await pool.query("SELECT id,schedule_id,due_at,status FROM career_job ORDER BY due_at,id")).rows as Array<
					Record<string, unknown>
				>
			).map((row) => ({
				id: row.id,
				scheduleId: row.schedule_id,
				dueAt: (row.due_at as Date).toISOString(),
				status: row.status,
			}));
			// New occurrences get fresh job ids; compare them by schedule instead of by the random id.
			const jobKey = new Map(
				jobRows.map((row) => [row.id, String(row.id).startsWith("job-") ? row.id : `${row.scheduleId}:new`]),
			);
			snapshot.jobs = jobRows.map((row) => ({ ...row, id: jobKey.get(row.id) }));
			snapshot.notifications = (
				(await pool.query("SELECT key,application_id FROM career_notification ORDER BY key")).rows as Array<
					Record<string, unknown>
				>
			).map((row) => ({ key: jobKey.get(row.key as string) ?? row.key, applicationId: row.application_id }));
			return snapshot;
		};
		const recordedUpgrade = async (label: string, ownerSql: string | null) => {
			const schema = `rx106_recovery_${label}_${randomUUID().replaceAll("-", "")}`;
			await admin.query(`CREATE SCHEMA ${schema}`);
			schemas.push(schema);
			const pool = new Pool({
				connectionString: databaseUrl,
				max: 1,
				options: `-c search_path=${schema} -c statement_timeout=10000`,
			});
			pools.push(pool);
			const migrations = new URL("../../../../../migrations/", import.meta.url);
			const directories = (await readdir(migrations, { withFileTypes: true }))
				.filter((entry) => entry.isDirectory() && /^\d+_/.test(entry.name))
				.map((entry) => entry.name)
				.sort();
			const owner = "20261031160926_rx106_follow_up_owner";
			const recovery = "20261101090000_rx106_follow_up_watermark_recovery";
			const apply = async (name: string) => {
				const file = new URL(`${name}/migration.sql`, migrations);
				await pool.query((await readFile(file, "utf8")).replaceAll('"public".', ""));
			};
			let beforeRecovery: Awaited<ReturnType<typeof normalized>> | undefined;
			for (const directory of directories) {
				if (directory === recovery) beforeRecovery = await normalized(pool);
				if (directory === owner) {
					await pool.query(`
				INSERT INTO "user"(id,name,email,username,display_username,timezone,email_verified)
				VALUES('upgrade','Fictional Upgrade','upgrade@example.test','upgrade','upgrade','UTC',true);
				INSERT INTO application(id,user_id,company,role,status,follow_up_at,follow_up_note) VALUES
				 ('same-day','upgrade','Same Day Labs','Engineer','applied','2026-10-30T00:00:00Z','Already delivered'),
				 ('explicit-later','upgrade','Explicit Later Labs','Engineer','applied','2026-10-30T16:00:00Z','Distinct exact time'),
				 ('pending','upgrade','Pending Labs','Engineer','applied','2026-10-30T00:00:00Z','Still pending'),
				 ('explicit-same','upgrade','Explicit Same Labs','Engineer','applied','2026-10-30T08:00:00Z','Already delivered');
				INSERT INTO career_schedule(id,user_id,application_id,kind,query,timezone,enabled,next_run_at,last_queued_at) VALUES
				 ('same-day','upgrade','same-day','follow-up','Already delivered','UTC',true,'2026-10-30T08:00:00Z','2026-10-30T08:00:00Z'),
				 ('explicit-later','upgrade','explicit-later','follow-up','Distinct exact time','UTC',true,'2026-10-30T08:00:00Z','2026-10-30T08:00:00Z'),
				 ('pending','upgrade','pending','follow-up','Still pending','UTC',true,'2026-10-30T08:00:00Z','2026-10-30T08:00:00Z'),
				 ('explicit-same','upgrade','explicit-same','follow-up','Already delivered','UTC',true,'2026-10-30T08:00:00Z','2026-10-30T08:00:00Z');
				INSERT INTO career_job(id,user_id,schedule_id,due_at,status,attempts) VALUES
				 ('job-same-day','upgrade','same-day','2026-10-30T08:00:00Z','completed',1),
				 ('job-explicit-later','upgrade','explicit-later','2026-10-30T08:00:00Z','completed',1),
				 ('job-pending','upgrade','pending','2026-10-30T08:00:00Z','queued',0),
				 ('job-explicit-same','upgrade','explicit-same','2026-10-30T08:00:00Z','completed',1);
				INSERT INTO career_notification(id,user_id,application_id,key,notice) VALUES
				 ('notice-same-day','upgrade','same-day','job-same-day','{"type":"followup","company":"Same Day Labs","role":"Engineer","note":"Already delivered"}'),
				 ('notice-explicit-later','upgrade','explicit-later','job-explicit-later','{"type":"followup","company":"Explicit Later Labs","role":"Engineer","note":"Distinct exact time"}'),
				 ('notice-explicit-same','upgrade','explicit-same','job-explicit-same','{"type":"followup","company":"Explicit Same Labs","role":"Engineer","note":"Already delivered"}');
				`);
					if (ownerSql) await pool.query(ownerSql);
					else await apply(owner);
					continue;
				}
				await apply(directory);
			}
			if (!beforeRecovery) throw new Error("Recovery migration is missing from the chain");
			const afterRecovery = await normalized(pool);
			const oldDb = fixture.db;
			fixture.db = drizzle({ client: pool });
			try {
				// One worker serves one job per account per tick.
				await run();
				await run();
				await run();
			} finally {
				fixture.db = oldDb;
			}
			return { beforeRecovery, afterRecovery, afterScheduler: await normalized(pool) };
		};
		try {
			const v2 = await recordedUpgrade("v2", V2_OWNER_SQL);
			const v3 = await recordedUpgrade("v3", V3_OWNER_SQL);
			const fresh = await recordedUpgrade("fresh", null);

			// The old chains really leave the defects behind.
			expect(v2.beforeRecovery.schedules.find((row) => row.id === "same-day")?.queued).toBeNull();
			expect(v3.beforeRecovery.schedules.find((row) => row.id === "explicit-later")?.queued).toBe(
				"2026-10-30T16:00:00.000Z",
			);
			expect(v3.beforeRecovery.schedules.find((row) => row.id === "same-day")?.queued).toBe("2026-10-30T09:00:00.000Z");

			// The correction converges every recorded history on the fresh-chain state before and after real delivery.
			expect(v2.afterRecovery).toEqual(fresh.afterRecovery);
			expect(v3.afterRecovery).toEqual(fresh.afterRecovery);
			expect(v2.afterScheduler).toEqual(fresh.afterScheduler);
			expect(v3.afterScheduler).toEqual(fresh.afterScheduler);

			const after = fresh.afterScheduler;
			expect(after.schedules).toEqual([
				{
					id: "explicit-later",
					next: "2026-10-30T16:00:00.000Z",
					queued: "2026-10-30T16:00:00.000Z",
					enabled: true,
					query: "Distinct exact time",
				},
				{
					id: "explicit-same",
					next: "2026-10-30T08:00:00.000Z",
					queued: "2026-10-30T08:00:00.000Z",
					enabled: true,
					query: "Already delivered",
				},
				{
					id: "pending",
					next: "2026-10-30T09:00:00.000Z",
					queued: "2026-10-30T09:00:00.000Z",
					enabled: true,
					query: "Still pending",
				},
				{
					id: "same-day",
					next: "2026-10-30T09:00:00.000Z",
					queued: "2026-10-30T09:00:00.000Z",
					enabled: true,
					query: "Already delivered",
				},
			]);
			expect(after.jobs.filter((row) => row.scheduleId === "explicit-later")).toEqual([
				{
					id: "job-explicit-later",
					scheduleId: "explicit-later",
					dueAt: "2026-10-30T08:00:00.000Z",
					status: "completed",
				},
				{
					id: expect.any(String),
					scheduleId: "explicit-later",
					dueAt: "2026-10-30T16:00:00.000Z",
					status: "completed",
				},
			]);
			expect(after.jobs.filter((row) => row.scheduleId === "same-day")).toHaveLength(1);
			expect(after.jobs.filter((row) => row.scheduleId === "explicit-same")).toHaveLength(1);
			expect(after.notifications).toHaveLength(5);
		} finally {
			await Promise.all(pools.map((pool) => pool.end()));
			for (const schema of schemas) await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
		}
	});

	it("distinguishes old-client dates from exact midnight reminders and preserves notes-only timestamps", async () => {
		const { applicationService } = await import("../applications/service");
		await getDb().update(tables.user).set({ timezone: "Asia/Tokyo" }).where(eq(tables.user.id, "alice"));
		const at = new Date("2030-01-03T00:00:00Z");
		const legacy = await applicationService.create({
			userId: "alice",
			company: "Legacy",
			role: "Engineer",
			followUpAt: at,
		});
		const exact = await applicationService.create({
			userId: "alice",
			company: "Exact",
			role: "Engineer",
			followUpAt: at,
			followUpDateOnly: false,
		});
		await applicationService.update({ userId: "alice", id: exact, followUpNote: "Keep this instant" });
		expect(await applicationService.getById({ userId: "alice", id: legacy })).toMatchObject({
			followUpAt: at,
			followUpDateOnly: true,
		});
		expect(await applicationService.getById({ userId: "alice", id: exact })).toMatchObject({
			followUpAt: at,
			followUpDateOnly: false,
		});
		const schedules = await jobs.list("alice");
		expect(schedules.find((row) => row.applicationId === legacy)?.nextRunAt).toEqual(at);
		expect(schedules.find((row) => row.applicationId === exact)?.nextRunAt).toEqual(at);
		await getDb().update(tables.user).set({ timezone: "Pacific/Honolulu" }).where(eq(tables.user.id, "alice"));
		await applicationService.update({ userId: "alice", id: legacy, followUpNote: "Keep logical date" });
		expect((await jobs.list("alice")).find((row) => row.applicationId === legacy)?.nextRunAt).toEqual(
			new Date("2030-01-03T19:00:00Z"),
		);
		await getDb().update(tables.user).set({ timezone: "Pacific/Apia" }).where(eq(tables.user.id, "alice"));
		await expect(
			applicationService.create({
				userId: "alice",
				company: "Missing day",
				role: "Engineer",
				followUpAt: new Date("2011-12-30T00:00:00Z"),
				followUpDateOnly: true,
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("delivers the follow-up note once without AI or search", async () => {
		const { applicationService } = await import("../applications/service");
		const id = await applicationService.create({
			userId: "alice",
			company: "Reminder Example",
			role: "Engineer",
			status: "applied",
		});
		await jobs.save(
			"alice",
			careerScheduleInputSchema.parse({
				kind: "follow-up",
				applicationId: id,
				nextRunAt: due(),
				timezone: "Europe/Berlin",
				query: "Ask about the team and timeline",
			}),
		);
		await run();
		await run();
		const notices = await jobs.notifications("alice");
		expect(notices).toHaveLength(1);
		expect(notices[0]).toMatchObject({
			notice: { type: "followup", note: "Ask about the team and timeline" },
			body: "Reminder Example · Engineer\nAsk about the team and timeline",
		});
		expect(fixture.generate).not.toHaveBeenCalled();
		expect(fixture.search).not.toHaveBeenCalled();
	});

	const interview = (at: Date) => ({
		id: "interview-round",
		type: "interview" as const,
		at,
		kind: "technical" as const,
		durationMinutes: 45,
		location: "Video",
		notes: "",
		audience: "practitioner" as const,
		participants: [],
		timezone: "Europe/Berlin",
	});
	async function interviewApplication(at: Date) {
		await getDb()
			.insert(tables.application)
			.values({
				id: "alice-app",
				userId: "alice",
				company: "ACME",
				role: "Engineer",
				activity: [{ id: "saved-stage", type: "stage", stage: "saved", at: expired() }, interview(at)],
			});
		await getDb().insert(tables.aiProvider).values({
			id: "preparation-provider",
			userId: "alice",
			label: "Synthetic provider",
			provider: "openai",
			model: "fixture-model",
			encryptedApiKey: "synthetic-key",
			apiKeySalt: "synthetic-salt",
			apiKeyHash: "synthetic-hash",
			apiKeyPreview: "synthetic-preview",
		});
	}

	it("requires Vercel's native cron token before enabling work, while allowing pause", async () => {
		const native = await schedule();
		vi.stubEnv("VERCEL", "1");
		await expect(schedule()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
		await expect(
			jobs.save("alice", {
				...careerScheduleInputSchema.parse({ ...native, enabled: false }),
				id: native.id,
			}),
		).resolves.toMatchObject({ enabled: false });
		fixture.env.CRON_SECRET = "synthetic-vercel-cron-secret-32-characters";
		await expect(schedule()).resolves.toMatchObject({ enabled: true });
	});

	it("rejects a briefing lead that has already passed instead of starting an immediate paid run", async () => {
		const at = new Date(Date.now() + 30 * 60_000);
		await interviewApplication(at);
		await expect(
			jobs.save(
				"alice",
				careerScheduleInputSchema.parse({
					applicationId: "alice-app",
					interviewId: "interview-round",
					kind: "prepare",
					lead: "24h",
					aiProviderId: "preparation-provider",
					timezone: "Europe/Berlin",
					nextRunAt: new Date("2031-01-01T00:00:00Z"),
				}),
			),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(await getDb().select().from(tables.careerSchedule)).toEqual([]);
	});

	it("two overlapping ticks publish only one result and notification for a due search", async () => {
		await schedule();
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		fixture.search.mockImplementationOnce(async () => {
			started.resolve();
			await release.promise;
			return results;
		});
		const first = run();
		await Promise.race([
			started.promise,
			first.then(() => {
				throw new Error("Runner completed without starting discovery.");
			}),
		]);
		try {
			await run();
		} finally {
			release.resolve();
			await first;
		}
		await run();
		expect(fixture.search).toHaveBeenCalledTimes(1);
		expect(await jobs.opportunities("alice")).toMatchObject([
			{ url: "https://example.test/jobs/42", role: "Reliability engineer", company: "ACME" },
		]);
		expect(await jobs.notifications("alice")).toHaveLength(1);
		expect(await getDb().select().from(tables.application)).toEqual([]);
		expect(await getDb().select().from(tables.careerArtifact)).toEqual([]);
	});

	it("keeps only postings as roles, and reads each page it finds once", async () => {
		fixture.search.mockResolvedValue([
			...results,
			{ title: "243 reliability jobs", url: "https://example.test/jobs?q=reliability", description: "" },
		]);
		fixture.read.mockImplementation(async (url) => (url.includes("?q=") ? null : posting));
		await schedule();
		await run();
		const reads = fixture.read.mock.calls.length;
		await schedule();
		await run();
		expect(fixture.search).toHaveBeenCalledTimes(2);
		expect(fixture.read).toHaveBeenCalledTimes(reads);
		const opportunities = await jobs.opportunities("alice");
		expect(opportunities).toMatchObject([{ url: "https://example.test/jobs/42", role: "Reliability engineer" }]);
		expect(await jobs.notifications("alice")).toMatchObject([{ title: "1 new role to review" }]);
		const [opportunity] = opportunities;
		if (!opportunity) throw new Error("Expected a reviewable result.");
		await jobs.dismissOpportunity("alice", opportunity.id);
		await schedule();
		await run();
		expect(await jobs.opportunities("alice")).toEqual([]);
		expect(await jobs.notifications("alice")).toHaveLength(1);
	});

	it.each(["pause", "delete schedule", "delete application"] as const)(
		"discards an in-flight search after %s",
		async (action) => {
			await getDb()
				.insert(tables.application)
				.values({ id: "alice-app", userId: "alice", company: "ACME", role: "Engineer" });
			const saved = await schedule("alice-app");
			const started = Promise.withResolvers<void>();
			const release = Promise.withResolvers<void>();
			fixture.search.mockImplementationOnce(async () => {
				started.resolve();
				await release.promise;
				return results;
			});
			const running = run();
			await started.promise;
			try {
				if (action === "pause")
					await jobs.save("alice", { ...careerScheduleInputSchema.parse(saved), id: saved.id, enabled: false });
				else if (action === "delete schedule") await jobs.delete("alice", saved.id);
				else await getDb().delete(tables.application).where(eq(tables.application.id, "alice-app"));
			} finally {
				release.resolve();
				await running;
			}
			await run();
			expect(fixture.search).toHaveBeenCalledTimes(1);
			expect(await jobs.opportunities("alice")).toEqual([]);
			expect(await jobs.notifications("alice")).toEqual([]);
			expect(fixture.email).not.toHaveBeenCalled();
		},
	);

	it("runs a briefing at its lead before the interview, through the schedule's own connection", async () => {
		const at = new Date(Date.now() + 5 * 3_600_000);
		await interviewApplication(at);
		const saved = await jobs.save(
			"alice",
			careerScheduleInputSchema.parse({
				applicationId: "alice-app",
				interviewId: "interview-round",
				kind: "prepare",
				lead: "2h",
				aiProviderId: "preparation-provider",
				timezone: "Europe/Berlin",
				nextRunAt: new Date("2031-01-01T00:00:00Z"),
			}),
		);
		expect(saved.nextRunAt).toEqual(new Date(at.getTime() - 2 * 3_600_000));
		// The lead is in the future when saved; make the occurrence due to exercise the run itself.
		await getDb().update(tables.careerSchedule).set({ nextRunAt: due() });
		await run();
		await run();
		const [job] = await getDb().select().from(tables.careerJob);
		expect(fixture.generate).toHaveBeenCalledOnce();
		expect(fixture.generate).toHaveBeenCalledWith(
			expect.objectContaining({
				applicationId: "alice-app",
				task: { task: "briefing", interviewId: "interview-round" },
				providerId: "preparation-provider",
				providerVersion: "fixture-revision",
				jobId: job?.id,
			}),
		);
		expect(await jobs.notifications("alice")).toMatchObject([
			{
				notice: { type: "briefing", company: "ACME" },
				applicationId: "alice-app",
				url: "/dashboard/applications/alice-app/prepare",
			},
		]);
	});

	it.each(["update", "delete"] as const)(
		"follows a rescheduled interview and pauses when it is removed, cancelling pending work (%s)",
		async (action) => {
			await interviewApplication(new Date("2030-10-08T10:00:00Z"));
			const unrelated = await schedule("alice-app");
			await getDb().insert(tables.careerSchedule).values({
				id: "interview-preparation",
				userId: "alice",
				applicationId: "alice-app",
				interviewId: "interview-round",
				aiProviderId: "preparation-provider",
				kind: "prepare",
				lead: "2h",
				enabled: true,
				nextRunAt: due(),
				lastQueuedAt: due(),
			});
			await getDb()
				.insert(tables.careerJob)
				.values([
					{
						userId: "alice",
						scheduleId: "interview-preparation",
						dueAt: expired(),
						status: "queued",
					},
					{
						userId: "alice",
						scheduleId: "interview-preparation",
						dueAt: due(),
						status: "running",
						attempts: 1,
						lease: "active-worker",
						leaseUntil: new Date(Date.now() + 60_000),
					},
				]);
			const applications = (await import("../applications/service")).applicationService;
			if (action === "update")
				await applications.updateInterview({
					userId: "alice",
					id: "alice-app",
					entryId: "interview-round",
					at: "2030-10-09T10:00:00Z",
				});
			else await applications.deleteTimelineEntry({ userId: "alice", id: "alice-app", entryId: "interview-round" });
			expect(await jobs.list("alice")).toEqual(
				expect.arrayContaining([
					expect.objectContaining(
						action === "update"
							? {
									id: "interview-preparation",
									enabled: true,
									nextRunAt: new Date("2030-10-09T08:00:00Z"),
									lastQueuedAt: null,
								}
							: { id: "interview-preparation", enabled: false },
					),
					expect.objectContaining({ id: unrelated.id, enabled: true }),
				]),
			);
			expect(
				await getDb()
					.select({
						status: tables.careerJob.status,
						lease: tables.careerJob.lease,
						leaseUntil: tables.careerJob.leaseUntil,
					})
					.from(tables.careerJob),
			).toEqual([
				{ status: "canceled", lease: null, leaseUntil: null },
				{ status: "canceled", lease: null, leaseUntil: null },
			]);
			expect(await jobs.notifications("alice")).toMatchObject(
				action === "update"
					? []
					: [
							{
								notice: { type: "briefing-paused" },
								applicationId: "alice-app",
								title: "Interview briefing paused",
								url: "/dashboard/career?schedule=interview-preparation",
							},
						],
			);
		},
	);

	it("tracks a discovered role once, and a tracked role stays quiet in later searches", async () => {
		const careers = (await import("./service")).careerService;
		const url = "https://example.test/jobs/42";
		fixture.search.mockResolvedValue([
			{ title: "Reliability engineer at ACME | LinkedIn", url, description: "Maintain reliable services." },
		]);
		await schedule();
		await run();
		const [opportunity] = await jobs.opportunities("alice");
		if (!opportunity) throw new Error("Expected a discovered role.");
		await expect(careers.trackOpportunity("bob", opportunity.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
		const tracked = await careers.trackOpportunity("alice", opportunity.id);
		expect(await careers.trackOpportunity("alice", opportunity.id)).toEqual(tracked);
		expect(
			await getDb()
				.select({
					id: tables.application.id,
					company: tables.application.company,
					role: tables.application.role,
					status: tables.application.status,
					sourceUrl: tables.application.sourceUrl,
				})
				.from(tables.application),
		).toEqual([
			{ id: tracked.applicationId, company: "ACME", role: "Reliability engineer", status: "saved", sourceUrl: url },
		]);
		fixture.search.mockResolvedValue([
			{ title: "Senior reliability engineer at ACME", url, description: "Updated requirements." },
		]);
		await schedule();
		await run();
		expect(await jobs.notifications("alice")).toHaveLength(1);
	});

	it("recovers a crashed lease but reports an exhausted lease only once without another provider call", async () => {
		const recoveredSchedule = await schedule();
		const exhaustedSchedule = await schedule();
		// Persist the state a terminated worker leaves behind, using already elapsed real timestamps.
		await getDb()
			.update(tables.careerSchedule)
			.set({ lastQueuedAt: recoveredSchedule.nextRunAt })
			.where(eq(tables.careerSchedule.id, recoveredSchedule.id));
		await getDb()
			.update(tables.careerSchedule)
			.set({ lastQueuedAt: exhaustedSchedule.nextRunAt })
			.where(eq(tables.careerSchedule.id, exhaustedSchedule.id));
		await getDb()
			.insert(tables.careerJob)
			.values([
				{
					id: "recoverable-job",
					userId: "alice",
					scheduleId: recoveredSchedule.id,
					dueAt: recoveredSchedule.nextRunAt,
					status: "running",
					attempts: 1,
					lease: "terminated-worker",
					leaseUntil: expired(),
				},
				{
					id: "exhausted-job",
					userId: "alice",
					scheduleId: exhaustedSchedule.id,
					dueAt: exhaustedSchedule.nextRunAt,
					status: "running",
					attempts: 3,
					lease: "terminated-worker-3",
					leaseUntil: expired(),
				},
			]);
		await Promise.all([run(), run()]);
		await run();
		expect(fixture.search).toHaveBeenCalledTimes(1);
		expect(await jobs.opportunities("alice")).toHaveLength(1);
		const notifications = await jobs.notifications("alice");
		expect(notifications.filter((item) => item.title === "Career schedule needs attention")).toHaveLength(1);
		expect(notifications).toHaveLength(2);
		expect(
			await getDb()
				.select({ status: tables.careerJob.status, attempts: tables.careerJob.attempts })
				.from(tables.careerJob)
				.where(eq(tables.careerJob.id, "exhausted-job")),
		).toEqual([{ status: "failed", attempts: 3 }]);
	});

	it("backs off failed requests and stops after three attempts with one actionable, sanitized notification", async () => {
		const failing = await schedule();
		fixture.search.mockRejectedValue(new Error("Synthetic provider error containing private-key-material"));
		await run();
		await run();
		expect(fixture.search).toHaveBeenCalledTimes(1);
		const [job] = await getDb().select().from(tables.careerJob);
		if (!job) throw new Error("Expected durable failed work.");
		expect(job.status).toBe("queued");
		expect(job.leaseUntil?.getTime()).toBeGreaterThan(Date.now());
		expect(await jobs.notifications("alice")).toEqual([]);
		for (let attempt = 2; attempt <= 3; attempt++) {
			// Restore the next retry as elapsed; no fake JS clock can disagree with PostgreSQL.
			await getDb().update(tables.careerJob).set({ leaseUntil: expired() }).where(eq(tables.careerJob.id, job.id));
			await run();
		}
		await run();
		expect(fixture.search).toHaveBeenCalledTimes(3);
		expect(await jobs.opportunities("alice")).toEqual([]);
		const notifications = await jobs.notifications("alice");
		expect(notifications).toMatchObject([
			{ title: "Career schedule needs attention", url: `/dashboard/career?schedule=${failing.id}` },
		]);
		expect(JSON.stringify(notifications)).not.toContain("private-key-material");
		expect(
			await getDb()
				.select({ status: tables.careerJob.status, attempts: tables.careerJob.attempts })
				.from(tables.careerJob)
				.where(eq(tables.careerJob.id, job.id)),
		).toEqual([{ status: "failed", attempts: 3 }]);
	});
	it("rechecks an old untracked posting without reporting it as a new role", async () => {
		await schedule();
		await run();
		await getDb()
			.update(tables.careerOpportunity)
			.set({ updatedAt: new Date(Date.now() - 8 * 86_400_000) });
		await getDb()
			.update(tables.careerSchedule)
			.set({ nextRunAt: new Date(Date.now() - 30_000) });
		fixture.read.mockResolvedValue({
			...posting,
			text: "Updated responsibilities",
			page: { ...posting.page, role: "Senior engineer" },
		});
		await run();
		expect(await jobs.opportunities("alice")).toMatchObject([{ role: "Senior engineer" }]);
		expect(await getDb().select().from(tables.careerOpportunity)).toMatchObject([
			{ description: "Updated responsibilities" },
		]);
		expect((await jobs.notifications("alice")).filter((item) => item.notice.type === "opportunities")).toHaveLength(1);
	});

	it("serializes competing track and dismiss requests and retains per-item bulk failures", async () => {
		const careers = (await import("./service")).careerService;
		await schedule();
		await run();
		const [role] = await jobs.opportunities("alice");
		if (!role) throw new Error("Expected discovered role");
		const tracks = await Promise.all(Array.from({ length: 8 }, () => careers.trackOpportunity("alice", role.id)));
		expect(new Set(tracks.map((result) => result.applicationId)).size).toBe(1);
		expect(await getDb().select().from(tables.application)).toHaveLength(1);
		await jobs.dismissOpportunity("alice", role.id);
		expect(await careers.trackOpportunity("alice", role.id)).toEqual(tracks[0]);
		expect(await jobs.opportunities("alice")).toEqual([]);
		await expect(jobs.dismissOpportunity("bob", role.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
		const [second] = await getDb()
			.insert(tables.careerOpportunity)
			.values({ userId: "alice", url: "https://example.test/jobs/43", role: "Engineer", snippet: "" })
			.returning();
		if (!second) throw new Error("Expected role");
		const results = await Promise.allSettled([
			jobs.dismissOpportunity("alice", second.id),
			jobs.dismissOpportunity("alice", "foreign"),
		]);
		expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
		await expect(careers.trackOpportunity("alice", second.id)).rejects.toMatchObject({ code: "CONFLICT" });
		const [third] = await getDb()
			.insert(tables.careerOpportunity)
			.values({ userId: "alice", url: "https://example.test/jobs/44", role: "Engineer", snippet: "" })
			.returning();
		if (!third) throw new Error("Expected role");
		await Promise.allSettled([jobs.dismissOpportunity("alice", third.id), careers.trackOpportunity("alice", third.id)]);
		expect(await jobs.opportunities("alice")).toEqual([]);
		const count = (await getDb().select().from(tables.application)).length;
		expect(count).toBeLessThanOrEqual(2);
	});

	it("records check time separately from search sightings, preserves historical unknowns and exports provenance", async () => {
		const careers = (await import("./service")).careerService;
		await schedule();
		await run();
		const [first] = await jobs.opportunities("alice");
		expect(first?.discoverySource).toMatchObject({
			query: "Reliability engineering roles",
			checkedAt: expect.any(String),
		});
		await schedule();
		await run();
		expect((await jobs.opportunities("alice"))[0]?.discoverySource).toEqual(first?.discoverySource);
		expect(fixture.read).toHaveBeenCalledTimes(1);
		expect((await careers.exportData("alice")).opportunities[0]?.discoverySource).toEqual(first?.discoverySource);
		await getDb().update(tables.careerOpportunity).set({ discoverySource: null });
		expect((await jobs.opportunities("alice"))[0]?.discoverySource).toBeNull();
	});

	it("measures a controlled discovery corpus without paid retrieval or AI", async () => {
		fixture.search.mockResolvedValue([
			...results,
			{ title: "Product designer", url: "https://example.test/jobs/design", description: "Design products." },
			{ title: "Closed role", url: "https://example.test/jobs/closed", description: "Closed" },
			{ title: "200 jobs", url: "https://example.test/jobs/list", description: "A board" },
			{ title: "Unreadable role", url: "https://example.test/jobs/unreadable", description: "Unavailable" },
		]);
		fixture.read.mockImplementation(async (url) => {
			if (url.endsWith("unreadable")) throw new Error("Synthetic timeout");
			if (url.endsWith("closed") || url.endsWith("list")) return null;
			return url.endsWith("design")
				? { ...posting, page: { ...posting.page, role: "Product designer", location: "" } }
				: posting;
		});
		await getDb()
			.insert(tables.careerProfile)
			.values({
				userId: "alice",
				data: (await import("@reactive-resume/schema/career")).careerProfileDataSchema.parse({
					targetRoles: ["Reliability engineer"],
					locations: ["Berlin"],
				}),
			});
		await schedule();
		await run();
		const rows = await jobs.opportunities("alice");
		expect(rows).toHaveLength(2);
		expect(new Set(rows.map((row) => row.url)).size).toBe(2);
		expect(rows.filter((row) => row.matches.includes("Reliability engineer"))).toHaveLength(1);
		expect(rows.filter((row) => row.discoverySource)).toHaveLength(2);
		expect(fixture.search).toHaveBeenCalledTimes(1);
		expect(fixture.read).toHaveBeenCalledTimes(8);
		await schedule();
		await run();
		expect(await jobs.opportunities("alice")).toHaveLength(2);
		expect(fixture.search).toHaveBeenCalledTimes(2);
		expect(fixture.read).toHaveBeenCalledTimes(10);
		expect(fixture.generate).not.toHaveBeenCalled();
	});

	it("reclaims an abandoned email attempt but never resends a delivered notification", async () => {
		const saved = await schedule();
		await getDb().update(tables.careerSchedule).set({ email: true }).where(eq(tables.careerSchedule.id, saved.id));
		await run();
		const [notice] = await jobs.notifications("alice");
		if (!notice) throw new Error("Expected a notification.");
		await getDb()
			.update(tables.careerNotification)
			.set({ emailedAt: null, emailAttemptedAt: new Date(Date.now() - 11 * 60_000) })
			.where(eq(tables.careerNotification.id, notice.id));
		fixture.email.mockClear();
		await run();
		expect(fixture.email).toHaveBeenCalledOnce();
		await run();
		expect(fixture.email).toHaveBeenCalledOnce();
	});

	it("deletes notifications read more than 90 days ago and keeps unread and recently read ones", async () => {
		const day = 24 * 60 * 60 * 1000;
		const old = new Date(Date.now() - 91 * day);
		await getDb()
			.insert(tables.careerNotification)
			.values([
				{ userId: "alice", key: "read-old", notice: { type: "schedule-failed", reason: "failed" }, readAt: old },
				{
					userId: "alice",
					key: "read-recent",
					notice: { type: "schedule-failed", reason: "failed" },
					readAt: new Date(Date.now() - 89 * day),
				},
				{ userId: "alice", key: "unread-old", notice: { type: "schedule-failed", reason: "failed" }, createdAt: old },
			]);
		await run();
		const keys = (await getDb().select({ key: tables.careerNotification.key }).from(tables.careerNotification)).map(
			(row) => row.key,
		);
		expect(keys.sort()).toEqual(["read-recent", "unread-old"]);
	});
});
