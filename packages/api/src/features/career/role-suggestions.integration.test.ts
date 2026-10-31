import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ORPCError } from "@orpc/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as tables from "@reactive-resume/db/schema";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";

const fixture = vi.hoisted(() => ({
	db: undefined as ReturnType<typeof drizzle> | undefined,
	generate: vi.fn(),
	provider: vi.fn(),
}));
vi.mock("@reactive-resume/db/client", () => ({
	get db() {
		return fixture.db;
	},
}));
vi.mock("../applications/ai", () => ({ generateJson: fixture.generate }));
vi.mock("../ai/service", () => ({ getModel: () => ({}) }));
vi.mock("../ai-providers/service", () => ({
	aiProvidersService: { getRunnableById: fixture.provider, assertAvailable: async () => {} },
}));
function getDb() {
	if (!fixture.db) throw new Error("Database unavailable");
	return fixture.db;
}
const databaseUrl = process.env.INTEGRATIONS_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("reviewed target role suggestions", () => {
	let suggest: typeof import("./role-suggestions").suggestTargetRoles;
	let admin: Pool;
	let pool: Pool;
	const schemaName = `rx76_roles_${randomUUID().replaceAll("-", "")}`;
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
		({ suggestTargetRoles: suggest } = await import("./role-suggestions"));
	}, 30_000);

	afterAll(async () => {
		await pool?.end();
		await admin?.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
		await admin?.end();
	});

	const input = {
		providerId: "synthetic",
		recipientVersion: "a".repeat(64),
		resumeId: null,
		includeKnowledge: true,
		locale: "en-US",
	};
	beforeEach(async () => {
		await pool.query('TRUNCATE "user" CASCADE');
		await getDb()
			.insert(tables.user)
			.values([
				{
					id: "alice",
					name: "Alice Example",
					email: "alice@example.test",
					username: "alice",
					displayUsername: "alice",
				},
				{ id: "bob", name: "Bob Example", email: "bob@example.test", username: "bob", displayUsername: "bob" },
			]);
		await getDb()
			.insert(tables.application)
			.values({ id: "alice-app", userId: "alice", company: "Fictional", role: "Engineer" });
		await getDb()
			.insert(tables.careerFact)
			.values([
				{
					id: "private",
					userId: "alice",
					applicationId: "alice-app",
					text: "PRIVATE-APPLICATION-FACT",
					category: "skill",
					source: { kind: "manual", id: "p", quote: "PRIVATE-APPLICATION-FACT" },
					sourceKey: "p",
				},
				{
					id: "active",
					userId: "alice",
					text: "I maintain reliable services.",
					category: "experience",
					source: { kind: "manual", id: "a", quote: "I maintain reliable services." },
					sourceKey: "a",
				},
				{
					id: "excluded",
					userId: "alice",
					status: "excluded",
					text: "EXCLUDED-FACT",
					category: "skill",
					source: { kind: "manual", id: "e", quote: "EXCLUDED-FACT" },
					sourceKey: "e",
				},
				{
					id: "forgotten",
					userId: "alice",
					status: "forgotten",
					text: "FORGOTTEN-FACT",
					category: "skill",
					source: { kind: "manual", id: "f", quote: "FORGOTTEN-FACT" },
					sourceKey: "f",
				},
				{
					id: "foreign",
					userId: "bob",
					text: "BOB-PRIVATE",
					category: "skill",
					source: { kind: "manual", id: "b", quote: "BOB-PRIVATE" },
					sourceKey: "b",
				},
			]);
		fixture.generate.mockReset().mockResolvedValue({
			suggestions: [
				{ role: "Reliability engineer", factIds: ["active", "foreign"], resumeQuote: null },
				{ role: "Invented role", factIds: ["made-up"], resumeQuote: "Invented quotation" },
			],
		});
		fixture.provider.mockReset().mockImplementation(async ({ userId, id }) => {
			if (userId !== "alice" || id !== "synthetic") throw new ORPCError("NOT_FOUND");
			return {
				id,
				recipientVersion: "a".repeat(64),
				provider: "openai-compatible",
				model: "fixture",
				apiKey: "local-only",
			};
		});
	});
	it("sends only opted-in active shared facts, filters fabricated citations and saves nothing", async () => {
		const result = await suggest("alice", input);
		expect(result).toEqual({
			suggestions: [
				{
					role: "Reliability engineer",
					facts: [{ id: "active", text: "I maintain reliable services." }],
					resumeQuote: null,
				},
			],
		});
		const sent = fixture.generate.mock.calls[0]?.[1].prompt as string;
		expect(sent).toContain("I maintain reliable services.");
		for (const forbidden of [
			"EXCLUDED-FACT",
			"FORGOTTEN-FACT",
			"BOB-PRIVATE",
			"PRIVATE-APPLICATION-FACT",
			"preferences",
			"answers",
			"applicationProfile",
		])
			expect(sent).not.toContain(forbidden);
		expect(await getDb().select().from(tables.careerProfile)).toEqual([]);
		expect(await getDb().select().from(tables.careerSchedule)).toEqual([]);
		expect(await getDb().select().from(tables.application)).toHaveLength(1);
	});
	it("requires explicit context and an owned runnable provider and resume", async () => {
		await expect(suggest("alice", { ...input, includeKnowledge: false })).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
		await expect(suggest("alice", { ...input, providerId: "foreign" })).rejects.toMatchObject({ code: "NOT_FOUND" });
		await getDb()
			.insert(tables.resume)
			.values({ id: "bob-resume", userId: "bob", name: "Private", slug: "private", data: sampleResumeData });
		await expect(suggest("alice", { ...input, resumeId: "bob-resume" })).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(fixture.generate).not.toHaveBeenCalled();
	});
	it("refuses a changed provider recipient instead of silently using the managed fallback", async () => {
		fixture.provider.mockResolvedValue({
			id: "new-managed-recipient",
			provider: "openai-compatible",
			model: "fixture",
			apiKey: "local-only",
		});
		await expect(suggest("alice", input)).rejects.toMatchObject({ code: "CONFLICT" });
		expect(fixture.generate).not.toHaveBeenCalled();
	});

	it("rejects in-flight revocation and never replays excluded or forgotten facts", async () => {
		fixture.generate.mockImplementationOnce(async () => {
			await getDb().update(tables.careerFact).set({ status: "excluded" }).where(eq(tables.careerFact.id, "active"));
			return { suggestions: [{ role: "Reliability engineer", factIds: ["active"], resumeQuote: null }] };
		});
		await expect(suggest("alice", input)).rejects.toMatchObject({ code: "CONFLICT" });
		await expect(suggest("alice", input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(fixture.generate).toHaveBeenCalledTimes(1);
	});
	it("shares only an explicitly chosen resume, blocks corrected-source replay and never guesses quotes", async () => {
		await getDb()
			.insert(tables.resume)
			.values({ id: "alice-resume", userId: "alice", name: "Synthetic", slug: "synthetic", data: sampleResumeData });
		fixture.generate.mockResolvedValue({
			suggestions: [{ role: "Engineer", factIds: ["active"], resumeQuote: "made-up" }],
		});
		expect(await suggest("alice", { ...input, resumeId: "alice-resume", includeKnowledge: false })).toEqual({
			suggestions: [],
		});
		const prompt = JSON.parse(fixture.generate.mock.calls[0]?.[1].prompt as string);
		expect(prompt.facts).toEqual([]);
		expect(prompt.resume).toContain(sampleResumeData.basics.name);
		await getDb()
			.insert(tables.careerFact)
			.values({
				userId: "alice",
				text: "Old claim",
				category: "experience",
				status: "forgotten",
				source: { kind: "resume", id: "alice-resume", quote: "Old claim" },
				sourceKey: "resume-source",
			});
		await expect(
			suggest("alice", { ...input, resumeId: "alice-resume", includeKnowledge: false }),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});
});
