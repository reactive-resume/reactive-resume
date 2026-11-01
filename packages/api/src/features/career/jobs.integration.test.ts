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
			SMTP_HOST: undefined,
			SMTP_USER: undefined,
			SMTP_PASS: undefined,
			SMTP_FROM: undefined,
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
		const at = new Date(Date.now() + 3_600_000);
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
