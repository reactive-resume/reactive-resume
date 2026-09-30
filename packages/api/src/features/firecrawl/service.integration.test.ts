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
		await pool.query('CREATE TABLE "user" (id text PRIMARY KEY); CREATE TABLE resume (id text PRIMARY KEY)');
		for (const name of ["20260513181752_bent_human_cannonball", "20260930140759_perpetual_drax"]) {
			const sql = await readFile(new URL(`../../../../../migrations/${name}/migration.sql`, import.meta.url), "utf8");
			await pool.query(sql.replaceAll('"public".', ""));
		}
		firecrawl = (await import("./service")).firecrawlService;
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
		const saved = (await pool.query("SELECT encrypted_api_key FROM firecrawl_credentials")).rows;
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
