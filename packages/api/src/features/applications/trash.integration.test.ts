import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createRouterClient } from "@orpc/server";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as tables from "@reactive-resume/db/schema";
import { careerStoryInputSchema, EMPTY_WORKSPACE } from "@reactive-resume/schema/career";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";

const fixture = vi.hoisted(() => ({ db: undefined as ReturnType<typeof drizzle> | undefined, directory: "" }));
vi.mock("@reactive-resume/db/client", () => ({
	get db() {
		return fixture.db;
	},
}));
vi.mock("@reactive-resume/env/server", () => ({
	env: {
		APP_URL: "http://localhost:3000",
		AUTH_SECRET: "isolated-trash-secret-at-least-32-characters",
		DATABASE_URL: "unused",
		STORAGE_BACKEND: "local",
		get LOCAL_STORAGE_PATH() {
			return fixture.directory;
		},
		FLAG_DISABLE_API_RATE_LIMIT: true,
	},
}));

const databaseUrl = process.env.INTEGRATIONS_TEST_DATABASE_URL ?? process.env.COVER_LETTER_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("application Trash: real retained rows, storage and concurrent owners", () => {
	let pool: Pool;
	let admin: Pool;
	let router: typeof import("./router").applicationsRouter;
	let storage: ReturnType<typeof import("../storage/service").getStorageService>;
	const namespace = `application_trash_${randomUUID().replaceAll("-", "")}`;
	const getDb = () => {
		if (!fixture.db) throw new Error("Fixture unavailable");
		return fixture.db;
	};
	const api = (
		userId = "alice",
		permissions: ("read" | "write" | "delete")[] = ["read", "write", "delete"],
		headers = new Headers(),
	) =>
		createRouterClient(router, {
			context: {
				locale: "en-US",
				reqHeaders: headers,
				authentication: { user: { id: userId }, method: "session", permissions },
			} as never,
		});
	beforeAll(async () => {
		fixture.directory = await mkdtemp(join(tmpdir(), "rr-application-trash-"));
		admin = new Pool({ connectionString: databaseUrl });
		await admin.query(`CREATE SCHEMA ${namespace}`);
		pool = new Pool({ connectionString: databaseUrl, max: 4, options: `-c search_path=${namespace}` });
		fixture.db = drizzle({ client: pool });
		const migrations = new URL("../../../../../migrations/", import.meta.url);
		for (const name of (await readdir(migrations)).filter((name) => /^\d+_/.test(name)).sort()) {
			await pool.query(
				(await readFile(new URL(`${name}/migration.sql`, migrations), "utf8")).replaceAll('"public".', ""),
			);
		}
		router = (await import("./router")).applicationsRouter;
		storage = (await import("../storage/service")).getStorageService();
	}, 30_000);
	afterAll(async () => {
		await pool?.end();
		await admin?.query(`DROP SCHEMA IF EXISTS ${namespace} CASCADE`);
		await admin?.end();
		if (fixture.directory) await rm(fixture.directory, { recursive: true, force: true });
	});
	beforeEach(async () => {
		await getDb().delete(tables.user);
		await getDb().delete(tables.releasedUsername);
		await getDb()
			.insert(tables.user)
			.values(
				["alice", "bob"].map((id) => ({
					id,
					name: id,
					email: `${id}@example.test`,
					username: id,
					displayUsername: id,
				})),
			);
	});
	const raw = async (id: string) => (await pool.query("SELECT * FROM application WHERE id=$1", [id])).rows[0];
	const trashRow = async (id: string) => {
		const row = (await api().listTrash({})).items.find((row) => row.id === id);
		if (!row) throw new Error("Missing Trash row");
		return { id: row.id, trashedAt: row.trashedAt };
	};
	const contents = (row: Record<string, unknown>) =>
		Object.fromEntries(Object.entries(row).filter(([key]) => !["trashed_at", "updated_at"].includes(key)));

	it("retains timeline, linked snapshots, workspace, facts, coach and real attachment bytes across reload/restore", async () => {
		await getDb()
			.insert(tables.resume)
			.values({ id: "resume", userId: "alice", name: "Fictional", slug: "fictional", data: defaultResumeData });
		const client = api();
		const id = await client.create({
			company: "Fictional Cedar",
			role: "Lead",
			resumeId: "resume",
			sourceUrl: "https://jobs.example.test/cedar",
		});
		await client.addNote({ id, text: "Retain this timeline" });
		const letter = await (
			await import("../cover-letters/service")
		).coverLetterService.create({
			userId: "alice",
			name: "Fictional letter",
			applicationId: id,
			resumeId: "resume",
			content: "<p>Retain submitted letter.</p>",
		});
		await client.update({ id, status: "applied" });
		await getDb()
			.insert(tables.careerStory)
			.values({
				id: "story",
				userId: "alice",
				applicationId: id,
				data: careerStoryInputSchema.parse({
					title: "Retained story",
					situation: "Fictional",
					task: "Retained",
					action: "Recorded",
					result: "Saved",
					factIds: [],
				}),
			});
		await getDb()
			.insert(tables.careerArtifact)
			.values({
				id: "artifact",
				userId: "alice",
				applicationId: id,
				title: "Saved Fit",
				data: {
					kind: "fit",
					headline: "Fictional fit",
					summary: "Saved result",
					requirements: [],
					checks: [],
					ask: null,
				},
				evidence: { factIds: [], storyIds: [] },
				inputVersion: "fixture",
			});
		await getDb()
			.insert(tables.careerWorkspace)
			.values({
				applicationId: id,
				userId: "alice",
				data: { ...EMPTY_WORKSPACE, evidence: { "Fictional requirement": "fact" } },
			})
			.onConflictDoUpdate({
				target: tables.careerWorkspace.applicationId,
				set: { data: { ...EMPTY_WORKSPACE, evidence: { "Fictional requirement": "fact" } } },
			});
		await getDb()
			.insert(tables.careerFact)
			.values({
				id: "fact",
				userId: "alice",
				applicationId: id,
				text: "Application-only fact",
				category: "experience",
				sourceKey: "manual:fact",
				source: { kind: "manual", id: "fact", quote: "Application-only fact" },
			});
		await getDb()
			.insert(tables.agentThread)
			.values({ id: "thread", userId: "alice", applicationId: id, scope: "application", title: "Retain coach" });
		await getDb()
			.insert(tables.agentMessage)
			.values({
				id: "message",
				userId: "alice",
				threadId: "thread",
				role: "user",
				sequence: 1,
				uiMessage: { id: "message", role: "user", parts: [{ type: "text", text: "Retain conversation" }] },
			});
		await getDb()
			.insert(tables.careerSchedule)
			.values({
				id: "schedule",
				userId: "alice",
				applicationId: id,
				kind: "follow-up",
				nextRunAt: new Date("2035-01-01"),
				enabled: true,
			});
		await getDb()
			.insert(tables.careerJob)
			.values({ id: "job", userId: "alice", scheduleId: "schedule", dueAt: new Date("2035-01-01") });
		const file = "uploads/alice/pictures/retained.pdf";
		const privateFile = "uploads/alice/agent/thread/file";
		await storage.write({ key: file, data: Buffer.from("%PDF-retained-resume"), contentType: "application/pdf" });
		await storage.write({
			key: privateFile,
			data: Buffer.from("private attachment"),
			contentType: "text/plain",
			private: true,
		});
		await getDb().insert(tables.agentAttachment).values({
			id: "attachment",
			userId: "alice",
			threadId: "thread",
			messageId: "message",
			storageKey: privateFile,
			filename: "fixture.txt",
			mediaType: "text/plain",
			size: 18,
		});
		await pool.query("UPDATE application SET resume_file_url=$2 WHERE id=$1", [id, `/api/${file}`]);
		const before = await raw(id);
		const related = async () =>
			Promise.all(
				[
					"career_workspace",
					"career_fact",
					"career_story",
					"career_artifact",
					"career_schedule",
					"agent_threads",
					"agent_messages",
					"agent_attachments",
					"resume_version",
					"cover_letter",
					"cover_letter_version",
				].map(async (table) => (await pool.query(`SELECT * FROM ${table} ORDER BY 1`)).rows),
			);
		const relationships = await related();
		await client.trash({ id });
		expect(contents(await raw(id))).toEqual(contents(before));
		expect((await raw(id)).trashed_at).toBeInstanceOf(Date);
		expect(await related()).toEqual(relationships);
		expect((await pool.query("SELECT status FROM career_job WHERE id='job'")).rows[0].status).toBe("canceled");
		const publicBytes = await storage.read(file);
		const privateBytes = await storage.read(privateFile);
		if (!publicBytes || !privateBytes) throw new Error("Trash removed a retained attachment");
		expect(Buffer.from(publicBytes.data).toString()).toBe("%PDF-retained-resume");
		expect(Buffer.from(privateBytes.data).toString()).toBe("private attachment");
		expect(await api().list({})).toEqual([]);
		expect(await api().listSummary({})).toEqual([]);
		expect((await api().stats({})).total).toBe(0);
		const career = (await import("../career/service")).careerService;
		expect(await career.facts({ userId: "alice", all: true })).toEqual([]);
		expect(await career.savedItems({ userId: "alice", kind: "fit" })).toEqual([]);
		const opportunities = async () => {
			const tools = (await import("../career/tools")).buildCareerTools({
				userId: "alice",
				context: await career.context({ userId: "alice" }),
				shareApplication: true,
				shareMemory: false,
				tab: undefined,
				sourceMessageId: undefined,
			});
			return tools.list_opportunities?.execute?.({}, { toolCallId: "compare", messages: [], context: {} });
		};
		expect(await opportunities()).toEqual([]);
		const backup = await (
			await import("../auth/service")
		).authService.exportData({ userId: "alice", includeUploads: true });
		expect(backup.applications).toMatchObject([{ id, trashedAt: expect.any(Date) }]);
		expect(backup.career.stories).toHaveLength(1);
		expect(backup.uploads?.files).toEqual(
			expect.arrayContaining([
				{ key: file, base64: Buffer.from("%PDF-retained-resume").toString("base64") },
				{ key: privateFile, base64: Buffer.from("private attachment").toString("base64") },
			]),
		);
		await expect(api().getById({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(api().update({ id, notes: "late edit" })).rejects.toMatchObject({ code: "NOT_FOUND" });
		const entry = await trashRow(id); // Fresh authenticated read, independent of the deletion caller.
		await api().restore(entry);
		expect(contents(await raw(id))).toEqual(contents(before));
		expect((await api().getById({ id })).sentResumeVersionId).toBe(before.sent_resume_version_id);
		expect((await api().getById({ id })).sentCoverLetterVersionId).toBe(before.sent_cover_letter_version_id);
		expect(await career.facts({ userId: "alice", all: true })).toHaveLength(1);
		expect(await career.savedItems({ userId: "alice", kind: "fit" })).toHaveLength(1);
		expect(await opportunities()).toMatchObject([{ id }]);
		expect(await related()).toEqual(relationships);
		await expect(api().purge(entry)).rejects.toMatchObject({ code: "CONFLICT" });
		await api().trash({ id });
		const next = await trashRow(id);
		expect(next.trashedAt.getTime()).toBeGreaterThan(entry.trashedAt.getTime());
		await expect(api().restore(entry)).rejects.toMatchObject({ code: "CONFLICT" });
		await expect(api().purge(entry)).rejects.toMatchObject({ code: "CONFLICT" });
		await api().purge(next);
		expect(await raw(id)).toBeUndefined();
		expect(await storage.read(file)).toBeNull();
		expect(await storage.read(privateFile)).toBeNull();
		expect((await pool.query("SELECT id FROM resume WHERE id='resume'")).rows).toHaveLength(1);
		expect((await pool.query("SELECT id FROM resume_version WHERE resume_id='resume'")).rows.length).toBeGreaterThan(0);
		expect((await pool.query("SELECT id FROM cover_letter WHERE id=$1", [letter.id])).rows).toHaveLength(1);
	});

	it("keeps bulk deletion recoverable, owner-scoped and delete-permission protected, including old DELETE aliases", async () => {
		const first = await api().create({ company: "First", role: "Lead" });
		const second = await api().create({ company: "Second", role: "Lead" });
		const foreign = await api("bob").create({ company: "Other account", role: "Lead" });
		await expect(api("alice", ["read", "write"]).trash({ id: first })).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(api("alice", ["read", "write"]).bulkTrash({ ids: [first] })).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
		await expect(
			api("alice", undefined, new Headers({ "x-account-id": "bob" })).trash({ id: first }),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(await api().bulkDelete({ ids: [first, second, foreign] })).toEqual({ deleted: 2 });
		expect((await api().listTrash({ limit: 1, offset: 1 })).items).toHaveLength(1);
		expect((await api().listTrash({})).total).toBe(2);
		expect((await api("bob").getById({ id: foreign })).id).toBe(foreign);
		const entry = await trashRow(first);
		await expect(api("bob").restore(entry)).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(api("bob").purge(entry)).rejects.toMatchObject({ code: "NOT_FOUND" });
		await api().restore(entry);
		await api().delete({ id: first });
		expect((await raw(first)).trashed_at).toBeInstanceOf(Date);
	});

	it("refuses a queued stale purge after another transaction restores the application", async () => {
		const id = await api().create({ company: "Concurrent", role: "Lead" });
		await api().trash({ id });
		const entry = await trashRow(id);
		const blocker = await pool.connect();
		await blocker.query("BEGIN");
		await blocker.query('SELECT id FROM "user" WHERE id=$1 FOR NO KEY UPDATE', ["alice"]);
		const [{ pid }] = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows;
		const pending = api()
			.purge(entry)
			.then(
				() => null,
				(error: unknown) => error,
			);
		try {
			await vi.waitFor(async () => {
				const { rows } = await pool.query("SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))", [
					pid,
				]);
				expect(rows.length).toBeGreaterThan(0);
			});
			await blocker.query(
				"UPDATE application SET trashed_at=NULL, updated_at=updated_at+interval '1 millisecond' WHERE id=$1",
				[id],
			);
			await blocker.query("COMMIT");
			expect(await pending).toMatchObject({ code: "CONFLICT" });
			expect((await api().getById({ id })).id).toBe(id);
		} finally {
			await blocker.query("ROLLBACK");
			blocker.release();
		}
	});

	it.each(["application", "fact", "story"])(
		"refuses a %s write that read before Trash and reaches its owner lock afterwards",
		async (kind) => {
			const id = await api().create({ company: "Concurrent edit", role: "Lead", notes: "Keep this" });
			const career = (await import("../career/service")).careerService;
			const blocker = await pool.connect();
			await blocker.query("BEGIN");
			await blocker.query('SELECT id FROM "user" WHERE id=$1 FOR NO KEY UPDATE', ["alice"]);
			const [{ pid }] = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows;
			const write =
				kind === "application"
					? api().update({ id, notes: "Stale edit" })
					: kind === "fact"
						? career.saveFact("alice", {
								applicationId: id,
								text: "Late fact",
								category: "experience",
								source: { kind: "manual", id: "late", quote: "Late fact" },
							})
						: career.saveStory(
								"alice",
								careerStoryInputSchema.parse({
									applicationId: id,
									title: "Late story",
									situation: "Fictional",
									task: "Late",
									action: "Late",
									result: "Late",
									factIds: [],
								}),
							);
			const pending = write.then(
				() => null,
				(error: unknown) => error,
			);
			try {
				await vi.waitFor(async () => {
					const { rows } = await pool.query("SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))", [
						pid,
					]);
					expect(rows.length).toBeGreaterThan(0);
				});
				await blocker.query(
					"UPDATE application SET trashed_at=date_trunc('milliseconds',clock_timestamp()) WHERE id=$1",
					[id],
				);
				await blocker.query("COMMIT");
				expect(await pending).toMatchObject({ code: "NOT_FOUND" });
				expect((await raw(id)).notes).toBe("Keep this");
				expect((await raw(id)).trashed_at).toBeInstanceOf(Date);
				expect(await getDb().select().from(tables.careerFact)).toEqual([]);
				expect(await getDb().select().from(tables.careerStory)).toEqual([]);
			} finally {
				await blocker.query("ROLLBACK");
				blocker.release();
			}
		},
	);

	it("preserves shared attachment bytes until the last referencing application is permanently removed", async () => {
		const first = await api().create({ company: "First retained", role: "Lead" });
		const second = await api().create({ company: "Second retained", role: "Lead" });
		const key = "uploads/alice/pictures/shared.pdf";
		await storage.write({ key, data: Buffer.from("%PDF-shared"), contentType: "application/pdf" });
		await pool.query("UPDATE application SET resume_file_url=$1 WHERE id=ANY($2::text[])", [
			`/api/${key}`,
			[first, second],
		]);
		await api().bulkTrash({ ids: [first, second] });
		await api().purge(await trashRow(first));
		expect(await storage.read(key)).not.toBeNull();
		await api().restore(await trashRow(second));
		expect((await api().getById({ id: second })).resumeFileUrl).toBe(`/api/${key}`);
		await api().trash({ id: second });
		await api().purge(await trashRow(second));
		expect(await storage.read(key)).toBeNull();
	});

	it("still unlinks forgotten shared Knowledge from retained stories in Trash", async () => {
		const id = await api().create({ company: "Retained", role: "Lead" });
		await getDb()
			.insert(tables.careerFact)
			.values({
				id: "shared-fact",
				userId: "alice",
				text: "Shared evidence",
				category: "experience",
				sourceKey: "shared",
				source: { kind: "manual", id: "shared", quote: "Shared evidence" },
			});
		await getDb()
			.insert(tables.careerStory)
			.values({
				id: "retained-story",
				userId: "alice",
				applicationId: id,
				data: careerStoryInputSchema.parse({
					title: "Retained",
					situation: "Fictional",
					task: "Retain",
					action: "Record",
					result: "Saved",
					factIds: ["shared-fact"],
				}),
			});
		await api().trash({ id });
		await (await import("../career/service")).careerService.forgetFact("alice", "shared-fact");
		await api().restore(await trashRow(id));
		const story = (await getDb().select().from(tables.careerStory))[0];
		expect(story?.data.factIds).toEqual([]);
	});
});
