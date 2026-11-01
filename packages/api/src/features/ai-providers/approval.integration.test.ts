import type { RouterClient } from "@orpc/server";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createRouterClient } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { aiDestination, NO_AI_DESTINATION } from "@reactive-resume/ai/types";
import * as tables from "@reactive-resume/db/schema";
import { env } from "@reactive-resume/env/server";
import { copyCoverLetterStyle } from "@reactive-resume/resume/cover-letter";
import { careerScheduleInputSchema } from "@reactive-resume/schema/career";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";

vi.mock("@reactive-resume/env/server", async (original) => {
	const module = await original<typeof import("@reactive-resume/env/server")>();
	return { env: { ...module.env } };
});
const fixture = vi.hoisted(() => ({ db: undefined as ReturnType<typeof drizzle> | undefined }));
// Only the database handle is substituted. Routers, credentials, provider resolution and HTTP transport are real.
vi.mock("@reactive-resume/db/client", () => ({
	get db() {
		return fixture.db;
	},
}));

function getDb() {
	if (!fixture.db) throw new Error("Test database is not initialized");
	return fixture.db;
}

describe.skipIf(!process.env.INTEGRATIONS_TEST_DATABASE_URL)(
	"approved dispatch and single-connection persistence",
	() => {
		let pool: Pool;
		let admin: Pool;
		let ai: typeof import("./service").aiProvidersService;
		let router: typeof import("../applications/ai").aiRouter;
		let voice: typeof import("../career/voice").careerVoiceRouter;
		let career: typeof import("../career/service").careerService;
		let careerRouter: typeof import("../career/router").careerRouter;
		let jobs: typeof import("../career/jobs").careerJobs;
		let letters: typeof import("../cover-letters/router").coverLettersRouter;
		let baseURL: string;
		let documentKnowledge = false;
		const requests: { url: string; body: string; authorization: string | undefined }[] = [];
		const server = createServer((req, res) => {
			let body = "";
			req.on("data", (chunk) => {
				body += chunk;
			});
			req.on("end", () => {
				requests.push({ url: req.url ?? "", body, authorization: req.headers.authorization });
				if (body.startsWith("{") && JSON.parse(body).stream === true) {
					res.writeHead(200, { "content-type": "text/event-stream" });
					const lookup = documentKnowledge && !body.includes('"role":"tool"');
					for (const [delta, finish_reason] of lookup
						? [
								[
									{
										tool_calls: [
											{
												index: 0,
												id: "lookup",
												type: "function",
												function: { name: "read_knowledge", arguments: JSON.stringify({ query: "" }) },
											},
										],
									},
									null,
								],
								[{}, "tool_calls"],
							]
						: [
								[{ content: "Fictional draft" }, null],
								[{}, "stop"],
							]) {
						res.write(
							`data: ${JSON.stringify({ id: "local", object: "chat.completion.chunk", created: 0, model: "stub", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
						);
					}
					res.end("data: [DONE]\n\n");
					return;
				}
				if (req.url?.endsWith("/audio/speech")) {
					res.writeHead(200, { "content-type": "audio/mpeg" });
					res.end(Buffer.from("fictional-audio"));
					return;
				}
				if (req.url?.endsWith("/audio/transcriptions")) {
					res.writeHead(200, { "content-type": "application/json" });
					res.end(JSON.stringify({ text: "Fictional transcript" }));
					return;
				}
				const content = body.includes("Plan the user's preparation")
					? JSON.stringify({
							title: "Fictional briefing",
							headline: "Prepare",
							summary: "Fictional",
							plan: [],
							questions: [],
							focus: "Fictional",
							opening: "Fictional",
							stories: [],
							honesty: "Fictional",
							storyIds: [],
							missingStory: null,
							practiceQuestions: [],
							factIds: [],
						})
					: body.includes("Write the user's answer")
						? JSON.stringify({ text: "Fictional answer", factIds: ["proof"] })
						: body.includes("POSTING")
							? JSON.stringify({ company: "Fictional", role: "Engineer", location: "", salary: "", requirements: [] })
							: "1";
				res.writeHead(200, { "content-type": "application/json" });
				res.end(
					JSON.stringify({
						id: "local",
						object: "chat.completion",
						created: 0,
						model: "stub",
						choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
						usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
					}),
				);
			});
		});
		const schemaName = `rx98_approval_${randomUUID().replaceAll("-", "")}`;
		beforeAll(async () => {
			admin = new Pool({ connectionString: process.env.INTEGRATIONS_TEST_DATABASE_URL });
			await admin.query(`CREATE SCHEMA ${schemaName}`);
			pool = new Pool({
				connectionString: process.env.INTEGRATIONS_TEST_DATABASE_URL,
				application_name: schemaName,
				max: 1,
				connectionTimeoutMillis: 750,
				options: `-c search_path=${schemaName} -c statement_timeout=5000`,
			});
			fixture.db = drizzle({ client: pool });
			const migrations = new URL("../../../../../migrations/", import.meta.url);
			for (const directory of (await readdir(migrations)).filter((name) => /^\d+_/.test(name)).sort()) {
				const file = new URL(`${directory}/migration.sql`, migrations);
				if (existsSync(file)) {
					const sql = (await readFile(file, "utf8")).replaceAll('"public".', "");
					if (directory === "20261031125221_thankful_outlaw_kid") {
						await pool.query(
							`INSERT INTO "user"(id,name,email,username,display_username) VALUES ('migration-owner','Fictional','migration@example.test','migration-owner','migration-owner')`,
						);
						await pool.query(`INSERT INTO ai_providers(id,user_id,label,provider,model,encrypted_api_key,api_key_salt,api_key_hash,api_key_preview,enabled,test_status,created_at) VALUES
                        ('legacy-off','migration-owner','Off','openai','stub','','','','',false,'success','2026-01-01'),
                        ('legacy-first','migration-owner','First','openai','stub','','','','',true,'success','2026-01-02'),
                        ('legacy-last','migration-owner','Last','openai','stub','','','','',true,'success','2026-01-03')`);

						await pool.query("BEGIN");
						await pool.query(sql);
						await pool.query("ROLLBACK");
						expect((await pool.query("SELECT to_regclass('resume_writing_review') AS name")).rows[0]?.name).toBeNull();
						expect(
							(
								await pool.query(
									"SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema=$1 AND table_name='ai_providers' AND column_name='user_disabled'",
									[schemaName],
								)
							).rows[0]?.n,
						).toBe(0);
					}
					if (directory === "20261031234857_ancient_rhodey") {
						await pool.query(
							`INSERT INTO career_schedule(id,user_id,kind,enabled,next_run_at,ai_provider_id) VALUES ('legacy-prepare','migration-owner','prepare',true,now(),'legacy-first'),('legacy-discovery','migration-owner','discovery',true,now(),NULL)`,
						);
						await pool.query(
							`INSERT INTO career_job(id,user_id,schedule_id,due_at,status,lease,lease_until) VALUES ('legacy-queued','migration-owner','legacy-prepare',now(),'queued',NULL,NULL),('legacy-running','migration-owner','legacy-prepare',now()+interval '1 second','running','legacy-lease',now()+interval '1 hour')`,
						);
						await pool.query("BEGIN");
						await pool.query(sql);
						await pool.query("ROLLBACK");
						expect(
							(
								await pool.query(
									"SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema=$1 AND table_name='career_schedule' AND column_name='ai_provider_version'",
									[schemaName],
								)
							).rows,
						).toEqual([{ n: 0 }]);
						expect((await pool.query("SELECT enabled FROM career_schedule WHERE id='legacy-prepare'")).rows).toEqual([
							{ enabled: true },
						]);
						expect((await pool.query("SELECT status FROM career_job WHERE id='legacy-running'")).rows).toEqual([
							{ status: "running" },
						]);
					}
					await pool.query(sql);
					if (directory === "20261031234857_ancient_rhodey") {
						expect(
							(await pool.query("SELECT id,enabled,ai_provider_version FROM career_schedule ORDER BY id")).rows,
						).toEqual([
							{ id: "legacy-discovery", enabled: true, ai_provider_version: null },
							{ id: "legacy-prepare", enabled: false, ai_provider_version: null },
						]);
						expect((await pool.query("SELECT status,lease,lease_until FROM career_job ORDER BY id")).rows).toEqual([
							{ status: "canceled", lease: null, lease_until: null },
							{ status: "canceled", lease: null, lease_until: null },
						]);
					}
					if (directory === "20261031125221_thankful_outlaw_kid") {
						expect((await pool.query("SELECT id,user_disabled,is_default FROM ai_providers ORDER BY id")).rows).toEqual(
							[
								{ id: "legacy-first", user_disabled: false, is_default: true },
								{ id: "legacy-last", user_disabled: false, is_default: false },
								{ id: "legacy-off", user_disabled: true, is_default: false },
							],
						);
					}
				}
			}
			await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
			const address = server.address();
			if (!address || typeof address === "string") throw new Error("No stub address");
			baseURL = `http://127.0.0.1:${address.port}/v1`;
			ai = (await import("./service")).aiProvidersService;
			router = (await import("../applications/ai")).aiRouter;
			voice = (await import("../career/voice")).careerVoiceRouter;
			jobs = (await import("../career/jobs")).careerJobs;
			career = (await import("../career/service")).careerService;
			careerRouter = (await import("../career/router")).careerRouter;
			letters = (await import("../cover-letters/router")).coverLettersRouter;
		}, 30000);
		afterAll(async () => {
			await new Promise<void>((resolve) => server.close(() => resolve()));
			await pool?.end();
			await admin?.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
			await admin?.end();
		});
		beforeEach(async () => {
			documentKnowledge = false;
			Object.assign(env, {
				AI_PROVIDER: undefined,
				AI_MODEL: undefined,
				AI_API_KEY: undefined,
				AI_BASE_URL: undefined,
			});
			await pool.query('TRUNCATE "user", released_username, storage_cleanup_job CASCADE');
			await getDb()
				.insert(tables.user)
				.values(
					["alice", "bob"].map((id) => ({
						id,
						name: `${id} Example`,
						email: `${id}@example.test`,
						username: `${schemaName}-${id}`,
						displayUsername: `${schemaName}-${id}`,
						emailVerified: true,
					})),
				);
			requests.length = 0;
		});
		const context = (destination?: string) => ({
			locale: "en-US" as const,
			reqHeaders: new Headers(destination ? { "x-ai-destination": destination } : {}),
			authentication: {
				user: {
					id: "alice",
					name: "Alice Example",
					email: "alice@example.test",
					emailVerified: true,
					createdAt: new Date(),
					updatedAt: new Date(),
				},
				method: "session" as const,
				permissions: ["read", "write", "delete"] as const,
			},
		});
		async function add(label: string, provider: "openai" | "openai-compatible" = "openai-compatible") {
			const row = await ai.create({ userId: "alice", label, provider, model: "stub", baseURL, apiKey: `${label}-key` });
			return ai.test({ userId: "alice", id: row.id });
		}
		const marker = "RX98_PRIVATE_POSTING_ZERO_TRANSMISSION";
		it.each(["none", "stale", "changed default"] as const)(
			"streamed letter keeps the approved destination through RPC iteration: %s",
			async (change) => {
				await getDb()
					.insert(tables.resume)
					.values({
						id: "letter-source",
						userId: "alice",
						name: "Fictional",
						slug: "fictional",
						data: structuredClone(defaultResumeData),
					});
				await getDb()
					.insert(tables.coverLetter)
					.values({
						id: "letter",
						userId: "alice",
						name: "Fictional",
						content: "",
						sourceResumeId: "letter-source",
						style: copyCoverLetterStyle(defaultResumeData),
					});
				const approved = await add("approved");
				const destination = change === "none" ? NO_AI_DESTINATION : aiDestination(approved);
				if (change === "stale") {
					await ai.update({ userId: "alice", id: approved.id, apiKey: "replacement" });
					await ai.test({ userId: "alice", id: approved.id });
				} else if (change === "changed default") {
					const other = await add("other");
					await ai.setDefault({ userId: "alice", id: other.id });
				}
				requests.length = 0;
				const handler = new RPCHandler(letters);
				const client = createORPCClient<RouterClient<typeof letters>>(
					new RPCLink({
						url: "https://rpc.fixture.test",
						headers: { "x-ai-destination": destination },
						fetch: async (request) => {
							const { response } = await handler.handle(request, { context: context(destination) });
							assert(response);
							return response;
						},
					}),
				);
				const result = client.draft({ id: "letter", variant: "draft" }).then(async (stream) => {
					let text = "";
					for await (const part of stream) text += part;
					return text;
				});
				if (change === "changed default") {
					expect(await result).toBe("Fictional draft");
					expect(requests.map((request) => request.authorization)).toEqual(["Bearer approved-key"]);
				} else {
					await expect(result).rejects.toMatchObject({ code: "CONFLICT" });
					expect(requests).toHaveLength(0);
				}
			},
		);
		it("allows Off and rename without revalidating an unchanged stored URL", async () => {
			const provider = await add("policy");
			const before = env.FLAG_ALLOW_UNSAFE_AI_BASE_URL;
			Object.assign(env, { FLAG_ALLOW_UNSAFE_AI_BASE_URL: false });
			try {
				expect(await ai.update({ userId: "alice", id: provider.id, enabled: false })).toMatchObject({ enabled: false });
				expect(await ai.update({ userId: "alice", id: provider.id, label: "Renamed" })).toMatchObject({
					label: "Renamed",
					enabled: false,
				});
			} finally {
				Object.assign(env, { FLAG_ALLOW_UNSAFE_AI_BASE_URL: before });
			}
		});
		it("distinguishes explicit no-AI from legacy omission at the protected router and actual HTTP boundary", async () => {
			await add("connected-after-approval");
			requests.length = 0;
			const manual = createRouterClient(router, { context: context(NO_AI_DESTINATION) });
			expect(await manual.parsePosting({ input: marker })).toMatchObject({ filledBy: "none", jobDescription: marker });
			await expect(manual.autofill({ jobDescription: marker })).rejects.toMatchObject({ code: "CONFLICT" });
			expect(requests).toHaveLength(0);
			const legacy = createRouterClient(router, { context: context() });
			expect(await legacy.parsePosting({ input: marker })).toMatchObject({ filledBy: "ai" });
			expect(requests).toHaveLength(1);
			expect(requests[0]?.body).toContain(marker);
		});
		it("retains approved provider/config when the default changes, and refuses changed credentials before HTTP", async () => {
			const approved = await add("first");
			const second = await add("second");
			await ai.setDefault({ userId: "alice", id: second.id });
			requests.length = 0;
			const client = createRouterClient(router, { context: context(aiDestination(approved)) });
			expect(await client.parsePosting({ input: marker })).toMatchObject({ filledBy: "ai" });
			expect(requests[0]?.authorization).toBe("Bearer first-key");
			await ai.update({ userId: "alice", id: approved.id, apiKey: "replacement" });
			await ai.test({ userId: "alice", id: approved.id });
			requests.length = 0;
			expect(await client.parsePosting({ input: marker })).toMatchObject({
				filledBy: "none",
				enrichmentWarning: "ai-unavailable",
			});
			expect(requests).toHaveLength(0);
		});
		function holdAuthorization() {
			let arrived!: () => void;
			let release!: () => void;
			const entered = new Promise<void>((resolve) => {
				arrived = resolve;
			});
			const held = new Promise<void>((resolve) => {
				release = resolve;
			});
			const original = ai.authorize;
			const spy = vi.spyOn(ai, "authorize").mockImplementation(async (...args) => {
				arrived();
				await held;
				return original(...args);
			});
			return { entered, release: () => release(), restore: () => spy.mockRestore() };
		}
		it.each(["off", "delete", "untested", "managed removal"] as const)(
			"zero HTTP when %s commits before final authorization",
			async (change) => {
				const provider =
					change === "managed removal"
						? await (async () => {
								Object.assign(env, {
									AI_PROVIDER: "openai-compatible",
									AI_MODEL: "stub",
									AI_API_KEY: "managed-a",
									AI_BASE_URL: baseURL,
								});
								const row = (await ai.list({ userId: "alice" }))[0];
								assert(row);
								return row;
							})()
						: await add("approved");
				requests.length = 0;
				const gate = holdAuthorization();
				const pending = createRouterClient(router, { context: context(aiDestination(provider)) })
					.parsePosting({ input: marker })
					.catch((error) => error);
				try {
					await gate.entered;
					if (change === "off") await ai.update({ userId: "alice", id: provider.id, enabled: false });
					else if (change === "delete") await ai.delete({ userId: "alice", id: provider.id });
					else if (change === "untested") await ai.update({ userId: "alice", id: provider.id, model: "not-tested" });
					else Object.assign(env, { AI_PROVIDER: undefined, AI_MODEL: undefined });
					gate.release();
					await pending;
					expect(requests).toHaveLength(0);
				} finally {
					gate.release();
					gate.restore();
					await pending;
				}
			},
		);
		it("uses captured A after default change and same-ID retarget plus retest during final preparation", async () => {
			const provider = await add("captured-a");
			const second = await add("second");
			requests.length = 0;
			const gate = holdAuthorization();
			const pending = createRouterClient(router, { context: context(aiDestination(provider)) }).parsePosting({
				input: marker,
			});
			try {
				await gate.entered;
				await ai.setDefault({ userId: "alice", id: second.id });
				await ai.update({ userId: "alice", id: provider.id, model: "retargeted-b", apiKey: "retargeted-b" });
				await ai.test({ userId: "alice", id: provider.id });
				requests.length = 0;
				gate.release();
				expect(await pending).toMatchObject({ filledBy: "ai" });
				expect(requests).toHaveLength(1);
				expect(requests[0]?.authorization).toBe("Bearer captured-a-key");
				expect(JSON.parse(requests[0]?.body ?? "{}").model).toBe("stub");
			} finally {
				gate.release();
				gate.restore();
				await pending;
			}
		});
		async function knowledgeFixture() {
			await getDb()
				.insert(tables.application)
				.values({ id: "app", userId: "alice", company: "Fictional", role: "Engineer" });
			await career.saveFact("alice", {
				applicationId: null,
				text: marker,
				category: "skill",
				source: { kind: "manual", id: "proof", quote: marker },
			});
		}
		it.each(["exclude", "story delete", "resume edit", "application edit", "provider off"] as const)(
			"workspace final authorization prevents HTTP after %s",
			async (change) => {
				const provider = await add("workspace");
				await knowledgeFixture();
				if (change === "story delete")
					await pool.query("INSERT INTO career_story(id,user_id,data) VALUES ('story','alice',$1)", [
						JSON.stringify({
							title: "Proof",
							situation: "Fictional",
							task: "",
							action: "",
							result: "",
							reflection: "",
							factIds: [],
						}),
					]);
				if (change === "resume edit") {
					const { sampleResumeData } = await import("@reactive-resume/schema/resume/sample");
					await getDb().insert(tables.resume).values({
						id: "resume",
						name: "Fictional resume",
						userId: "alice",
						slug: "fictional",
						data: sampleResumeData,
					});
					await pool.query("UPDATE application SET resume_id='resume' WHERE id='app'");
				}
				let arrived!: () => void;
				let release!: () => void;
				const entered = new Promise<void>((resolve) => {
					arrived = resolve;
				});
				const held = new Promise<void>((resolve) => {
					release = resolve;
				});
				const original = career.assertMemoryVersion;
				const spy = vi.spyOn(career, "assertMemoryVersion").mockImplementation(async (...args) => {
					arrived();
					await held;
					return original(...args);
				});
				requests.length = 0;
				const pending = createRouterClient(careerRouter, { context: context(aiDestination(provider)) })
					.generate({ applicationId: "app", task: { task: "answer", question: "Why?", answer: "" } })
					.catch((error) => error);
				try {
					await entered;
					if (change === "exclude") {
						const [fact] = await career.facts({ userId: "alice" });
						assert(fact);
						await career.updateFact("alice", { id: fact.id, status: "excluded" });
					} else if (change === "story delete") await career.deleteStory("alice", "story");
					else if (change === "resume edit")
						await pool.query("UPDATE resume SET updated_at=updated_at+interval '1 second' WHERE id='resume'");
					else if (change === "application edit")
						await pool.query("UPDATE application SET updated_at=updated_at+interval '1 second' WHERE id='app'");
					else await ai.update({ userId: "alice", id: provider.id, enabled: false });
					release();
					await pending;
					expect(requests).toHaveLength(0);
				} finally {
					release();
					spy.mockRestore();
					await pending;
				}
			},
		);
		it.each(["unchanged", "provider off", "Knowledge excluded", "stop"] as const)(
			"real agent final step boundary: %s",
			async (change) => {
				const provider = await add("agent");
				await knowledgeFixture();
				const { agentRouter } = await import("../agent/router");
				const client = createRouterClient(agentRouter, { context: context(aiDestination(provider)) });
				const thread = await client.threads.start({ scope: "career", aiProviderId: provider.id });
				requests.length = 0;
				const gate = holdAuthorization();
				const pending = (async () => {
					const stream = await client.messages.send({
						threadId: thread.id,
						message: { id: randomUUID(), role: "user", parts: [{ type: "text", text: "Synthetic request" }] },
						context: { memory: true, application: false, web: false },
					});
					for await (const _chunk of stream) {
						/* Drain real transport. */
					}
				})().catch((error) => error);
				try {
					await gate.entered;
					if (change === "provider off") await ai.update({ userId: "alice", id: provider.id, enabled: false });
					else if (change === "Knowledge excluded") {
						const [fact] = await career.facts({ userId: "alice" });
						assert(fact);
						await career.updateFact("alice", { id: fact.id, status: "excluded" });
					} else if (change === "stop") await client.messages.stop({ threadId: thread.id });
					gate.release();
					await pending;
					expect(requests).toHaveLength(change === "unchanged" ? 1 : 0);
				} finally {
					gate.release();
					gate.restore();
					await pending;
				}
			},
		);
		it.each(["unchanged", "excluded", "forgotten"] as const)(
			"document Knowledge rechecks at the next actual HTTP dispatch: %s",
			async (change) => {
				const provider = await add("document");
				await knowledgeFixture();
				const { defaultResumeData } = await import("@reactive-resume/schema/resume/default");
				await getDb()
					.insert(tables.resume)
					.values({
						id: "document",
						userId: "alice",
						name: "Fictional",
						slug: "fictional",
						data: structuredClone(defaultResumeData),
					});
				await pool.query("UPDATE application SET resume_id=$1 WHERE id=$2", ["document", "app"]);
				const { agentRouter } = await import("../agent/router");
				const client = createRouterClient(agentRouter, { context: context(aiDestination(provider)) });
				const thread = await client.threads.start({
					scope: "document",
					resumeId: "document",
					aiProviderId: provider.id,
				});
				const cancellation = await import("../agent/cancellation");
				// Remote cancellation may not have arrived: final authorization must stand alone.
				const delayed = vi.spyOn(cancellation, "requestRunCancellation").mockResolvedValue(undefined);
				let arrived!: () => void;
				let release!: () => void;
				const entered = new Promise<void>((resolve) => {
					arrived = resolve;
				});
				const held = new Promise<void>((resolve) => {
					release = resolve;
				});
				const original = ai.authorize;
				let step = 0;
				const guard = vi.spyOn(ai, "authorize").mockImplementation(async (...args) => {
					if (++step === 2) {
						arrived();
						await held;
					}
					return original(...args);
				});
				requests.length = 0;
				documentKnowledge = true;
				const pending = (async () => {
					const stream = await client.messages.send({
						threadId: thread.id,
						message: { id: randomUUID(), role: "user", parts: [{ type: "text", text: "Review the shared facts" }] },
						context: { memory: true },
					});
					for await (const _chunk of stream) {
						/* Drain actual SDK stream. */
					}
				})().catch((error) => error);
				try {
					await entered;
					expect(requests).toHaveLength(1);
					const [fact] = await career.facts({ userId: "alice" });
					assert(fact);
					if (change === "excluded") await career.updateFact("alice", { id: fact.id, status: "excluded" });
					else if (change === "forgotten") await career.forgetFact("alice", fact.id);
					release();
					await pending;
					expect(requests).toHaveLength(change === "unchanged" ? 2 : 1);
					if (change === "unchanged") expect(requests[1]?.body).toContain(marker);
					else {
						expect(requests.slice(1).some((request) => request.body.includes(marker))).toBe(false);
						expect(JSON.stringify((await client.threads.get({ id: thread.id })).messages)).not.toContain(marker);
					}
				} finally {
					release();
					guard.mockRestore();
					delayed.mockRestore();
					await pending;
					documentKnowledge = false;
				}
			},
		);

		it("read-only grants, cross-owner recipient and cancellation cannot transmit", async () => {
			const provider = await add("scoped");
			requests.length = 0;
			const readContext = context(aiDestination(provider));
			const readOnly = createRouterClient(router, {
				context: {
					...readContext,
					authentication: { ...readContext.authentication, method: "apiKey" as const, permissions: ["read"] },
				},
			});
			await expect(readOnly.autofill({ jobDescription: marker })).rejects.toMatchObject({ code: "FORBIDDEN" });
			const foreign = await ai.create({
				userId: "bob",
				label: "Foreign",
				provider: "openai-compatible",
				model: "stub",
				baseURL,
				apiKey: "bob",
			});
			const forged = createRouterClient(router, { context: context(aiDestination(foreign)) });
			await expect(forged.autofill({ jobDescription: marker })).rejects.toMatchObject({ code: "NOT_FOUND" });
			const controller = new AbortController();
			const gate = holdAuthorization();
			const pending = createRouterClient(router, { context: context(aiDestination(provider)) })
				.parsePosting({ input: marker }, { signal: controller.signal })
				.catch((error) => error);
			try {
				await gate.entered;
				controller.abort();
				gate.release();
				await pending;
				expect(requests).toHaveLength(0);
			} finally {
				gate.release();
				gate.restore();
				await pending;
			}
		});

		it("keeps actual account erasure trigger and discovery provenance after upgrade", async () => {
			await pool.query(
				"INSERT INTO storage_cleanup_job(id,owner_id,storage_key) VALUES ('narrow','alice','uploads/alice/resume')",
			);
			await pool.query('DELETE FROM "user" WHERE id=$1', ["alice"]);
			expect(
				(await pool.query("SELECT owner_id,storage_key FROM storage_cleanup_job WHERE owner_id='alice'")).rows,
			).toEqual([{ owner_id: "alice", storage_key: "uploads/alice" }]);
			expect(
				(
					await pool.query(
						"SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='career_opportunity' AND column_name='discovery_source'",
						[schemaName],
					)
				).rows,
			).toHaveLength(1);
		});

		it("deletes untested, broken and Off owned providers idempotently, preserving stable survivor and foreign ownership", async () => {
			const first = await add("first");
			const survivor = await add("survivor");
			const untested = await ai.create({
				userId: "alice",
				label: "untested",
				provider: "openai-compatible",
				model: "stub",
				baseURL,
				apiKey: "key",
			});
			await pool.query("UPDATE ai_providers SET test_status='failure',enabled=false WHERE id=$1", [first.id]);
			await ai.update({ userId: "alice", id: survivor.id, enabled: false });
			for (const row of [untested, first, survivor]) {
				await ai.delete({ userId: "bob", id: row.id });
				expect((await ai.list({ userId: "alice" })).some((p) => p.id === row.id)).toBe(true);
				await ai.delete({ userId: "alice", id: row.id });
				await ai.delete({ userId: "alice", id: row.id });
			}
			expect(await ai.list({ userId: "alice" })).toEqual([]);
			const a = await add("a");
			const b = await add("b");
			await add("c");
			await ai.delete({ userId: "alice", id: a.id });
			expect((await ai.list({ userId: "alice" })).filter((p) => p.isDefault).map((p) => p.id)).toEqual([b.id]);
		});
		it("validates preparation using the transaction reader under the owner lock with max:1", async () => {
			const provider = await add("schedule");
			const at = new Date(Date.now() + 86400000 * 3);
			await getDb()
				.insert(tables.application)
				.values({
					id: "app",
					userId: "alice",
					company: "Fictional",
					role: "Engineer",
					activity: [
						{
							id: "round",
							type: "interview",
							at,
							kind: "technical",
							durationMinutes: 45,
							location: "Video",
							notes: "",
							audience: "practitioner",
							participants: [],
							timezone: "Europe/Berlin",
						},
					],
				});
			const saved = await jobs.save(
				"alice",
				careerScheduleInputSchema.parse({
					kind: "prepare",
					enabled: true,
					applicationId: "app",
					interviewId: "round",
					aiProviderId: provider.id,
					timezone: "Europe/Berlin",
					nextRunAt: at,
					lead: "24h",
				}),
			);
			expect(saved).toMatchObject({ enabled: true, aiProviderId: provider.id });
			const blocker = await admin.connect();
			try {
				await blocker.query("BEGIN");
				await blocker.query(`SET LOCAL search_path=${schemaName}`);
				await blocker.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', ["alice"]);
				const pending = jobs.save("alice", careerScheduleInputSchema.parse({ ...saved, enabled: true }));
				const rejected = expect(pending).rejects.toMatchObject({ code: "BAD_REQUEST" });
				await expect
					.poll(
						async () =>
							(
								await admin.query(
									"SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",
									[schemaName],
								)
							).rows[0]?.count,
					)
					.toBe(1);
				await blocker.query("UPDATE ai_providers SET enabled=false,user_disabled=true WHERE id=$1", [provider.id]);
				await blocker.query("COMMIT");
				await rejected;
			} finally {
				await blocker.query("ROLLBACK");
				blocker.release();
			}
			await ai.update({ userId: "alice", id: provider.id, enabled: false });
			await expect(
				jobs.save("alice", careerScheduleInputSchema.parse({ ...saved, enabled: true })),
			).rejects.toMatchObject({ code: "BAD_REQUEST" });
		});

		async function preparationFixture(managed = false) {
			if (managed)
				Object.assign(env, {
					AI_PROVIDER: "openai-compatible",
					AI_MODEL: "stub",
					AI_API_KEY: "managed-a",
					AI_BASE_URL: baseURL,
				});
			const a = managed ? (await ai.list({ userId: "alice" }))[0] : await add("scheduled-a");
			assert(a);
			const b = managed ? a : await add("scheduled-b");
			if (!managed) await ai.setDefault({ userId: "alice", id: b.id });
			const at = new Date(Date.now() + 3 * 86400000);
			await getDb()
				.insert(tables.application)
				.values({
					id: "app",
					userId: "alice",
					company: "Fictional",
					role: "Engineer",
					notes: marker,
					activity: [
						{
							id: "round",
							type: "interview",
							at,
							kind: "technical",
							durationMinutes: 45,
							location: "Video",
							notes: "",
							audience: "practitioner",
							participants: [],
							timezone: "Europe/Berlin",
						},
					],
				});
			const schedule = await createRouterClient(careerRouter, { context: context(aiDestination(a)) }).saveSchedule(
				careerScheduleInputSchema.parse({
					kind: "prepare",
					enabled: true,
					applicationId: "app",
					interviewId: "round",
					aiProviderId: a.id,
					timezone: "Europe/Berlin",
					nextRunAt: at,
					lead: "24h",
				}),
			);
			expect(schedule).not.toHaveProperty("aiProviderVersion");
			expect(
				(await pool.query("SELECT ai_provider_version FROM career_schedule WHERE id=$1", [schedule.id])).rows,
			).toEqual([{ ai_provider_version: a.recipientVersion }]);
			requests.length = 0;
			return { a, b, schedule };
		}
		async function tick() {
			const { runCareerJobs } = await import("../career/jobs");
			return runCareerJobs();
		}
		async function due(id: string) {
			await pool.query(
				"UPDATE career_schedule SET next_run_at=now()-interval '1 minute',last_queued_at=NULL WHERE id=$1",
				[id],
			);
		}
		async function deleteProvider(id: string) {
			const { aiProvidersRouter } = await import("./router");
			return createRouterClient(aiProvidersRouter, { context: context() }).delete({ id });
		}
		it.each(["delete", "retarget", "off"] as const)(
			"scheduled lifecycle %s pauses and cancels queued work before another recipient can be used",
			async (change) => {
				const { a, schedule } = await preparationFixture();
				await getDb()
					.insert(tables.careerJob)
					.values({ id: "queued", userId: "alice", scheduleId: schedule.id, dueAt: new Date(Date.now() - 60000) });
				if (change === "delete") await deleteProvider(a.id);
				else
					await ai.update({
						userId: "alice",
						id: a.id,
						...(change === "off" ? { enabled: false } : { apiKey: "replacement-key" }),
					});
				expect(
					(await pool.query("SELECT enabled,ai_provider_id FROM career_schedule WHERE id=$1", [schedule.id])).rows,
				).toEqual([{ enabled: false, ai_provider_id: change === "delete" ? null : a.id }]);
				expect((await pool.query("SELECT status,lease,lease_until FROM career_job WHERE id='queued'")).rows).toEqual([
					{ status: "canceled", lease: null, lease_until: null },
				]);
				await due(schedule.id);
				await tick();
				expect(requests).toHaveLength(0);
			},
		);
		it.each(["id", "revision"] as const)(
			"scheduled work without recipient %s pauses with an actionable failure instead of choosing the default",
			async (missing) => {
				const { schedule } = await preparationFixture();
				await pool.query(
					missing === "id"
						? "UPDATE career_schedule SET ai_provider_id=NULL WHERE id=$1"
						: "UPDATE career_schedule SET ai_provider_version=NULL WHERE id=$1",
					[schedule.id],
				);
				await due(schedule.id);
				await tick();
				expect(requests).toHaveLength(0);
				expect((await pool.query("SELECT enabled FROM career_schedule WHERE id=$1", [schedule.id])).rows).toEqual([
					{ enabled: false },
				]);
				expect((await pool.query("SELECT status FROM career_job WHERE schedule_id=$1", [schedule.id])).rows).toEqual([
					{ status: "canceled" },
				]);
				expect((await pool.query("SELECT notice FROM career_notification WHERE user_id='alice'")).rows).toContainEqual({
					notice: { type: "schedule-failed", reason: "failed" },
				});
			},
		);
		it.each(["before resolution", "before authorization", "changed schedule"] as const)(
			"scheduled deletion/selection race: %s makes zero actual HTTP requests",
			async (change) => {
				const { a, b, schedule } = await preparationFixture();
				let entered!: () => void;
				let release!: () => void;
				const arrived = new Promise<void>((resolve) => {
					entered = resolve;
				});
				const held = new Promise<void>((resolve) => {
					release = resolve;
				});
				const originalContext = career.context;
				const originalCheck = career.assertMemoryVersion;
				const spy =
					change === "before resolution"
						? vi.spyOn(career, "context").mockImplementation(async (...args) => {
								const result = await originalContext(...args);
								entered();
								await held;
								return result;
							})
						: vi.spyOn(career, "assertMemoryVersion").mockImplementation(async (...args) => {
								entered();
								await held;
								return originalCheck(...args);
							});
				await due(schedule.id);
				const pending = tick();
				try {
					await arrived;
					if (change === "changed schedule")
						await pool.query("UPDATE career_schedule SET ai_provider_id=$1 WHERE id=$2", [b.id, schedule.id]);
					else await deleteProvider(a.id);
					release();
					await pending;
					expect(requests).toHaveLength(0);
					const jobs = (await pool.query("SELECT status FROM career_job WHERE schedule_id=$1", [schedule.id])).rows;
					expect(jobs).toEqual([{ status: change === "changed schedule" ? "queued" : "canceled" }]);
				} finally {
					release();
					spy.mockRestore();
					await pending;
				}
			},
		);
		it("scheduled generation cannot omit its recipient while manual generation uses the authorized default", async () => {
			const { b } = await preparationFixture();
			const { generateCareer } = await import("../career/generate");
			await expect(
				generateCareer({
					userId: "alice",
					applicationId: "app",
					locale: "en-US",
					task: { task: "briefing", interviewId: "round" },
					jobId: "missing",
					jobLease: "missing",
				}),
			).rejects.toMatchObject({ code: "BAD_REQUEST" });
			expect(requests).toHaveLength(0);
			const result = await createRouterClient(careerRouter, { context: context(aiDestination(b)) }).generate({
				applicationId: "app",
				task: { task: "answer", question: "Why?", answer: "" },
			});
			expect(result.answer?.text).toBe("Fictional answer");
			expect(requests).toHaveLength(1);
			expect(requests[0]?.authorization).toBe("Bearer scheduled-b-key");
		});

		it.each(["unchanged", "key", "model", "url"] as const)(
			"scheduled managed recipient revision: %s",
			async (change) => {
				const { schedule } = await preparationFixture(true);
				if (change === "key") Object.assign(env, { AI_API_KEY: "managed-b" });
				if (change === "model") Object.assign(env, { AI_MODEL: "replacement-model" });
				if (change === "url") Object.assign(env, { AI_BASE_URL: `${baseURL}/replacement` });
				await due(schedule.id);
				await tick();
				expect(requests).toHaveLength(change === "unchanged" ? 1 : 0);
				if (change === "unchanged") {
					expect(requests[0]?.authorization).toBe("Bearer managed-a");
					expect(requests[0]?.body).toContain(marker);
				}
			},
		);

		it("scheduled work refuses a different managed recipient instead of silently overriding the selected provider", async () => {
			const { schedule } = await preparationFixture();
			await pool.query("UPDATE ai_providers SET is_default=false WHERE user_id='alice'");
			Object.assign(env, {
				AI_PROVIDER: "openai-compatible",
				AI_MODEL: "stub",
				AI_API_KEY: "managed-replacement",
				AI_BASE_URL: baseURL,
			});
			await due(schedule.id);
			await tick();
			expect(requests).toHaveLength(0);
		});
		it("scheduled preparation uses A despite default B and uses B only after explicit new schedule approval", async () => {
			const { a, b, schedule } = await preparationFixture();
			await due(schedule.id);
			await tick();
			expect(requests).toHaveLength(1);
			expect(requests[0]?.authorization).toBe("Bearer scheduled-a-key");
			expect(requests[0]?.body).toContain(marker);
			expect(
				(await pool.query("SELECT count(*)::int AS n FROM career_artifact WHERE job_id IS NOT NULL")).rows,
			).toEqual([{ n: 1 }]);
			await deleteProvider(a.id);
			const stale = createRouterClient(careerRouter, { context: context(aiDestination(a)) });
			await expect(
				stale.saveSchedule({
					...careerScheduleInputSchema.parse({ ...schedule, aiProviderId: b.id, enabled: true }),
					id: schedule.id,
				}),
			).rejects.toMatchObject({ code: "CONFLICT" });
			expect((await pool.query("SELECT enabled FROM career_schedule WHERE id=$1", [schedule.id])).rows).toEqual([
				{ enabled: false },
			]);
			await createRouterClient(careerRouter, { context: context(aiDestination(b)) }).saveSchedule({
				...careerScheduleInputSchema.parse({ ...schedule, aiProviderId: b.id, enabled: true }),
				id: schedule.id,
			});
			await due(schedule.id);
			requests.length = 0;
			await tick();
			expect(requests).toHaveLength(1);
			expect(requests[0]?.authorization).toBe("Bearer scheduled-b-key");
			expect(requests[0]?.body).toContain(marker);
		});

		it("binds concrete speech and transcription models to actual HTTP payloads and rejects a different model before transmission", async () => {
			const provider = await add("voice", "openai");
			requests.length = 0;
			const speech = createRouterClient(voice, {
				context: context(aiDestination(provider, { kind: "speech", model: "tts-1" })),
			});
			await speech.speak({ providerId: provider.id, model: "tts-1", text: "Only this fictional text" });
			expect(JSON.parse(requests[0]?.body ?? "")).toMatchObject({ model: "tts-1", input: "Only this fictional text" });
			requests.length = 0;
			await expect(speech.speak({ providerId: provider.id, model: "tts-1-hd", text: marker })).rejects.toMatchObject({
				code: "CONFLICT",
			});
			expect(requests).toHaveLength(0);
			const transcription = createRouterClient(voice, {
				context: context(aiDestination(provider, { kind: "transcription", model: "whisper-1" })),
			});
			expect(
				await transcription.transcribe({
					providerId: provider.id,
					model: "whisper-1",
					audio: new File(["fictional-recording"], "recording.webm", { type: "audio/webm" }),
				}),
			).toMatchObject({ text: "Fictional transcript" });
			expect(requests[0]?.body).toContain("whisper-1");
			expect(requests[0]?.body).toContain("fictional-recording");
		});
		it.each(["unchanged", "application off", "answer cleared"] as const)(
			"re-projects coach answers at the final SDK dispatch: %s",
			async (change) => {
				const provider = await add("coach");
				await getDb()
					.insert(tables.application)
					.values({ id: "app", userId: "alice", company: "Fictional", role: "Engineer" });
				const privateText = "RX100_PRIVATE_FORM_ANSWER_CLEARED_BEFORE_FIRST_DISPATCH";
				const answers = [{ id: "answer", question: "Why?", answer: privateText, factIds: [] as string[] }];
				await career.saveWorkspace("alice", "app", { answers }, { answers: [] });
				const { agentRouter } = await import("../agent/router");
				const client = createRouterClient(agentRouter, { context: context(aiDestination(provider)) });
				const thread = await client.threads.start({
					scope: "application",
					applicationId: "app",
					aiProviderId: provider.id,
				});
				const gate = holdAuthorization();
				requests.length = 0;
				const pending = (async () => {
					const stream = await client.messages.send({
						threadId: thread.id,
						message: { id: randomUUID(), role: "user", parts: [{ type: "text", text: "Help with this application" }] },
						context: {
							application: change !== "application off",
							memory: false,
							web: false,
							tab: "apply",
						},
					});
					for await (const _chunk of stream) {
						// Drain the real stream through the real SDK/HTTP boundary.
					}
				})().catch((error) => error);
				try {
					await gate.entered;
					expect(requests).toHaveLength(0);
					if (change === "answer cleared") await career.saveWorkspace("alice", "app", { answers: [] }, { answers });
					gate.release();
					await pending;
					const leaked = requests.some((request) => request.body.includes(privateText));
					expect(leaked).toBe(change === "unchanged");
					expect(await career.workspaceAnswers("alice", "app")).toHaveLength(change === "answer cleared" ? 0 : 1);
				} finally {
					gate.release();
					gate.restore();
					await pending;
				}
			},
			30_000,
		);
	},
);
