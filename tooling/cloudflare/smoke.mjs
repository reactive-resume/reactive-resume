import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { createTestHarness, experimental_readRawConfig } from "wrangler";

// Tests the deployable bundle, not a Node mock of Workers. Only a new local database is migrated.
const root = resolve(import.meta.dirname, "../..");
const adminUrl = new URL(
	process.env.CLOUDFLARE_TEST_DATABASE_ADMIN_URL ?? "postgresql://postgres:postgres@localhost:5432/postgres",
);
assert(
	["localhost", "127.0.0.1", "[::1]"].includes(adminUrl.hostname),
	"Smoke tests require local disposable PostgreSQL",
);
const databaseName = `cloudflare_smoke_${randomBytes(8).toString("hex")}`;
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${databaseName}`;
const admin = new Pool({ connectionString: adminUrl.href });
const temporary = await mkdtemp(resolve(tmpdir(), "reactive-resume-cloudflare-"));
let harness;
let created = false;
let ai;
const origin = "http://localhost";
try {
	await admin.query(`CREATE DATABASE "${databaseName}"`);
	created = true;
	execFileSync("pnpm", ["--filter", "@reactive-resume/db", "db:migrate"], {
		cwd: root,
		env: { ...process.env, DATABASE_URL: databaseUrl.href, CLOUDFLARE: "0" },
		stdio: "pipe",
	});
	const { rawConfig: config } = experimental_readRawConfig({ config: resolve(root, "wrangler.jsonc") });
	config.main = resolve(root, config.main);
	config.assets.directory = resolve(root, config.assets.directory);
	config.hyperdrive[0].localConnectionString = databaseUrl.href;
	config.vars.APP_URL = origin;
	config.vars.AUTH_SECRET = randomBytes(32).toString("hex");
	config.vars.ENCRYPTION_SECRET = randomBytes(32).toString("hex");
	// Minimal external provider boundary; the real AI SDK and Worker stream stay under test.
	const provider = createServer((request, response) => {
		let body = "";
		request.on("data", (chunk) => {
			body += chunk;
		});
		request.on("end", () => {
			void (async () => {
				const slow = body.includes("slowly");
				response.writeHead(200, { "content-type": "text/event-stream" });
				const chunk = (delta, finish = null) =>
					response.write(
						`data: ${JSON.stringify({ id: "smoke", object: "chat.completion.chunk", created: 0, model: "stub", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
					);
				for (const word of slow ? Array.from({ length: 60 }, (_, i) => `word${i} `) : ["You left the document out."]) {
					if (response.destroyed) return;
					chunk({ content: word });
					if (slow) await setTimeout(150);
				}
				chunk({}, "stop");
				response.end("data: [DONE]\n\n");
			})();
		});
	});
	await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
	ai = {
		baseURL: `http://127.0.0.1:${provider.address().port}/v1`,
		close: () =>
			new Promise((resolve) => {
				provider.closeAllConnections();
				provider.close(resolve);
			}),
	};
	Object.assign(config.vars, {
		AI_PROVIDER: "openai-compatible",
		AI_MODEL: "stub",
		AI_API_KEY: "local-smoke-key",
		AI_BASE_URL: ai.baseURL,
		FLAG_ALLOW_UNSAFE_AI_BASE_URL: "true",
	});
	const configPath = resolve(temporary, "wrangler.json");
	await writeFile(configPath, JSON.stringify(config));
	process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = "false";
	harness = createTestHarness({ root, workers: [{ configPath }] });
	await harness.listen();
	const worker = harness.getWorker();
	const request = (path, options = {}) => harness.fetch(`${origin}${path}`, options);
	let response = await request("/api/health");
	assert.equal(response.status, 200);
	assert.equal((await response.json()).storage.type, "r2");
	response = await request("/");
	assert.equal(response.status, 200);
	assert.match(await response.text(), /rel="canonical"/);
	assert.equal((await request("/_prerender/home/en-US.html")).status, 404);
	assert.equal((await request("/missing.js")).status, 404);
	assert.match((await request("/dashboard")).headers.get("x-robots-tag"), /noindex/);
	response = await request("/api/auth/sign-up/email", {
		method: "POST",
		headers: { "content-type": "application/json", origin },
		body: JSON.stringify({
			name: "Cloudflare smoke",
			email: "worker@example.invalid",
			username: "workersmoke",
			displayUsername: "workersmoke",
			password: "smoke-password-123",
		}),
	});
	assert.equal(response.status, 200, await response.clone().text());
	const cookie = response.headers
		.getSetCookie()
		.map((entry) => entry.split(";")[0])
		.join("; ");
	assert(cookie);
	const user = (await response.json()).user;
	const require = createRequire(resolve(root, "apps/server/package.json"));
	const { createORPCClient } = await import(pathToFileURL(require.resolve("@orpc/client")).href);
	const { RPCLink } = await import(pathToFileURL(require.resolve("@orpc/client/fetch")).href);
	const client = createORPCClient(
		new RPCLink({
			url: `${origin}/api/rpc`,
			headers: { cookie, origin },
			fetch: async (input, init) => {
				const outgoing = new Request(input, init);
				return harness.fetch(outgoing.url, {
					method: outgoing.method,
					headers: Object.fromEntries(outgoing.headers),
					signal: outgoing.signal,
					...(!["GET", "HEAD"].includes(outgoing.method) ? { body: await outgoing.arrayBuffer() } : {}),
				});
			},
		}),
	);
	const id = await client.resume.create({ name: "Worker test", tags: [], withSampleData: true });
	const png = await readFile(resolve(root, "apps/web/public/pwa-64x64.png"));
	const upload = await client.storage.uploadFile(new File([png], "picture.png", { type: "image/png" }));
	assert.equal(upload.contentType, "image/png");
	response = await request(new URL(upload.url).pathname);
	assert.equal(response.status, 200);
	assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
	const resume = await client.resume.getById({ id });
	resume.data.picture.url = upload.url;
	resume.data.picture.hidden = false;
	await client.resume.update({ id, isPublic: true, data: resume.data });
	const streamAbort = new AbortController();
	const events = await client.resume.updates.subscribe({ id }, { signal: streamAbort.signal });
	assert.equal((await events.next()).value.mutation, "sync");
	const nextEvent = events.next();
	// The first event is the initial DB snapshot; allow the following subscription handshake to finish.
	await setTimeout(100);
	await client.resume.patch({ id, operations: [{ op: "replace", path: "/basics/name", value: "Cloudflare Native" }] });
	const event = await Promise.race([
		nextEvent,
		setTimeout(10_000).then(() => {
			throw new Error("Resume update stream timed out");
		}),
	]);
	assert.equal(event.value.mutation, "patch");
	assert.equal(event.value.resumeId, id);
	streamAbort.abort();
	await events.return();
	response = await request(`/api/resumes/workersmoke/${resume.slug}/pdf`);
	assert.equal(response.status, 200, await response.clone().text());
	const pdf = Buffer.from(await response.arrayBuffer());
	assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
	assert(pdf.includes(Buffer.from("/Subtype /Image")), "Uploaded picture must be embedded in PDF");
	assert.equal((await client.resume.getById({ id })).data.basics.name, "Cloudflare Native");
	const thread = await client.agent.threads.start({ resumeId: id });
	const send = (text, signal) =>
		client.agent.messages.send(
			{
				threadId: thread.id,
				message: { id: randomBytes(12).toString("hex"), role: "user", parts: [{ type: "text", text }] },
				context: { document: false, posting: false },
			},
			{ signal },
		);
	const reply = await send("Reply without the document", AbortSignal.timeout(15_000));
	let transcript = "";
	for await (const chunk of reply) transcript += chunk;
	assert.match(transcript, /text-delta/);
	let conversation = await client.agent.threads.get({ id: thread.id });
	assert.equal(conversation.thread.activeRunId, null);
	assert(
		conversation.messages.some(
			(message) =>
				message.role === "assistant" &&
				message.parts.some((part) => part.type === "text" && part.text.includes("left the document out")),
		),
	);
	const replyAbort = new AbortController();
	const slow = await send("Reply slowly", replyAbort.signal);
	for await (const chunk of slow) {
		if (chunk.includes("text-delta")) break;
	}
	replyAbort.abort();
	await client.agent.messages.stop({ threadId: thread.id });
	await slow.return();
	for (let attempt = 0; attempt < 50; attempt++) {
		conversation = await client.agent.threads.get({ id: thread.id });
		if (!conversation.thread.activeRunId) break;
		await setTimeout(100);
	}
	assert.equal(conversation.thread.activeRunId, null, "Stopping an assistant must release its claim");
	assert(
		conversation.messages.some(
			(message) =>
				message.role === "assistant" &&
				message.parts.some((part) => part.type === "text" && part.text.includes("word0")),
		),
		"Stopped assistant text must persist",
	);
	// Private R2 attachments must remain behind the owning session, even with spoofed forwarding headers.
	const bindings = await worker.getEnv();
	const attachment = `uploads/${user.id}/pictures/smoke.pdf`;
	await bindings.BUCKET.put(`production/${attachment}`, "private attachment");
	assert.equal((await request(`/${attachment}`, { headers: { "x-real-ip": "8.8.8.8" } })).status, 404);
	response = await request(`/${attachment}`, { headers: { cookie } });
	assert.equal(response.status, 200);
	assert.equal(await response.text(), "private attachment");
	await client.storage.deleteFile({ filename: upload.path });
	assert.equal((await request(new URL(upload.url).pathname)).status, 404);
	// Concurrent limits must remain atomic, and persisted state must survive eviction.
	const counter = bindings.COORDINATION.get(bindings.COORDINATION.idFromName("smoke-counter"));
	const consume = () =>
		counter
			.fetch("https://coordination/", {
				method: "POST",
				body: JSON.stringify({ operation: "consume", max: 5, window: 60_000 }),
			})
			.then((r) => r.json());
	assert.equal((await Promise.all(Array.from({ length: 20 }, consume))).filter((result) => result.allowed).length, 5);
	await worker.evictDurableObject("COORDINATION", { name: "smoke-counter" });
	assert.equal((await consume()).allowed, false);
	const state = bindings.COORDINATION.get(bindings.COORDINATION.idFromName("smoke-cancellation"));
	await state.fetch("https://coordination/", {
		method: "POST",
		body: JSON.stringify({ operation: "set", value: "stop", ttl: 100 }),
	});
	await setTimeout(150);
	assert.equal(
		await (
			await state.fetch("https://coordination/", { method: "POST", body: JSON.stringify({ operation: "get" }) })
		).json(),
		null,
	);
	console.log(
		"Cloudflare smoke passed: auth, transactions, R2 privacy, live updates, PDF pictures, assistant streaming/stop, atomic limits, expiry.",
	);
} catch (error) {
	for (const log of harness?.getLogs() ?? []) {
		if (["error", "warn"].includes(log.level)) console.error(log.message);
	}
	throw error;
} finally {
	await harness?.close();
	await ai?.close();
	if (created) await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
	await admin.end();
	await rm(temporary, { recursive: true, force: true });
}
