import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const fixture = vi.hoisted(() => ({ db: undefined as ReturnType<typeof drizzle> | undefined }));
const env = vi.hoisted(() => ({
	AUTH_SECRET: "synthetic-test-auth-secret",
	ENCRYPTION_SECRET: "integration-test-encryption-secret-32-chars",
	WEB_ACCESS_PROVIDER: "" as "" | "firecrawl" | "tavily" | "exa",
	WEB_ACCESS_API_KEY: "",
	WEB_ACCESS_API_URL: "",
	WEB_SEARCH_SEARXNG_URL: "",
	AI_PROVIDER: "",
	AI_MODEL: "",
	AI_API_KEY: "",
	AI_BASE_URL: "",
}));
vi.mock("@reactive-resume/env/server", () => ({ env }));
vi.mock("@reactive-resume/db/client", () => ({
	get db() {
		return fixture.db;
	},
}));

vi.mock("../ai/service", () => ({ testConnection: vi.fn(async () => ({ ok: true as const })) }));

// Opt in with a disposable PostgreSQL database. Each run owns and removes a separate schema.
describe.skipIf(!process.env.INTEGRATIONS_TEST_DATABASE_URL)("integration credentials and server precedence", () => {
	let web: typeof import("./credentials").webAccessService;
	let ai: typeof import("../ai-providers/service").aiProvidersService;
	let pool: Pool;
	let admin: Pool;
	const schemaName = `integrations_test_${randomUUID().replaceAll("-", "")}`;
	beforeAll(async () => {
		admin = new Pool({ connectionString: process.env.INTEGRATIONS_TEST_DATABASE_URL });
		await admin.query(`CREATE SCHEMA ${schemaName}`);
		pool = new Pool({
			connectionString: process.env.INTEGRATIONS_TEST_DATABASE_URL,
			options: `-c search_path=${schemaName}`,
		});
		fixture.db = drizzle({ client: pool });
		await pool.query(
			'CREATE TABLE "user" (id text PRIMARY KEY); CREATE TABLE resume (id text PRIMARY KEY, user_id text REFERENCES "user"(id) ON DELETE CASCADE, trashed_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now()); CREATE TABLE application (id text PRIMARY KEY); CREATE TABLE career_schedule (id text PRIMARY KEY DEFAULT gen_random_uuid()::text, user_id text, ai_provider_id text, ai_provider_version text, enabled boolean, updated_at timestamptz); CREATE TABLE career_job (id text PRIMARY KEY, user_id text, schedule_id text REFERENCES career_schedule(id), status text, lease text, lease_until timestamptz, updated_at timestamptz)',
		);
		for (const name of [
			"20260513181752_bent_human_cannonball",
			"20261001042749_v6_release",
			"20261007205051_career_platform",
		]) {
			const sql = await readFile(new URL(`../../../../../migrations/${name}/migration.sql`, import.meta.url), "utf8");
			// The fixture owns the AI tables and web credentials, not the rest of the later upgrades.
			const owned = {
				"20261001042749_v6_release": /^(?:CREATE TABLE|ALTER TABLE) "web_access_credentials"/,
				"20261007205051_career_platform":
					/^(?:ALTER TABLE|CREATE UNIQUE INDEX "ai_providers_[a-z_]+" ON) "ai_providers"/,
			}[name];
			const statements = sql
				.split("--> statement-breakpoint")
				.filter((statement) => !owned || owned.test(statement.trim()));
			await pool.query(statements.join("\n").replaceAll('"public".', ""));
		}
		const upgrade = await readFile(
			new URL("../../../../../migrations/20261031125221_thankful_outlaw_kid/migration.sql", import.meta.url),
			"utf8",
		);
		for (const statement of upgrade.split("--> statement-breakpoint")) {
			if (
				/^(?:CREATE TABLE|ALTER TABLE) "(?:ai_providers|web_access_credentials|resume_writing_review)"|^UPDATE "ai_providers"/.test(
					statement.trim(),
				)
			)
				await pool.query(statement);
		}
		web = (await import("./credentials")).webAccessService;
		ai = (await import("../ai-providers/service")).aiProvidersService;
	});
	afterAll(async () => {
		await pool?.end();
		await admin?.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
		await admin?.end();
	});
	beforeEach(async () => {
		Object.assign(env, {
			ENCRYPTION_SECRET: "integration-test-encryption-secret-32-chars",
			WEB_ACCESS_PROVIDER: "",
			WEB_ACCESS_API_KEY: "",
			WEB_ACCESS_API_URL: "",
			WEB_SEARCH_SEARXNG_URL: "",
			AI_PROVIDER: "",
			AI_MODEL: "",
			AI_API_KEY: "",
			AI_BASE_URL: "",
		});
		await pool.query("TRUNCATE \"user\" CASCADE; INSERT INTO \"user\" VALUES ('alice'),('bob')");
	});

	it("encrypts personal keys, isolates accounts, and replaces or removes one selected connection", async () => {
		expect(await web.resolve("alice")).toBeNull();
		await web.save("bob", "firecrawl", "fc-bob-secret");
		for (const provider of ["firecrawl", "tavily", "exa"] as const) {
			await web.save("alice", provider, `${provider}-personal`);
			expect(await web.resolve("alice")).toMatchObject({ provider, apiKey: `${provider}-personal` });
			expect(await web.resolve("bob")).toEqual({
				provider: "firecrawl",
				apiUrl: "https://api.firecrawl.dev",
				apiKey: "fc-bob-secret",
			});
			const saved = (await pool.query("SELECT user_id, encrypted_api_key FROM web_access_credentials")).rows;
			expect(saved).toHaveLength(2);
			expect(JSON.stringify(saved)).not.toContain(`${provider}-personal`);
			expect(JSON.stringify(saved)).not.toContain("fc-bob-secret");
		}
		await web.delete("alice");
		expect(await web.resolve("alice")).toBeNull();
		expect(await web.resolve("bob")).toMatchObject({ provider: "firecrawl", apiKey: "fc-bob-secret" });
		expect(await web.status("alice")).toMatchObject({
			configured: false,
			provider: null,
			search: false,
			read: true,
			builtInReader: true,
		});
		env.WEB_SEARCH_SEARXNG_URL = "http://searxng:8080";
		expect(await web.status("alice")).toMatchObject({ configured: false, provider: null, search: true });
		env.WEB_SEARCH_SEARXNG_URL = "";
		env.ENCRYPTION_SECRET = "";
		expect(await web.status("alice")).toMatchObject({ managed: false, configured: false, canSave: false });
		await expect(web.save("alice", "firecrawl", "secret")).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
		await expect(web.delete("alice")).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
	});

	it("uses server credentials without encryption and restores personal connections when disabled", async () => {
		await web.save("alice", "exa", "personal-exa");
		Object.assign(env, { WEB_ACCESS_PROVIDER: "tavily", WEB_ACCESS_API_KEY: "server-tavily" });
		expect(await web.resolve("alice")).toEqual({ provider: "tavily", apiKey: "server-tavily" });
		expect(await web.status("alice")).toMatchObject({ managed: true, provider: "tavily", canSave: false });
		await expect(web.save("alice", "exa", "override")).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(web.delete("alice")).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(JSON.stringify(await web.status("alice"))).not.toContain("server-tavily");
		Object.assign(env, {
			WEB_ACCESS_PROVIDER: "firecrawl",
			WEB_ACCESS_API_KEY: "",
			WEB_ACCESS_API_URL: "http://firecrawl:3002",
			ENCRYPTION_SECRET: "",
		});
		expect(await web.resolve("bob")).toEqual({ provider: "firecrawl", apiKey: "", apiUrl: "http://firecrawl:3002" });
		Object.assign(env, {
			WEB_ACCESS_PROVIDER: "",
			WEB_ACCESS_API_URL: "",
			ENCRYPTION_SECRET: "integration-test-encryption-secret-32-chars",
		});
		expect(await web.resolve("alice")).toEqual({ provider: "exa", apiKey: "personal-exa" });
	});

	it("routes AI through server credentials, keeps thread references valid, and restores personal providers when disabled", async () => {
		const personal = await ai.create({
			userId: "alice",
			label: "Personal",
			provider: "openai",
			model: "personal-model",
			apiKey: "personal-key",
		});
		await pool.query("UPDATE ai_providers SET enabled=true, test_status='success' WHERE id=$1", [personal.id]);
		Object.assign(env, {
			AI_PROVIDER: "openai",
			AI_MODEL: "server-model",
			AI_API_KEY: "server-secret",
			AI_BASE_URL: "https://ai.example.com/v1",
			ENCRYPTION_SECRET: "",
		});
		const global = await ai.getRunnableById({ userId: "alice", id: personal.id });
		expect(global).toMatchObject({
			managed: true,
			provider: "openai",
			model: "server-model",
			apiKey: "server-secret",
			baseURL: "https://ai.example.com/v1",
		});
		expect((await ai.getDefaultRunnable({ userId: "alice" }))?.id).toBe(global.id);
		const listed = await ai.list({ userId: "alice" });
		expect(listed).toHaveLength(1);
		expect(listed[0]).toMatchObject({ managed: true, enabled: true });
		expect(JSON.stringify(listed)).not.toContain("server-secret");
		expect(JSON.stringify((await pool.query("SELECT * FROM ai_providers")).rows)).not.toContain("server-secret");
		await pool.query(
			"INSERT INTO agent_threads (id,user_id,ai_provider_id,title) VALUES ('thread','alice',$1,'Server AI')",
			[global.id],
		);
		for (const action of [
			() => ai.create({ userId: "alice", label: "Override", provider: "openai", model: "other", apiKey: "other" }),
			() => ai.update({ userId: "alice", id: personal.id, apiKey: "override" }),
			() => ai.test({ userId: "alice", id: personal.id }),
			() => ai.delete({ userId: "alice", id: personal.id }),
		])
			await expect(action()).rejects.toMatchObject({ code: "FORBIDDEN" });
		Object.assign(env, {
			AI_PROVIDER: "",
			AI_MODEL: "",
			AI_API_KEY: "",
			AI_BASE_URL: "",
			ENCRYPTION_SECRET: "integration-test-encryption-secret-32-chars",
		});
		expect(await ai.list({ userId: "alice" })).toMatchObject([{ id: personal.id, managed: false }]);
		expect((await ai.getDefaultRunnable({ userId: "alice" }))?.apiKey).toBe("personal-key");
		await expect(ai.getRunnableById({ userId: "alice", id: global.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("keeps the first working default stable across concurrent tests, edits and explicit Off", async () => {
		const first = await ai.create({
			userId: "alice",
			label: "First",
			provider: "openai",
			model: "model",
			apiKey: "first-key",
		});
		const second = await ai.create({
			userId: "alice",
			label: "Second",
			provider: "openai",
			model: "model",
			apiKey: "second-key",
		});
		await Promise.all([ai.test({ userId: "alice", id: first.id }), ai.test({ userId: "alice", id: second.id })]);
		const defaults = (await ai.list({ userId: "alice" })).filter((p) => p.isDefault);
		expect(defaults).toHaveLength(1);
		const chosen = defaults[0];
		if (!chosen) throw new Error("No default was saved");
		const other = chosen.id === first.id ? second : first;
		await ai.markUsed({ userId: "alice", id: other.id });
		expect((await ai.getDefaultRunnable({ userId: "alice" }))?.id).toBe(chosen.id);
		await ai.update({ userId: "alice", id: chosen.id, enabled: false });
		expect(await ai.test({ userId: "alice", id: chosen.id })).toMatchObject({
			enabled: false,
			testStatus: "success",
			isDefault: true,
		});
		await pool.query("INSERT INTO career_schedule (user_id,ai_provider_id,enabled) VALUES ('alice',$1,true)", [
			chosen.id,
		]);
		await ai.update({ userId: "alice", id: chosen.id, apiKey: "replacement-key" });
		expect(
			(await pool.query("SELECT enabled FROM career_schedule WHERE ai_provider_id=$1", [chosen.id])).rows[0]?.enabled,
		).toBe(false);
		expect(await ai.test({ userId: "alice", id: chosen.id })).toMatchObject({ enabled: false, testStatus: "success" });
		await ai.update({ userId: "alice", id: chosen.id, enabled: true });
		expect((await ai.getDefaultRunnable({ userId: "alice" }))?.id).toBe(chosen.id);
	});

	it("retains web test failures, clears them on replacement, and rejects stale test writes", async () => {
		await web.save("alice", "tavily", "old-key");
		const connection = await web.resolve("alice", true);
		const failed = { search: { success: false, error: "auth" }, read: { success: false, error: "auth" } };
		await web.recordTest("alice", connection, failed);
		expect(await web.status("alice")).toMatchObject({ configured: true, search: false, testResult: failed });
		expect(await web.resolve("alice")).toBeNull();
		expect(await web.resolve("alice", true)).toMatchObject({ apiKey: "old-key" });
		await web.save("alice", "exa", "new-key");
		await web.recordTest("alice", connection, failed);
		expect(await web.status("alice")).toMatchObject({ provider: "exa", search: true, testResult: null });
	});

	it("binds web consent to the same credential snapshot used for reading", async () => {
		const { withWebDestination } = await import("../ai/destination");
		await web.save("alice", "tavily", "first-key");
		const approved = await web.status("alice");
		await web.save("alice", "tavily", "replacement-key");
		await expect(withWebDestination(approved.revision, () => web.resolve("alice"))).rejects.toMatchObject({
			code: "CONFLICT",
		});
	});

	it("keeps paid writing reviews with their input version, isolates owners, and discards a late older result", async () => {
		const { beginWritingReview, saveWritingReview, readWritingReview } = await import("../ai/writing-review");
		await pool.query(`INSERT INTO resume(id,user_id) VALUES ('resume-alice','alice'),('resume-bob','bob')`);
		const input = {
			resumeId: "resume-alice",
			userId: "alice",
			inputText: "Original wording",
			passages: [{ id: "p1", where: "Summary", text: "Original wording" }],
			review: { summary: "Latest review", suggestions: [], strengths: [], jdAlignment: null },
			requestedAt: new Date("2026-10-31T10:00:02Z"),
			reviewedAt: new Date("2026-10-31T10:00:03Z"),
		};
		const older = await beginWritingReview("alice", "resume-alice");
		const newer = await beginWritingReview("alice", "resume-alice");
		await saveWritingReview({ ...input, requestGeneration: newer.generation });
		await saveWritingReview({
			requestGeneration: older.generation,
			...input,
			inputText: "Old wording",
			review: { ...input.review, summary: "Old review" },
			requestedAt: input.requestedAt,
		});
		expect(await readWritingReview("alice", "resume-alice")).toMatchObject({
			inputText: "Original wording",
			review: { summary: "Latest review" },
		});
		const pendingReview = await beginWritingReview("alice", "resume-alice");
		expect(await readWritingReview("alice", "resume-alice")).toMatchObject({ review: { summary: "Latest review" } });
		await saveWritingReview({ ...input, requestGeneration: pendingReview.generation });
		expect((await readWritingReview("alice", "resume-alice"))?.reviewedAt.getTime()).toBeGreaterThan(
			input.reviewedAt.getTime(),
		);
		await expect(readWritingReview("bob", "resume-alice")).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			saveWritingReview({ ...input, requestGeneration: newer.generation, resumeId: "resume-bob" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await pool.query(`UPDATE resume SET trashed_at=now() WHERE id='resume-alice'`);
		await expect(saveWritingReview({ ...input, requestGeneration: newer.generation })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		await pool.query(`DELETE FROM "user" WHERE id='alice'`);
		expect((await pool.query("SELECT * FROM resume_writing_review")).rows).toHaveLength(0);
	});

	it("rejects a changed AI destination at the actual service boundary", async () => {
		const { aiDestination } = await import("@reactive-resume/ai/types");
		const { withAiDestination } = await import("../ai/destination");
		const first = await ai.create({
			userId: "alice",
			label: "First",
			provider: "openai",
			model: "model",
			apiKey: "key-one",
		});
		await ai.test({ userId: "alice", id: first.id });
		const approved = await ai.getRunnableById({ userId: "alice", id: first.id });
		await ai.update({ userId: "alice", id: first.id, apiKey: "key-two" });
		await ai.test({ userId: "alice", id: first.id });
		await expect(
			withAiDestination(aiDestination(approved), () => ai.getRunnableById({ userId: "alice", id: first.id })),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});

	it("uses the default provider while it's usable, and keeps one default per account", async () => {
		const add = (label: string) =>
			ai.create({ userId: "alice", label, provider: "openai", model: "model", apiKey: `${label}-key` });
		const first = await add("first");
		const second = await add("second");
		await pool.query("UPDATE ai_providers SET test_status = 'success', enabled = true");
		await pool.query("UPDATE ai_providers SET last_used_at = now() WHERE id = $1", [first.id]);
		// Legacy configurations without a default use stable creation order.
		expect((await ai.getDefaultRunnable({ userId: "alice" }))?.id).toBe(first.id);
		await ai.setDefault({ userId: "alice", id: second.id });
		await ai.markUsed({ userId: "alice", id: first.id });
		expect((await ai.getDefaultRunnable({ userId: "alice" }))?.id).toBe(second.id);
		await ai.setDefault({ userId: "alice", id: first.id });
		expect((await ai.list({ userId: "alice" })).map(({ label, isDefault }) => [label, isDefault])).toEqual([
			["first", true],
			["second", false],
		]);
		// A switched-off default stays chosen but isn't used, and can't be made the default again until it's back on.
		await pool.query("UPDATE ai_providers SET enabled = false WHERE id = $1", [first.id]);
		expect((await ai.getDefaultRunnable({ userId: "alice" }))?.id).toBe(second.id);
		await ai.setDefault({ userId: "alice", id: second.id });
		await expect(ai.setDefault({ userId: "alice", id: first.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(ai.setDefault({ userId: "bob", id: second.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
		const survivor = await add("third");
		await ai.test({ userId: "alice", id: survivor.id });
		await ai.delete({ userId: "alice", id: second.id });
		expect((await ai.list({ userId: "alice" })).find((provider) => provider.isDefault)?.id).toBe(survivor.id);
	});
});
