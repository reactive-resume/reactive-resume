import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const fixture = vi.hoisted(() => ({ db: undefined as ReturnType<typeof drizzle> | undefined }));
const env = vi.hoisted(() => ({
	ENCRYPTION_SECRET: "integration-test-encryption-secret-32-chars",
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
			'CREATE TABLE "user" (id text PRIMARY KEY); CREATE TABLE resume (id text PRIMARY KEY); CREATE TABLE application (id text PRIMARY KEY)',
		);
		for (const name of ["20260513181752_bent_human_cannonball", "20261001042749_v6_release"]) {
			const sql = await readFile(new URL(`../../../../../migrations/${name}/migration.sql`, import.meta.url), "utf8");
			// The fixture owns the AI tables and web credentials, not the rest of the v6 upgrade.
			const statements = sql
				.split("--> statement-breakpoint")
				.filter(
					(statement) =>
						name !== "20261001042749_v6_release" ||
						/^(?:CREATE TABLE|ALTER TABLE) "web_access_credentials"/.test(statement.trim()),
				);
			await pool.query(statements.join("\n").replaceAll('"public".', ""));
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
});
