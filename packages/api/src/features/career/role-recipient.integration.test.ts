import type { AddressInfo } from "node:net";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createRouterClient } from "@orpc/server";
import { Pool } from "pg";
import z from "zod";
import { db, withDatabasePool } from "@reactive-resume/db/client";
import * as tables from "@reactive-resume/db/schema";
import { env } from "@reactive-resume/env/server";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";
import { aiProvidersRouter } from "../ai-providers/router";
import { aiProvidersService } from "../ai-providers/service";
import { getModel } from "../ai/service";
import { generateJson } from "../applications/ai";
import { careerRouter } from "./router";
import { careerService } from "./service";

// Operator configuration can change between requests; provider, crypto, router, DB and HTTP calls remain real.
vi.mock("@reactive-resume/env/server", async (original) => {
	const module = await original<typeof import("@reactive-resume/env/server")>();
	return { env: { ...module.env } };
});

async function localProvider() {
	const requests: Array<{ body: { model: string }; authorization: string | undefined; roles: boolean }> = [];
	let onGeneration: (() => Promise<void>) | undefined;
	let rejectNextGeneration = false;
	const server = createServer((req, res) => {
		if (req.method !== "POST") {
			res.writeHead(404).end();
			return;
		}
		let body = "";
		req.on("data", (chunk) => {
			body += chunk;
		});
		req.on("end", () => {
			let parsed: { model: string };
			try {
				parsed = JSON.parse(body) as { model: string };
				if (!parsed || typeof parsed.model !== "string") throw new Error("Missing model");
			} catch {
				res.writeHead(400).end();
				return;
			}
			const roles = body.includes("Suggest up to five plausible target job titles");
			requests.push({ body: parsed, authorization: req.headers.authorization, roles });
			void (async () => {
				if (roles) await onGeneration?.();
				if (roles && rejectNextGeneration) {
					rejectNextGeneration = false;
					res.writeHead(503, { "content-type": "application/json", "retry-after": "1" });
					res.end(JSON.stringify({ error: { message: "Synthetic temporary provider failure" } }));
					return;
				}
				res.writeHead(200, { "content-type": "application/json" });
				res.end(
					JSON.stringify({
						id: "local",
						object: "chat.completion",
						created: 0,
						model: parsed.model,
						choices: [
							{
								index: 0,
								message: {
									role: "assistant",
									content: roles
										? JSON.stringify({ suggestions: [{ role: "Engineer", factIds: ["shared"], resumeQuote: null }] })
										: "1",
								},
								finish_reason: "stop",
							},
						],
						usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
					}),
				);
			})();
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as AddressInfo).port;
	return {
		baseURL: `http://127.0.0.1:${port}/v1`,
		reopen: () => new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve)),
		requests,
		rejectNext: () => {
			rejectNextGeneration = true;
		},
		hold: (callback: () => Promise<void>) => {
			onGeneration = callback;
		},
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

const databaseUrl = process.env.INTEGRATIONS_TEST_DATABASE_URL;
it("recipient test provider rejects unrelated probes without recording or throwing", async () => {
	const provider = await localProvider();
	try {
		expect((await fetch(provider.baseURL)).status).toBe(404);
		for (const body of ["", "not json", "{}"])
			expect((await fetch(provider.baseURL, { method: "POST", body })).status).toBe(400);
		expect(provider.requests).toEqual([]);
	} finally {
		await provider.close();
	}
});
describe.skipIf(!databaseUrl)("role recipient approval through router, PostgreSQL and HTTP", () => {
	const schemaName = `rx76_recipient_${randomUUID().replaceAll("-", "")}`;
	const admin = new Pool({ connectionString: databaseUrl });
	let pool: Pool;
	let a: Awaited<ReturnType<typeof localProvider>>;
	let b: Awaited<ReturnType<typeof localProvider>>;
	let user: typeof tables.user.$inferSelect;
	const client = (permissions: ("read" | "write" | "delete")[] = ["read", "write", "delete"]) =>
		createRouterClient(
			{ career: careerRouter, providers: aiProvidersRouter },
			{
				context: {
					locale: "en-US",
					reqHeaders: new Headers(),
					authentication: { user, method: "apiKey", permissions },
				},
			},
		);
	const input = (provider: { id: string; recipientVersion: string }) => ({
		providerId: provider.id,
		recipientVersion: provider.recipientVersion,
		resumeId: null,
		includeKnowledge: true,
	});
	const create = async () => {
		const provider = await client().providers.create({
			label: "Local A",
			provider: "openai-compatible",
			model: "model-a",
			baseURL: a.baseURL,
			apiKey: "synthetic-key-a",
		});
		return client().providers.test({ id: provider.id });
	};
	const run = (operation: () => Promise<void>) => withDatabasePool(pool, operation);
	beforeAll(async () => {
		await admin.query(`CREATE SCHEMA ${schemaName}`);
		pool = new Pool({
			connectionString: databaseUrl,
			options: `-c search_path=${schemaName} -c statement_timeout=10000`,
		});
		const migrations = new URL("../../../../../migrations/", import.meta.url);
		for (const directory of (await readdir(migrations)).filter((name) => /^\d+_/.test(name)).sort())
			await pool.query(
				(await readFile(new URL(`${directory}/migration.sql`, migrations), "utf8")).replaceAll('"public".', ""),
			);
		a = await localProvider();
		b = await localProvider();
	}, 30000);
	beforeEach(async () => {
		Object.assign(env, { AI_PROVIDER: undefined, AI_MODEL: undefined, AI_API_KEY: undefined, AI_BASE_URL: undefined });
		await pool.query('TRUNCATE "user" CASCADE');
		await withDatabasePool(pool, async () => {
			const users = await db
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
				])
				.returning();
			const alice = users[0];
			assert(alice);
			user = alice;
			await db.insert(tables.careerFact).values({
				id: "shared",
				userId: user.id,
				text: "Synthetic reliable systems",
				category: "skill",
				source: { kind: "manual", id: "s", quote: "Synthetic reliable systems" },
				sourceKey: "s",
			});
		});
	});
	afterAll(async () => {
		await a?.close();
		await b?.close();
		await pool?.end();
		await admin.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
		await admin.end();
	});

	it.each(["excluded", "forgotten"] as const)(
		"never retries a failed dispatch after Knowledge is %s",
		(status) =>
			run(async () => {
				const approved = await create();
				const before = a.requests.filter((request) => request.roles).length;
				await a.close();
				let reopened = false;
				const pending = client()
					.career.suggestTargetRoles(input(approved))
					.then(
						() => null,
						(error: unknown) => error,
					);
				try {
					await new Promise((resolve) => setTimeout(resolve, 700));
					if (status === "forgotten") await careerService.forgetFact(user.id, "shared");
					else await careerService.updateFact(user.id, { id: "shared", status });
					await a.reopen();
					reopened = true;
					const error = await pending;
					expect(a.requests.filter((request) => request.roles)).toHaveLength(before);
					expect(error).toMatchObject({ code: "BAD_GATEWAY" });
				} finally {
					if (!reopened) await a.reopen();
					await pending;
				}
			}),
		15000,
	);

	it("keeps approval stable across retest, label, default and usage; sends approved configuration", () =>
		run(async () => {
			const disclosed = await create();
			await client().providers.update({ id: disclosed.id, label: "Renamed" });
			await client().providers.test({ id: disclosed.id });
			await client().providers.setDefault({ id: disclosed.id });
			await aiProvidersService.markUsed({ userId: user.id, id: disclosed.id });
			expect((await client().providers.list({}))[0]?.recipientVersion).toBe(disclosed.recipientVersion);
			await expect(client().career.suggestTargetRoles(input(disclosed))).resolves.toMatchObject({
				suggestions: [{ role: "Engineer" }],
			});
			expect(a.requests.at(-1)).toMatchObject({
				body: { model: "model-a" },
				authorization: "Bearer synthetic-key-a",
				roles: true,
			});
		}));

	it.each(["origin", "model", "credential"] as const)(
		"rejects same-ID %s mutation and retest before transmission",
		(change) =>
			run(async () => {
				const disclosed = await create();
				await client().providers.update({
					id: disclosed.id,
					...(change === "origin"
						? { baseURL: b.baseURL, apiKey: "synthetic-key-b" }
						: change === "model"
							? { model: "model-b" }
							: { apiKey: "synthetic-key-b" }),
				});
				const tested = await client().providers.test({ id: disclosed.id });
				expect(tested.recipientVersion).not.toBe(disclosed.recipientVersion);
				const counts = [a.requests.length, b.requests.length];
				await expect(client().career.suggestTargetRoles(input(disclosed))).rejects.toMatchObject({ code: "CONFLICT" });
				expect([a.requests.length, b.requests.length]).toEqual(counts);
				await expect(client().career.suggestTargetRoles(input(tested))).resolves.toMatchObject({
					suggestions: [{ role: "Engineer" }],
				});
			}),
	);

	it("rejects missing version, read-only grants and cross-owner provider before transmission", () =>
		run(async () => {
			const disclosed = await create();
			const counts = [a.requests.length, b.requests.length];
			const { recipientVersion: _version, ...oldInput } = input(disclosed);
			await expect(client().career.suggestTargetRoles(oldInput as ReturnType<typeof input>)).rejects.toMatchObject({
				code: "BAD_REQUEST",
			});
			await expect(client(["read"]).career.suggestTargetRoles(input(disclosed))).rejects.toMatchObject({
				code: "FORBIDDEN",
			});
			const bob = (await db.select().from(tables.user)).find((row) => row.id === "bob");
			assert(bob);
			user = bob;
			await db.insert(tables.careerFact).values({
				userId: user.id,
				text: "Bob fact",
				category: "skill",
				source: { kind: "manual", id: "b", quote: "Bob fact" },
				sourceKey: "b",
			});
			await expect(client().career.suggestTargetRoles(input(disclosed))).rejects.toMatchObject({ code: "NOT_FOUND" });
			expect([a.requests.length, b.requests.length]).toEqual(counts);
		}));

	it("keeps transmitting with the captured approved personal configuration during retarget/retest", () =>
		run(async () => {
			const disclosed = await create();
			let arrived!: () => void;
			let release!: () => void;
			const entered = new Promise<void>((resolve) => {
				arrived = resolve;
			});
			const held = new Promise<void>((resolve) => {
				release = resolve;
			});
			a.hold(async () => {
				arrived();
				await held;
			});
			const before = b.requests.length;
			const pending = client().career.suggestTargetRoles(input(disclosed));
			try {
				await entered;
				await client().providers.update({
					id: disclosed.id,
					model: "model-b",
					baseURL: b.baseURL,
					apiKey: "synthetic-key-b",
				});
				await client().providers.test({ id: disclosed.id });
				release();
				await expect(pending).resolves.toMatchObject({ suggestions: [{ role: "Engineer" }] });
				expect(a.requests.at(-1)).toMatchObject({
					body: { model: "model-a" },
					authorization: "Bearer synthetic-key-a",
					roles: true,
				});
				expect(b.requests.slice(before).filter((request) => request.roles)).toEqual([]);
			} finally {
				release();
				a.hold(async () => {});
			}
		}));

	it("binds managed server ID to config and credential, then uses a reconfirmed captured config", () =>
		run(async () => {
			Object.assign(env, {
				AI_PROVIDER: "openai-compatible",
				AI_MODEL: "managed-a",
				AI_BASE_URL: a.baseURL,
				AI_API_KEY: "synthetic-managed-a",
			});
			let disclosed = (await client().providers.list({}))[0];
			assert(disclosed);
			expect(disclosed.id).toBe("server-ai:alice");
			expect((await client().providers.list({}))[0]?.recipientVersion).toBe(disclosed.recipientVersion);
			await expect(client().career.suggestTargetRoles(input(disclosed))).resolves.toMatchObject({
				suggestions: [{ role: "Engineer" }],
			});
			for (const change of [
				{ AI_BASE_URL: b.baseURL },
				{ AI_MODEL: "managed-b" },
				{ AI_API_KEY: "synthetic-managed-b" },
			]) {
				Object.assign(env, change);
				const counts = [a.requests.length, b.requests.length];
				await expect(client().career.suggestTargetRoles(input(disclosed))).rejects.toMatchObject({ code: "CONFLICT" });
				expect([a.requests.length, b.requests.length]).toEqual(counts);
				disclosed = (await client().providers.list({}))[0];
				assert(disclosed);
			}
			await expect(client().career.suggestTargetRoles(input(disclosed))).resolves.toMatchObject({
				suggestions: [{ role: "Engineer" }],
			});
			expect(b.requests.at(-1)).toMatchObject({
				body: { model: "managed-b" },
				authorization: "Bearer synthetic-managed-b",
				roles: true,
			});
		}));

	it("captures managed configuration and key together even when environment changes during the DB await", () =>
		run(async () => {
			Object.assign(env, {
				AI_PROVIDER: "openai-compatible",
				AI_MODEL: "managed-a",
				AI_BASE_URL: a.baseURL,
				AI_API_KEY: "synthetic-managed-a",
			});
			const disclosed = (await client().providers.list({}))[0];
			assert(disclosed);
			const lock = await pool.connect();
			await lock.query("BEGIN");
			await lock.query("SELECT id FROM ai_providers WHERE id=$1 FOR UPDATE", [disclosed.id]);
			const pending = client().career.suggestTargetRoles(input(disclosed));
			try {
				// Observe the real provider upsert waiting on our row lock, then change the operator configuration.
				await vi.waitFor(async () => {
					const blocked = await admin.query(
						"SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'insert into \"ai_providers\"%' AND pid <> pg_backend_pid()",
					);
					expect(blocked.rows[0]?.count).toBeGreaterThan(0);
				});
				Object.assign(env, { AI_MODEL: "managed-b", AI_BASE_URL: b.baseURL, AI_API_KEY: "synthetic-managed-b" });
				await lock.query("COMMIT");
				await expect(pending).resolves.toMatchObject({ suggestions: [{ role: "Engineer" }] });
				expect(a.requests.at(-1)).toMatchObject({
					body: { model: "managed-a" },
					authorization: "Bearer synthetic-managed-a",
					roles: true,
				});
			} finally {
				await lock.query("ROLLBACK");
				lock.release();
			}
		}));
	it.each(["excluded", "forgotten"] as const)(
		"does not build stale Knowledge while managed provider awaits resolution: %s",
		(status) =>
			run(async () => {
				Object.assign(env, {
					AI_PROVIDER: "openai-compatible",
					AI_MODEL: "managed-a",
					AI_BASE_URL: a.baseURL,
					AI_API_KEY: "synthetic-managed-a",
				});
				const disclosed = (await client().providers.list({}))[0];
				assert(disclosed);
				const lock = await pool.connect();
				await lock.query("BEGIN");
				await lock.query("SELECT id FROM ai_providers WHERE id=$1 FOR UPDATE", [disclosed.id]);
				const before = a.requests.length;
				const pending = client()
					.career.suggestTargetRoles(input(disclosed))
					.then(
						(value) => ({ value, code: null }),
						(error) => ({ value: null, code: error.code }),
					);
				try {
					await vi.waitFor(async () => {
						const blocked = await admin.query(
							"SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'insert into \"ai_providers\"%' AND pid <> pg_backend_pid()",
						);
						expect(blocked.rows[0]?.count).toBeGreaterThan(0);
					});
					if (status === "forgotten") await careerService.forgetFact(user.id, "shared");
					else await careerService.updateFact(user.id, { id: "shared", status });
					expect(a.requests.length).toBe(before);
					await lock.query("COMMIT");
					// Provider resolves first: context then observes no shared facts instead of capturing revoked text.
					const result = await pending;
					expect(a.requests.slice(before).filter((request) => request.roles)).toEqual([]);
					expect(result.code).toBe("BAD_REQUEST");
				} finally {
					await lock.query("ROLLBACK");
					lock.release();
					await pending;
				}
			}),
	);

	it.each(["excluded", "forgotten", "corrected", "added"] as const)(
		"checks Knowledge after awaited selected-resume preparation: %s",
		(change) =>
			run(async () => {
				const disclosed = await create();
				await db
					.insert(tables.resume)
					.values({ id: "selected", userId: user.id, name: "Synthetic", slug: "selected", data: sampleResumeData });
				const lock = await pool.connect();
				await lock.query("BEGIN");
				await lock.query("LOCK TABLE resume IN ACCESS EXCLUSIVE MODE");
				const before = a.requests.length;
				const pending = client()
					.career.suggestTargetRoles({ ...input(disclosed), resumeId: "selected" })
					.then(
						(value) => ({ value, code: null }),
						(error) => ({ value: null, code: error.code }),
					);
				try {
					await vi.waitFor(async () => {
						const blocked = await admin.query(
							"SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'select %from \"resume\"%' AND pid <> pg_backend_pid()",
						);
						expect(blocked.rows[0]?.count).toBeGreaterThan(0);
					});
					if (change === "forgotten") await careerService.forgetFact(user.id, "shared");
					else if (change === "added")
						await careerService.saveFact(user.id, {
							applicationId: null,
							text: "Newly shared systems fact",
							category: "skill",
							source: { kind: "manual", id: "new-shared", quote: "Newly shared systems fact" },
						});
					else
						await careerService.updateFact(user.id, {
							id: "shared",
							...(change === "corrected" ? { text: "Corrected systems fact" } : { status: change }),
						});
					expect(a.requests.length).toBe(before);
					await lock.query("COMMIT");
					const result = await pending;
					expect(a.requests.slice(before).filter((request) => request.roles)).toEqual([]);
					expect(result.code).toBe("CONFLICT");
				} finally {
					await lock.query("ROLLBACK");
					lock.release();
					await pending;
				}
			}),
	);

	it.each(["tail edit", "trash"] as const)(
		"checks complete selected resume after an awaited validation lock: %s",
		(change) =>
			run(async () => {
				const disclosed = await create();
				const data = structuredClone(sampleResumeData);
				data.basics.headline = "Synthetic ".repeat(1500) + "original tail";
				await db
					.insert(tables.resume)
					.values({ id: "selected", userId: user.id, name: "Synthetic", slug: "selected", data });
				const lock = await pool.connect();
				await lock.query("BEGIN");
				await lock.query("SELECT id FROM resume WHERE id='selected' FOR UPDATE");
				const before = a.requests.length;
				const pending = client()
					.career.suggestTargetRoles({ ...input(disclosed), resumeId: "selected", includeKnowledge: false })
					.then(
						(value) => ({ value, code: null }),
						(error) => ({ value: null, code: error.code }),
					);
				try {
					await vi.waitFor(async () => {
						const blocked = await admin.query(
							"SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'select %from \"resume\"%for share%' AND pid <> pg_backend_pid()",
						);
						expect(blocked.rows[0]?.count).toBeGreaterThan(0);
					});
					if (change === "trash") await lock.query("UPDATE resume SET trashed_at=now() WHERE id='selected'");
					else {
						data.basics.headline = data.basics.headline.replace("original tail", "corrected tail");
						// Keep updated_at unchanged: even a data edit outside the sent excerpt must invalidate the snapshot.
						await lock.query("UPDATE resume SET data=$1 WHERE id='selected'", [JSON.stringify(data)]);
					}
					expect(a.requests.length).toBe(before);
					await lock.query("COMMIT");
					const result = await pending;
					expect(a.requests.slice(before).filter((request) => request.roles)).toEqual([]);
					expect(result.code).toBe("CONFLICT");
				} finally {
					await lock.query("ROLLBACK");
					lock.release();
					await pending;
				}
			}),
	);

	it.each(["excluded", "forgotten"] as const)(
		"releases DB locks during HTTP and rejects later Knowledge/resume changes: %s",
		(status) =>
			run(async () => {
				const disclosed = await create();
				await db
					.insert(tables.resume)
					.values({ id: "selected", userId: user.id, name: "Synthetic", slug: "selected", data: sampleResumeData });
				let arrived!: () => void;
				let release!: () => void;
				const entered = new Promise<void>((resolve) => {
					arrived = resolve;
				});
				const held = new Promise<void>((resolve) => {
					release = resolve;
				});
				a.hold(async () => {
					arrived();
					await held;
				});
				const pending = client()
					.career.suggestTargetRoles({ ...input(disclosed), resumeId: "selected" })
					.then(
						(value) => ({ value, code: null }),
						(error) => ({ value: null, code: error.code }),
					);
				let mutation: Promise<unknown> | undefined;
				try {
					await entered;
					let committed = false;
					mutation = Promise.all([
						status === "forgotten"
							? careerService.forgetFact(user.id, "shared")
							: careerService.updateFact(user.id, { id: "shared", status }),
						pool.query(
							"UPDATE resume SET data=jsonb_set(data,'{basics,name}','\"Changed during HTTP\"'::jsonb) WHERE id='selected'",
						),
					]).then(() => {
						committed = true;
					});
					await vi.waitFor(() => expect(committed).toBe(true), { timeout: 2000 });
					release();
					expect((await pending).code).toBe("CONFLICT");
				} finally {
					release();
					a.hold(async () => {});
					await mutation;
					await pending;
				}
			}),
	);
	it.each([
		["off", "preparation"],
		["delete", "preparation"],
		["managed-off", "preparation"],
		["off", "validation"],
		["delete", "validation"],
		["managed-off", "validation"],
		["retarget-off", "preparation"],
		["retarget-off", "validation"],
	] as const)("does not send after provider %s during %s", (change, phase) =>
		run(async () => {
			if (change === "managed-off")
				Object.assign(env, {
					AI_PROVIDER: "openai-compatible",
					AI_MODEL: "managed-a",
					AI_BASE_URL: a.baseURL,
					AI_API_KEY: "synthetic-managed-a",
				});
			const disclosed = change === "managed-off" ? (await client().providers.list({}))[0] : await create();
			assert(disclosed);
			await db
				.insert(tables.resume)
				.values({ id: "selected", userId: user.id, name: "Synthetic", slug: "selected", data: sampleResumeData });
			const lock = await pool.connect();
			await lock.query("BEGIN");
			await lock.query(
				phase === "preparation"
					? "LOCK TABLE resume IN ACCESS EXCLUSIVE MODE"
					: "SELECT id FROM resume WHERE id='selected' FOR UPDATE",
			);
			const before = a.requests.length;
			const beforeB = b.requests.length;
			const pending = client()
				.career.suggestTargetRoles({ ...input(disclosed), resumeId: "selected" })
				.then(
					(value) => ({ value, code: null }),
					(error) => ({ value: null, code: error.code }),
				);
			try {
				await vi.waitFor(async () => {
					const blocked = await admin.query(
						"SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'select %from \"resume\"%' AND pid <> pg_backend_pid()",
					);
					expect(blocked.rows[0]?.count).toBeGreaterThan(0);
				});
				if (change === "retarget-off") {
					await client().providers.update({
						id: disclosed.id,
						model: "model-b",
						baseURL: b.baseURL,
						apiKey: "synthetic-key-b",
					});
					await client().providers.test({ id: disclosed.id });
					await client().providers.update({ id: disclosed.id, enabled: false });
				} else if (change === "off") await client().providers.update({ id: disclosed.id, enabled: false });
				else if (change === "delete") await client().providers.delete({ id: disclosed.id });
				else Object.assign(env, { AI_PROVIDER: undefined, AI_MODEL: undefined });
				expect(a.requests.length).toBe(before);
				await lock.query("COMMIT");
				const result = await pending;
				expect(a.requests.slice(before).filter((request) => request.roles)).toEqual([]);
				expect(b.requests.slice(beforeB).filter((request) => request.roles)).toEqual([]);
				expect(result.value).toBeNull();
				expect(result.code).toBe(change === "delete" ? "NOT_FOUND" : "BAD_REQUEST");
			} finally {
				await lock.query("ROLLBACK");
				lock.release();
				await pending;
			}
		}),
	);

	it("keeps Knowledge serialized while the final provider availability check waits", () =>
		run(async () => {
			const approved = await create();
			const lock = await pool.connect();
			await lock.query("BEGIN");
			await lock.query("SELECT id FROM ai_providers WHERE id=$1 FOR UPDATE", [approved.id]);
			const before = a.requests.filter((request) => request.roles).length;
			let arrived!: () => void;
			let release!: () => void;
			const entered = new Promise<void>((resolve) => {
				arrived = resolve;
			});
			const held = new Promise<void>((resolve) => {
				release = resolve;
			});
			a.hold(async () => {
				arrived();
				await held;
			});
			const pending = client()
				.career.suggestTargetRoles(input(approved))
				.then(
					(value) => ({ value, code: null }),
					(error) => ({ value: null, code: error.code }),
				);
			let mutation: Promise<unknown> | undefined;
			try {
				await vi.waitFor(async () => {
					const blocked = await admin.query(
						"SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'select %from \"ai_providers\"%for share%' AND pid <> pg_backend_pid()",
					);
					expect(blocked.rows[0]?.count).toBeGreaterThan(0);
				});
				let committed = false;
				mutation = careerService.updateFact(user.id, { id: "shared", status: "excluded" }).then(() => {
					committed = true;
				});
				await vi.waitFor(async () => {
					const blocked = await admin.query(
						"SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'select %from \"user\"%for no key update%' AND pid <> pg_backend_pid()",
					);
					expect(blocked.rows[0]?.count).toBeGreaterThan(0);
				});
				expect(committed).toBe(false);
				expect(a.requests.filter((request) => request.roles)).toHaveLength(before);
				await lock.query("COMMIT");
				await entered;
				await mutation;
				expect(committed).toBe(true);
				release();
				expect((await pending).code).toBe("CONFLICT");
			} finally {
				release();
				a.hold(async () => {});
				await lock.query("ROLLBACK");
				lock.release();
				await mutation;
				await pending;
			}
		}));

	it("keeps the captured approved recipient when configuration changes during context preparation", () =>
		run(async () => {
			const disclosed = await create();
			await db
				.insert(tables.resume)
				.values({ id: "selected", userId: user.id, name: "Synthetic", slug: "selected", data: sampleResumeData });
			const lock = await pool.connect();
			await lock.query("BEGIN");
			await lock.query("LOCK TABLE resume IN ACCESS EXCLUSIVE MODE");
			const before = a.requests.length;
			const beforeB = b.requests.length;
			const pending = client().career.suggestTargetRoles({ ...input(disclosed), resumeId: "selected" });
			try {
				await vi.waitFor(async () => {
					const blocked = await admin.query(
						"SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'select %from \"resume\"%' AND pid <> pg_backend_pid()",
					);
					expect(blocked.rows[0]?.count).toBeGreaterThan(0);
				});
				await client().providers.update({
					id: disclosed.id,
					model: "model-b",
					baseURL: b.baseURL,
					apiKey: "synthetic-key-b",
				});
				await client().providers.test({ id: disclosed.id });
				expect(a.requests.length).toBe(before);
				await lock.query("COMMIT");
				await expect(pending).resolves.toMatchObject({ suggestions: [{ role: "Engineer" }] });
				expect(a.requests.at(-1)).toMatchObject({
					body: { model: "model-a" },
					authorization: "Bearer synthetic-key-a",
					roles: true,
				});
				expect(b.requests.slice(beforeB).filter((request) => request.roles)).toEqual([]);
			} finally {
				await lock.query("ROLLBACK");
				lock.release();
				await pending;
			}
		}));
	it("does not repeat a revocable role prompt after a 503 Retry-After response", () =>
		run(async () => {
			const approved = await create();
			const before = a.requests.filter((request) => request.roles).length;
			a.rejectNext();
			let revoked = false;
			a.hold(async () => {
				if (revoked) return;
				await run(async () => {
					await careerService.updateFact(user.id, { id: "shared", status: "excluded" });
				});
				revoked = true;
			});
			try {
				const error = await client()
					.career.suggestTargetRoles(input(approved))
					.then(
						() => null,
						(cause: unknown) => cause,
					);
				expect(revoked).toBe(true);
				expect(a.requests.filter((request) => request.roles)).toHaveLength(before + 1);
				expect(error).toMatchObject({ code: "BAD_GATEWAY" });
			} finally {
				a.hold(async () => {});
			}
		}));

	it("keeps the SDK retry default for existing generateJson callers", () =>
		run(async () => {
			const approved = await create();
			const provider = await aiProvidersService.getRunnableById({ id: approved.id, userId: user.id });
			const model = getModel(provider);
			const before = a.requests.filter((request) => request.roles).length;
			a.rejectNext();
			const result = await generateJson(
				model,
				{
					prompt:
						"Suggest up to five plausible target job titles; synthetic transport control with no personal context.",
				},
				z.object({ suggestions: z.array(z.unknown()) }),
			);
			expect(result.suggestions).toHaveLength(1);
			expect(a.requests.filter((request) => request.roles)).toHaveLength(before + 2);
		}));
});
