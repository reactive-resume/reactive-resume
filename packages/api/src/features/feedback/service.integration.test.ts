import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
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

const databaseUrl = process.env.INTEGRATIONS_TEST_DATABASE_URL ?? process.env.COVER_LETTER_TEST_DATABASE_URL;

// Real PostgreSQL, opt-in only, in a schema of its own built from the shipped migrations.
describe.skipIf(!databaseUrl)("feedback links", () => {
	let feedback: typeof import("./service").feedbackService;
	let admin: Pool;
	let pool: Pool;
	const schemaName = `feedback_${randomUUID().replaceAll("-", "")}`;
	const db = () => {
		if (!fixture.db) throw new Error("Test database is not initialized.");
		return fixture.db;
	};

	beforeAll(async () => {
		admin = new Pool({ connectionString: databaseUrl });
		await admin.query(`CREATE SCHEMA ${schemaName}`);
		pool = new Pool({ connectionString: databaseUrl, max: 4, options: `-c search_path=${schemaName}` });
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
		feedback = (await import("./service")).feedbackService;
	}, 30_000);

	afterAll(async () => {
		await pool?.end();
		await admin?.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
		await admin?.end();
	});

	const tokenOf = (url: string) => url.slice(url.lastIndexOf("/") + 1);

	beforeEach(async () => {
		await pool.query('TRUNCATE released_username, storage_cleanup_job, "user" CASCADE');
		await db()
			.insert(tables.user)
			.values(
				["priya", "sam"].map((id) => ({
					id,
					name: id === "priya" ? "Priya Raman" : "Sam",
					email: `${id}@example.test`,
					username: id,
					displayUsername: id,
				})),
			);
		const data = structuredClone(defaultResumeData);
		data.basics.name = "Priya Raman";
		data.metadata.notes = "Private: ask about the gap";
		data.summary.content = "<p>Platform engineer.</p>";
		await db()
			.insert(tables.resume)
			.values([
				{ id: "cv", userId: "priya", name: "Platform CV", slug: "platform-cv", data },
				{ id: "other-cv", userId: "sam", name: "Sam CV", slug: "sam-cv", data: defaultResumeData },
			]);
		await db()
			.insert(tables.application)
			.values([
				{
					id: "job",
					userId: "priya",
					company: "Lumen Labs",
					role: "Platform Engineer",
					status: "interview",
					notes: "Salary talk on Friday",
					salary: "$180k",
				},
				{ id: "hidden-job", userId: "priya", company: "Orbit", role: "SRE", status: "applied" },
				{ id: "sams-job", userId: "sam", company: "Elsewhere", role: "PM", status: "applied" },
			]);
	});

	it("shares one saved version, the chosen applications' stages and nothing private", async () => {
		const link = await feedback.create({
			userId: "priya",
			resumeId: "cv",
			label: "Coach Ana",
			allowComments: true,
			applicationIds: ["job"],
			expiresAt: null,
		});
		expect(link).toMatchObject({ status: "active", commentCount: 0, applicationIds: ["job"] });

		// Later edits don't reach the reviewer: comments are about the version that was sent.
		const edited = structuredClone(defaultResumeData);
		edited.summary.content = "<p>Rewritten.</p>";
		await db().update(tables.resume).set({ data: edited }).where(eq(tables.resume.id, "cv"));

		const view = await feedback.view({ token: tokenOf(link.url) });
		expect(view.ownerName).toBe("Priya Raman");
		expect(view.data.summary.content).toBe("<p>Platform engineer.</p>");
		expect(view.data.metadata.notes).toBe("");
		expect(view.applications).toEqual([
			expect.objectContaining({ company: "Lumen Labs", role: "Platform Engineer", status: "interview" }),
		]);
		expect(JSON.stringify(view)).not.toMatch(/Salary talk|180k|Orbit/);
	});

	it("refuses another account's resume or applications", async () => {
		const base = { userId: "priya", label: "Coach", allowComments: true, expiresAt: null };
		await expect(feedback.create({ ...base, resumeId: "other-cv", applicationIds: [] })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(feedback.create({ ...base, resumeId: "cv", applicationIds: ["sams-job"] })).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
		await expect(
			feedback.get({ id: (await feedback.create({ ...base, resumeId: "cv", applicationIds: [] })).id, userId: "sam" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("takes comments without changing the resume, and records activity", async () => {
		const link = await feedback.create({
			userId: "priya",
			resumeId: "cv",
			label: "Coach Ana",
			allowComments: true,
			applicationIds: [],
			expiresAt: null,
		});
		const token = tokenOf(link.url);
		await feedback.view({ token });
		await feedback.view({ token });
		const comment = await feedback.comment({ token, authorName: "Ana", body: "Lead with the migration project." });

		const [resume] = await db()
			.select({ data: tables.resume.data })
			.from(tables.resume)
			.where(eq(tables.resume.id, "cv"));
		expect(resume?.data.summary.content).toBe("<p>Platform engineer.</p>");

		const detail = await feedback.get({ id: link.id, userId: "priya" });
		expect(detail.comments).toEqual([expect.objectContaining({ authorName: "Ana", resolvedAt: null })]);
		expect(detail.openCommentCount).toBe(1);
		// Two views within the hour count once.
		expect(detail.events.map((event) => event.type).toSorted()).toEqual(["commented", "created", "viewed"]);

		const resolved = await feedback.resolveComment({
			id: link.id,
			commentId: comment.id,
			resolved: true,
			userId: "priya",
		});
		expect(resolved.resolvedAt).toBeInstanceOf(Date);
		await expect(
			feedback.resolveComment({ id: link.id, commentId: comment.id, resolved: false, userId: "sam" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("doesn't count the owner's own visit as a view", async () => {
		const link = await feedback.create({
			userId: "priya",
			resumeId: "cv",
			label: "Coach",
			allowComments: false,
			applicationIds: [],
			expiresAt: null,
		});
		await feedback.view({ token: tokenOf(link.url), viewerId: "priya" });
		const detail = await feedback.get({ id: link.id, userId: "priya" });
		expect(detail.lastViewedAt).toBeNull();
		expect(detail.events.map((event) => event.type)).toEqual(["created"]);
	});

	it("stops opening once revoked or expired, keeping earlier comments", async () => {
		const link = await feedback.create({
			userId: "priya",
			resumeId: "cv",
			label: "Coach",
			allowComments: true,
			applicationIds: [],
			expiresAt: null,
		});
		const token = tokenOf(link.url);
		await feedback.comment({ token, authorName: "Ana", body: "Looks good." });
		await expect(feedback.revoke({ id: link.id, userId: "priya" })).resolves.toMatchObject({ status: "revoked" });
		await expect(feedback.view({ token })).rejects.toMatchObject({ code: "NOT_FOUND", data: { reason: "revoked" } });
		await expect(feedback.comment({ token, authorName: "Ana", body: "Again" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		expect((await feedback.get({ id: link.id, userId: "priya" })).commentCount).toBe(1);

		const expiring = await feedback.create({
			userId: "priya",
			resumeId: "cv",
			label: "Coach",
			allowComments: true,
			applicationIds: [],
			expiresAt: new Date(Date.now() + 60_000),
		});
		await db()
			.update(tables.feedbackLink)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(tables.feedbackLink.id, expiring.id));
		await expect(feedback.view({ token: tokenOf(expiring.url) })).rejects.toMatchObject({
			data: { reason: "expired" },
		});
	});

	it("rejects forged tokens, read-only comments and resumes in Trash", async () => {
		const link = await feedback.create({
			userId: "priya",
			resumeId: "cv",
			label: "Coach",
			allowComments: false,
			applicationIds: [],
			expiresAt: null,
		});
		await expect(feedback.view({ token: `${link.id}~forged` })).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(feedback.comment({ token: tokenOf(link.url), authorName: "Ana", body: "Hi" })).rejects.toMatchObject({
			code: "FORBIDDEN",
			data: { reason: "read-only" },
		});
		await db().update(tables.resume).set({ trashedAt: new Date() }).where(eq(tables.resume.id, "cv"));
		await expect(feedback.view({ token: tokenOf(link.url) })).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("deletes links and comments with the resume", async () => {
		const link = await feedback.create({
			userId: "priya",
			resumeId: "cv",
			label: "Coach",
			allowComments: true,
			applicationIds: [],
			expiresAt: null,
		});
		await feedback.comment({ token: tokenOf(link.url), authorName: "Ana", body: "Hi" });
		await db().delete(tables.resume).where(eq(tables.resume.id, "cv"));
		expect(await feedback.list({ userId: "priya" })).toEqual([]);
		expect(await db().select().from(tables.feedbackComment)).toEqual([]);
	});
});
