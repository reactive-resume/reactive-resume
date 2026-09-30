import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const fixture = vi.hoisted(() => ({ db: undefined as ReturnType<typeof drizzle> | undefined }));
const env = vi.hoisted(() => ({
	ENCRYPTION_SECRET: "integration-test-encryption-secret-32-chars",
	FIRECRAWL_API_URL: "",
	FIRECRAWL_API_KEY: "",
	WEB_ACCESS_PROVIDER: "" as "" | "firecrawl" | "tavily" | "exa",
	WEB_ACCESS_API_KEY: "",
	WEB_ACCESS_API_URL: "",
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

// Opt in with a disposable PostgreSQL database. Each run owns and removes a separate schema.
describe.skipIf(!process.env.INTEGRATIONS_TEST_DATABASE_URL)("integration credentials and server precedence", () => {
	let firecrawl: typeof import("./service").firecrawlService;
	let web: typeof import("../web-access/credentials").webAccessService;
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
			'CREATE TABLE "user" (id text PRIMARY KEY); CREATE TABLE resume (id text PRIMARY KEY); CREATE TABLE application (id text PRIMARY KEY)',
		);
		for (const name of [
			"20260513181752_bent_human_cannonball",
			"20260930140759_perpetual_drax",
			"20260930195321_colossal_the_hood",
		]) {
			const sql = await readFile(new URL(`../../../../../migrations/${name}/migration.sql`, import.meta.url), "utf8");
			await pool.query(sql.replaceAll('"public".', ""));
		}
		firecrawl = (await import("./service")).firecrawlService;
		web = (await import("../web-access/credentials")).webAccessService;
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
			FIRECRAWL_API_URL: "",
			FIRECRAWL_API_KEY: "",
			WEB_ACCESS_PROVIDER: "",
			WEB_ACCESS_API_KEY: "",
			WEB_ACCESS_API_URL: "",
			AI_PROVIDER: "",
			AI_MODEL: "",
			AI_API_KEY: "",
			AI_BASE_URL: "",
		});
		await pool.query("TRUNCATE \"user\" CASCADE; INSERT INTO \"user\" VALUES ('alice'),('bob')");
	});

	it("encrypts personal Cloud keys, isolates accounts, and locks personal writes under server configuration", async () => {
		expect(await firecrawl.resolve("alice")).toBeNull();
		await firecrawl.save("alice", "fc-alice-secret");
		await firecrawl.save("bob", "fc-bob-secret");
		expect(await firecrawl.resolve("alice")).toEqual({
			apiUrl: "https://api.firecrawl.dev",
			apiKey: "fc-alice-secret",
		});
		expect(await firecrawl.resolve("bob")).toEqual({ apiUrl: "https://api.firecrawl.dev", apiKey: "fc-bob-secret" });
		const saved = (await pool.query("SELECT encrypted_api_key FROM web_access_credentials")).rows;
		expect(JSON.stringify(saved)).not.toContain("fc-alice-secret");
		expect(JSON.stringify(saved)).not.toContain("fc-bob-secret");
		await firecrawl.delete("alice");
		expect(await firecrawl.resolve("alice")).toBeNull();
		expect(await firecrawl.status("bob")).toEqual({ managed: false, configured: true, canSave: true });

		env.FIRECRAWL_API_URL = "http://firecrawl:3002";
		env.FIRECRAWL_API_KEY = "server-key";
		expect(await firecrawl.resolve("bob")).toEqual({ apiUrl: "http://firecrawl:3002", apiKey: "server-key" });
		expect(await firecrawl.status("alice")).toEqual({ managed: true, configured: true, canSave: false });
		await expect(firecrawl.save("bob", "override")).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(firecrawl.delete("bob")).rejects.toMatchObject({ code: "FORBIDDEN" });
		env.FIRECRAWL_API_KEY = "";
		env.ENCRYPTION_SECRET = "";
		expect(await firecrawl.resolve("alice")).toEqual({ apiUrl: "http://firecrawl:3002", apiKey: "" });
		env.FIRECRAWL_API_URL = "";
		expect(await firecrawl.status("alice")).toEqual({ managed: false, configured: false, canSave: false });
		await expect(firecrawl.save("alice", "secret")).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
	});

	it("backfills existing Firecrawl ciphertext unchanged without activating legacy keys again", async () => {
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			await client.query("DROP TABLE web_access_credentials; ALTER TABLE application DROP COLUMN posting_source");
			await client.query("INSERT INTO firecrawl_credentials VALUES ('alice','opaque-existing-ciphertext')");
			const migration = await readFile(
				new URL("../../../../../migrations/20260930195321_colossal_the_hood/migration.sql", import.meta.url),
				"utf8",
			);
			await client.query(migration.replaceAll('"public".', ""));
			expect((await client.query("SELECT * FROM web_access_credentials")).rows).toEqual([
				{ user_id: "alice", provider: "firecrawl", encrypted_api_key: "opaque-existing-ciphertext" },
			]);
			expect((await client.query("SELECT encrypted_api_key FROM firecrawl_credentials")).rows).toEqual([
				{ encrypted_api_key: "opaque-existing-ciphertext" },
			]);
		} finally {
			await client.query("ROLLBACK");
			client.release();
		}
		await pool.query("INSERT INTO firecrawl_credentials VALUES ('alice','obsolete')");
		expect(await web.resolve("alice")).toBeNull();
		await web.save("alice", "tavily", "tavily-personal");
		expect((await pool.query("SELECT * FROM firecrawl_credentials")).rows).toEqual([]);
	});

	it("keeps one personal provider, isolates keys and rejects legacy changes to another provider", async () => {
		for (const provider of ["firecrawl", "tavily", "exa"] as const) {
			await web.save("alice", provider, `${provider}-personal`);
			expect(await web.resolve("alice")).toMatchObject({ provider, apiKey: `${provider}-personal` });
			expect(await web.resolve("bob")).toBeNull();
			expect((await pool.query("SELECT COUNT(*)::int AS count FROM web_access_credentials")).rows).toEqual([
				{ count: 1 },
			]);
		}
		expect(await firecrawl.status("alice")).toEqual({ managed: false, configured: false, canSave: false });
		expect(await firecrawl.resolve("alice")).toBeNull();
		await expect(firecrawl.save("alice", "legacy-overwrite")).rejects.toMatchObject({ code: "CONFLICT" });
		await expect(firecrawl.delete("alice")).rejects.toMatchObject({ code: "CONFLICT" });
		// The SQL guard also protects a legacy save after a concurrent provider replacement.
		await expect(web.save("alice", "firecrawl", "legacy-race", true)).rejects.toMatchObject({ code: "CONFLICT" });
		expect(await web.resolve("alice")).toMatchObject({ provider: "exa", apiKey: "exa-personal" });
		await pool.query("INSERT INTO firecrawl_credentials VALUES ('alice','obsolete')");
		await web.delete("alice");
		expect(await web.status("alice")).toMatchObject({
			configured: false,
			provider: null,
			search: false,
			read: true,
			builtInReader: true,
		});
		expect((await pool.query("SELECT * FROM firecrawl_credentials")).rows).toEqual([]);
	});

	it("gives explicit generic server configuration precedence over aliases and personal credentials", async () => {
		await web.save("alice", "exa", "personal-exa");
		Object.assign(env, {
			FIRECRAWL_API_KEY: "legacy-server",
			WEB_ACCESS_PROVIDER: "tavily",
			WEB_ACCESS_API_KEY: "server-tavily",
		});
		expect(await web.resolve("alice")).toEqual({ provider: "tavily", apiKey: "server-tavily" });
		expect(await web.status("alice")).toMatchObject({ managed: true, provider: "tavily", canSave: false });
		await expect(web.save("alice", "exa", "override")).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(web.delete("alice")).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(firecrawl.save("alice", "override")).rejects.toMatchObject({ code: "CONFLICT" });
		Object.assign(env, {
			WEB_ACCESS_PROVIDER: "firecrawl",
			WEB_ACCESS_API_KEY: "",
			WEB_ACCESS_API_URL: "http://firecrawl:3002",
			ENCRYPTION_SECRET: "",
		});
		expect(await web.resolve("bob")).toEqual({ provider: "firecrawl", apiKey: "", apiUrl: "http://firecrawl:3002" });
		expect(JSON.stringify(await web.status("alice"))).not.toContain("server-tavily");
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
});
