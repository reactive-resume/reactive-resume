import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ORPCError } from "@orpc/client";
import { createRouterClient } from "@orpc/server";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";

const fixture = vi.hoisted(() => ({
	db: undefined as ReturnType<typeof drizzle> | undefined,
	pool: undefined as Pool | undefined,
}));
vi.mock("@reactive-resume/db/client", () => ({
	get db() {
		return fixture.db;
	},
}));
vi.mock("../../context", async () => {
	const { os } = await vi.importActual<typeof import("@orpc/server")>("@orpc/server");
	return { protectedProcedure: os.$context<{ user: { id: string } }>() };
});
vi.mock("../resume/service", () => ({
	resumeService: {
		getById: async ({ id, userId }: { id: string; userId: string }) => {
			const result = await getPool().query("SELECT id, data FROM resume WHERE id=$1 AND user_id=$2", [id, userId]);
			if (!result.rows[0]) throw new ORPCError("NOT_FOUND");
			return result.rows[0];
		},
	},
}));

function getPool(): Pool {
	if (!fixture.pool) throw new Error("Test database is not initialized");
	return fixture.pool;
}

// Opt-in real PostgreSQL tests. Use a disposable database; all tables live in an isolated schema.
describe.skipIf(!process.env.COVER_LETTER_TEST_DATABASE_URL)("cover-letter owned persistence", () => {
	let service: typeof import("./service").coverLetterService;
	const schemaName = `cover_letter_test_${randomUUID().replaceAll("-", "")}`;
	let admin: Pool;

	beforeAll(async () => {
		admin = new Pool({ connectionString: process.env.COVER_LETTER_TEST_DATABASE_URL });
		await admin.query(`CREATE SCHEMA ${schemaName}`);
		fixture.pool = new Pool({
			connectionString: process.env.COVER_LETTER_TEST_DATABASE_URL,
			options: `-c search_path=${schemaName}`,
		});
		fixture.db = drizzle({ client: fixture.pool });
		await fixture.pool.query(
			`CREATE TABLE "user" (id text PRIMARY KEY); CREATE TABLE resume (id text PRIMARY KEY, user_id text, data jsonb); CREATE TABLE application (id text PRIMARY KEY, user_id text, company text NOT NULL DEFAULT '', contacts jsonb NOT NULL DEFAULT '[]', cover_letter_id text, updated_at timestamptz, resume_id text, status text DEFAULT 'saved', sent_resume_version_id text);`,
		);
		// The migrations that shape the letter tables, in order.
		for (const name of ["20260905121445_cover_letter_library", "20261001042749_v6_release"]) {
			const migration = await readFile(
				new URL(`../../../../../migrations/${name}/migration.sql`, import.meta.url),
				"utf8",
			);
			// This fixture owns only the letter tables; full upgrade coverage lives in the DB package.
			for (const statement of migration.split("--> statement-breakpoint")) {
				const sql = statement.trim().replace(/^--[^\n]*\n/, "");
				if (
					/^(?:CREATE TABLE|ALTER TABLE) "cover_letter(?:_version)?"|^CREATE (?:UNIQUE )?INDEX .* ON "cover_letter(?:_version)?"/.test(
						sql,
					) ||
					/^ALTER TABLE "application" .*"sent_cover_letter_version_id"/.test(sql)
				) {
					await fixture.pool.query(sql.replaceAll('"public".', ""));
				}
			}
		}
		service = (await import("./service")).coverLetterService;
	});
	afterAll(async () => {
		await fixture.pool?.end();
		await admin?.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
		await admin?.end();
	});
	beforeEach(async () => {
		await getPool().query('TRUNCATE "user",resume,application,cover_letter CASCADE');
		await getPool().query("INSERT INTO \"user\" VALUES ('alice'),('bob')");
		await getPool().query("INSERT INTO resume VALUES ('alice-resume','alice',$1),('bob-resume','bob',$1)", [
			defaultResumeData,
		]);
		await getPool().query("INSERT INTO application VALUES ('alice-app','alice'),('bob-app','bob')");
	});

	it("persists one shared document and atomically rejects stale writers and deletes", async () => {
		const created = await service.create({ userId: "alice", name: "Draft", content: "<p>First</p>" });
		const saved = await service.update({
			userId: "alice",
			id: created.id,
			expectedRevision: 1,
			content: "<p>Second</p>",
		});
		expect(saved.revision).toBe(2);
		expect((await service.getById({ userId: "alice", id: created.id })).content).toBe("<p>Second</p>");
		await expect(
			service.update({ userId: "alice", id: created.id, expectedRevision: 1, name: "Stale" }),
		).rejects.toMatchObject({ code: "CONFLICT" });
		await expect(service.delete({ userId: "alice", id: created.id, expectedRevision: 1 })).rejects.toMatchObject({
			code: "CONFLICT",
		});
	});

	it("keeps submitted letters and their snapshots intact through every linking path", async () => {
		const original = await service.create({ userId: "alice", name: "Submitted", applicationId: "alice-app" });
		const version = await service.recordSent({ userId: "alice", id: original.id, company: "Lumen" });
		await getPool().query("UPDATE application SET sent_cover_letter_version_id=$1 WHERE id='alice-app'", [version.id]);
		const replacement = await service.create({ userId: "alice", name: "Replacement" });
		const { documentsService } = await import("../documents/service");
		for (const change of [
			() =>
				documentsService.linkApplication({
					userId: "alice",
					type: "letter",
					id: replacement.id,
					applicationId: "alice-app",
				}),
			() => service.update({ userId: "alice", id: replacement.id, expectedRevision: 1, applicationId: "alice-app" }),
			() => service.update({ userId: "alice", id: original.id, expectedRevision: 1, applicationId: null }),
		]) {
			await expect(change()).rejects.toMatchObject({ code: "BAD_REQUEST" });
			const application = (
				await getPool().query(
					"SELECT cover_letter_id, sent_cover_letter_version_id FROM application WHERE id='alice-app'",
				)
			).rows[0];
			expect(application).toEqual({ cover_letter_id: original.id, sent_cover_letter_version_id: version.id });
			expect(await service.getById({ userId: "alice", id: replacement.id })).toMatchObject({
				revision: 1,
				sourceApplicationId: null,
			});
		}
		const { getLetterVersion } = await import("./versions");
		expect(
			await getLetterVersion({ userId: "alice", coverLetterId: original.id, versionId: version.id }),
		).toMatchObject({ data: { name: "Submitted" } });
	});

	it("lists permanent checkpoints behind more than 100 recent autosaves", async () => {
		const letter = await service.create({ userId: "alice", name: "Long history" });
		const named = await service.createVersion({ userId: "alice", id: letter.id, name: "Keep forever" });
		const sent = await service.recordSent({ userId: "alice", id: letter.id, company: "Lumen" });
		await getPool().query(
			`INSERT INTO cover_letter_version (id, cover_letter_id, user_id, data, kind, created_at)
			SELECT 'auto-' || n, $1, 'alice', '{}'::jsonb, 'auto', now() + n * interval '1 second' FROM generate_series(1,120) n`,
			[letter.id],
		);
		const { listLetterVersions } = await import("./versions");
		const versions = await listLetterVersions({ userId: "alice", coverLetterId: letter.id });
		expect(versions.map((version) => version.id)).toEqual(expect.arrayContaining([named.id, sent.id]));
		expect(versions.filter((version) => version.kind === "auto")).toHaveLength(100);
		await expect(listLetterVersions({ userId: "bob", coverLetterId: letter.id })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("accepts procedure defaults, rejects invalid input, and permits only one concurrent writer", async () => {
		const { coverLettersRouter } = await import("./router");
		const client = createRouterClient(coverLettersRouter, { context: { user: { id: "alice" } } as never });
		const created = await client.create({ name: "Through procedure" });
		expect(created).toMatchObject({ recipient: "", content: "", revision: 1 });
		await expect(client.create({ name: " " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(client.list({ limit: 101 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
		const results = await Promise.allSettled([
			client.update({ id: created.id, expectedRevision: 1, content: "First editor" }),
			client.update({ id: created.id, expectedRevision: 1, content: "Second editor" }),
		]);
		expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
		expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT" } });
	});

	it("saves letters a resume still carries as linked letters, once, and leaves the resume without them", async () => {
		const { adoptEmbeddedLetters } = await import("./embedded");
		const data = structuredClone(defaultResumeData);
		data.basics.name = "Alice Sender";
		data.customSections = [
			{
				id: "embedded",
				title: "Embedded Letter",
				type: "cover-letter",
				icon: "",
				columns: 1,
				hidden: true,
				keepTogether: false,
				startOnNewPage: false,
				items: [{ id: "embedded-item", hidden: true, recipient: "<p>Recipient</p>", content: "<p>Original</p>" }],
			},
		];
		data.metadata.layout.pages = [{ fullWidth: true, main: ["experience", "embedded"], sidebar: [] }];
		const adopt = (input: typeof data) =>
			adoptEmbeddedLetters(fixture.db as never, {
				userId: "alice",
				resumeId: "alice-resume",
				resumeName: "Frontend",
				data: input,
			});

		const again = structuredClone(data);
		await adopt(data);
		expect(data.customSections).toEqual([]);
		expect(data.metadata.layout.pages).toEqual([{ fullWidth: true, main: ["experience"], sidebar: [] }]);

		const letters = await service.list({ userId: "alice", limit: 20, offset: 0 });
		expect(letters.items).toHaveLength(1);
		const [letter] = letters.items;
		if (!letter) throw new Error("Missing letter.");
		expect(letter).toMatchObject({
			name: "Frontend — Embedded Letter",
			recipient: "<p>Recipient</p>",
			content: "<p>Original</p>",
			layout: "freeform",
			sourceResumeId: "alice-resume",
			senderLinked: true,
			designLinked: true,
			style: { sectionId: "embedded", itemId: "embedded-item" },
		});
		const versions = await getPool().query("SELECT kind FROM cover_letter_version WHERE cover_letter_id=$1", [
			letter.id,
		]);
		expect(versions.rows).toEqual([{ kind: "created" }]);

		// The same section sent again (an older tab still open) doesn't save a second letter.
		await adopt(again);
		expect((await service.list({ userId: "alice", limit: 20, offset: 0 })).items).toHaveLength(1);
	});

	it("isolates every read, mutation, export and context selection by account", async () => {
		const created = await service.create({ userId: "alice", name: "Private" });
		const foreign = { userId: "bob", id: created.id, expectedRevision: 1 };
		for (const operation of [
			() => service.getById(foreign),
			() => service.update({ ...foreign, name: "Stolen" }),
			() => service.delete(foreign),
			() => service.duplicate(foreign),
			() => service.export(foreign),
			() => service.refreshStyle({ ...foreign, resumeId: "bob-resume" }),
		]) {
			await expect(operation()).rejects.toMatchObject({ code: "NOT_FOUND" });
		}
		expect((await service.list({ userId: "bob", limit: 20, offset: 0 })).items).toEqual([]);
		await expect(service.create({ userId: "alice", name: "Invalid", resumeId: "bob-resume" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(service.create({ userId: "alice", name: "Invalid", applicationId: "bob-app" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("starts structured from the application, linked to the resume's details and design", async () => {
		await getPool().query(
			`UPDATE application SET company='Lumen Health', contacts='[{"name":"Dana Reyes"}]' WHERE id='alice-app'`,
		);
		const created = await service.create({
			userId: "alice",
			name: "For Lumen",
			resumeId: "alice-resume",
			applicationId: "alice-app",
		});
		// It becomes the application's letter.
		const linked = await getPool().query("SELECT cover_letter_id FROM application WHERE id='alice-app'");
		expect(linked.rows[0].cover_letter_id).toBe(created.id);
		expect(created).toMatchObject({
			layout: "structured",
			recipientName: "Dana Reyes",
			recipientCompany: "Lumen Health",
			letterDate: new Date().toISOString().slice(0, 10),
			senderLinked: true,
			designLinked: true,
		});
		// A recipient block keeps a letter freeform, and a template of its own leaves the design unlinked.
		const freeform = await service.create({
			userId: "alice",
			name: "Freeform",
			recipient: "<p>Hiring team</p>",
			resumeId: "alice-resume",
			template: "pikachu",
		});
		expect(freeform).toMatchObject({ layout: "freeform", senderLinked: true, designLinked: false });
		expect(freeform.style.metadata.template).toBe("pikachu");
		// Without a resume there's nothing to link to.
		expect(await service.create({ userId: "alice", name: "Plain" })).toMatchObject({
			senderLinked: false,
			designLinked: false,
		});

		// Moving the letter to another application takes it along.
		await getPool().query("INSERT INTO application (id, user_id) VALUES ('alice-app-2','alice')");
		await service.update({ userId: "alice", id: created.id, expectedRevision: 1, applicationId: "alice-app-2" });
		const moved = await getPool().query(
			"SELECT id, cover_letter_id FROM application WHERE user_id='alice' ORDER BY id",
		);
		expect(moved.rows).toEqual([
			{ id: "alice-app", cover_letter_id: null },
			{ id: "alice-app-2", cover_letter_id: created.id },
		]);
	});

	it("reads linked details and design live, keeps them as they read when unlinked, and outlives the resume", async () => {
		const created = await service.create({
			userId: "alice",
			name: "Keep",
			content: "<p>Keep body</p>",
			resumeId: "alice-resume",
		});
		const changed = structuredClone(defaultResumeData);
		changed.basics.name = "New sender";
		changed.metadata.template = "gengar";
		await getPool().query("UPDATE resume SET data=$1 WHERE id='alice-resume'", [changed]);
		expect((await service.getById({ userId: "alice", id: created.id })).style).toMatchObject({
			basics: { name: "New sender" },
			metadata: { template: "gengar" },
		});

		const unlinked = await service.update({
			userId: "alice",
			id: created.id,
			expectedRevision: 1,
			senderLinked: false,
		});
		expect(unlinked).toMatchObject({
			senderLinked: false,
			designLinked: true,
			style: { basics: { name: "New sender" } },
		});
		changed.basics.name = "Later sender";
		changed.metadata.template = "azurill";
		await getPool().query("UPDATE resume SET data=$1 WHERE id='alice-resume'", [changed]);
		expect((await service.getById({ userId: "alice", id: created.id })).style).toMatchObject({
			basics: { name: "New sender" },
			metadata: { template: "azurill" },
		});

		// Choosing a template of the letter's own ends the design link, keeping the rest of the design as it read.
		const own = await service.update({ userId: "alice", id: created.id, expectedRevision: 2, template: "ditto" });
		expect(own).toMatchObject({ designLinked: false, style: { metadata: { template: "ditto" } } });

		await expect(
			service.update({ userId: "alice", id: created.id, expectedRevision: 3, resumeId: null, senderLinked: true }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });

		// Once the resume is gone, the letter reads from its copies and is no longer linked.
		const relinked = await service.update({
			userId: "alice",
			id: created.id,
			expectedRevision: 3,
			senderLinked: true,
		});
		expect(relinked.style.basics.name).toBe("Later sender");
		await getPool().query("DELETE FROM resume WHERE id='alice-resume'");
		const orphaned = await service.getById({ userId: "alice", id: created.id });
		expect(orphaned).toMatchObject({ sourceResumeId: null, senderLinked: false, content: "<p>Keep body</p>" });
		expect(
			(await service.update({ userId: "alice", id: created.id, expectedRevision: 4, name: "Still editable" })).name,
		).toBe("Still editable");
	});

	it("keeps History: one version per session, named and sent versions, and restores with a way back", async () => {
		const created = await service.create({ userId: "alice", name: "History", content: "<p>One</p>" });
		const kinds = async () =>
			(await getPool().query("SELECT kind, name FROM cover_letter_version ORDER BY created_at, id")).rows;
		expect(await kinds()).toEqual([{ kind: "created", name: null }]);

		// Saves in one session share a version.
		const edit = { userId: "alice", id: created.id, sessionId: "session-a" };
		await service.update({ ...edit, expectedRevision: 1, content: "<p>Two</p>" });
		await service.update({ ...edit, expectedRevision: 2, content: "<p>Three</p>" });
		expect(await kinds()).toEqual([
			{ kind: "created", name: null },
			{ kind: "auto", name: null },
		]);

		const named = await service.createVersion({ userId: "alice", id: created.id, name: "Before the rewrite" });
		await service.update({ ...edit, expectedRevision: 3, content: "<p>Rewritten</p>", recipientName: "Dana" });
		await service.recordSent({ userId: "alice", id: created.id, company: "Lumen Health" });

		const restored = await service.restoreVersion({ userId: "alice", id: created.id, versionId: named.id });
		expect(restored).toMatchObject({ content: "<p>Three</p>", recipientName: "", revision: 5 });
		expect((await kinds()).map((row) => row.kind)).toEqual([
			"created",
			"auto",
			"named",
			"sent",
			"before-restore",
			"restored",
		]);
		const [beforeRestore] = (await getPool().query("SELECT data FROM cover_letter_version WHERE kind='before-restore'"))
			.rows;
		expect(beforeRestore.data).toMatchObject({ content: "<p>Rewritten</p>", recipientName: "Dana" });
		const [sent] = (await getPool().query("SELECT name, data FROM cover_letter_version WHERE kind='sent'")).rows;
		expect(sent).toMatchObject({ name: "Lumen Health", data: { content: "<p>Rewritten</p>" } });

		// Only named versions can be renamed or deleted, and only by their owner.
		const { deleteLetterVersion, renameLetterVersion } = await import("./versions");
		await expect(
			renameLetterVersion({ coverLetterId: created.id, userId: "bob", versionId: named.id, name: "Mine" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(service.restoreVersion({ userId: "bob", id: created.id, versionId: named.id })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		await deleteLetterVersion({ coverLetterId: created.id, userId: "alice", versionId: named.id });
		const [created0] = (await getPool().query("SELECT id FROM cover_letter_version WHERE kind='created'")).rows;
		await expect(
			deleteLetterVersion({ coverLetterId: created.id, userId: "alice", versionId: created0.id }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("round-trips standalone exports without foreign provenance and sanitizes all writes", async () => {
		const created = await service.create({
			userId: "alice",
			name: "Original",
			resumeId: "alice-resume",
			content: '<p onclick="evil()">Safe<script>evil()</script></p>',
		});
		expect(created.content).toBe("<p>Safe</p>");
		const document = await service.export({ userId: "alice", id: created.id });
		const imported = await service.import({ userId: "bob", document });
		expect(imported.id).not.toBe(created.id);
		expect(imported).toMatchObject({ sourceResumeId: null, sourceApplicationId: null, content: "<p>Safe</p>" });
		const copy = await service.duplicate({ userId: "alice", id: created.id });
		await service.delete({ userId: "alice", id: created.id, expectedRevision: 1 });
		expect((await service.getById({ userId: "alice", id: copy.id })).content).toBe("<p>Safe</p>");
	});
});
