// Run only against an installation you control. Creates and deletes its own account/files.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = new URL(process.env.SMOKE_URL).origin;
let cookie = "";
function request(path, init = {}, authenticated = true) {
	const url = new URL(path, base);
	const headers = new Headers(init.headers);
	if (url.origin === base && authenticated) {
		headers.set("origin", base);
		headers.set("cookie", cookie);
	}
	return fetch(url, { ...init, headers, signal: AbortSignal.timeout(120_000) });
}
async function checked(response) {
	assert.equal(response.ok, true, `HTTP ${response.status}: ${(await response.clone().text()).slice(0, 300)}`);
	return response;
}
async function rpc(path, input, staged = false) {
	const url = `/api/rpc/${path}`;
	let body = input instanceof FormData ? input : JSON.stringify({ json: input });
	const headers = input instanceof FormData ? new Headers() : new Headers({ "content-type": "application/json" });
	let stage;
	if (staged) {
		const wire = new Request(new URL(url, base), { method: "POST", headers, body });
		const bytes = await wire.arrayBuffer();
		const prepared = await checked(
			await request("/api/storage/stage", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ path: url, contentType: wire.headers.get("content-type"), size: bytes.byteLength }),
			}),
		);
		stage = await prepared.json();
		await checked(
			await request(
				stage.url,
				{ method: "PUT", headers: { "content-type": "application/octet-stream" }, body: bytes },
				false,
			),
		);
		headers.set("x-resume-staged-body", stage.id);
		body = undefined;
	}
	const response = await checked(await request(url, { method: "POST", headers, body }));
	if (stage)
		assert.equal((await request(url, { method: "POST", headers })).status, 410, "staged requests must not replay");
	if (response.status === 204) return;
	return (await response.json()).json;
}

const health = await (await checked(await request("/api/health"))).json();
assert.equal(health.status, "healthy");
for (const path of ["/", "/auth/login", "/robots.txt", "/sitemap.xml", "/.well-known/oauth-protected-resource"]) {
	await checked(await request(path));
}
assert.equal((await request("/assets/does-not-exist.js")).status, 404);
const staged = (await (await checked(await request("/api/storage/stage"))).json()).enabled;
if (staged) assert.equal((await request("/api/storage/stage", { method: "POST", body: "{}" }, false)).status, 401);
const username = `smoke${Date.now()}`;
const signup = await checked(
	await request("/api/auth/sign-up/email", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			name: "Deployment Smoke",
			username,
			email: `${username}@example.com`,
			password: `${randomUUID()}Aa1!`,
		}),
	}),
);
cookie = signup.headers
	.getSetCookie()
	.map((value) => value.split(";")[0])
	.join("; ");
assert.ok(cookie, "signup session");
try {
	const id = await rpc("resume/create", {
		name: "Deployment Smoke",
		slug: "deployment-smoke",
		tags: [],
		withSampleData: true,
	});
	assert.equal((await rpc("resume/getById", { id })).name, "Deployment Smoke");
	await rpc("resume/update", { id, isPublic: true });
	const publicPage = await checked(await request(`/${username}/deployment-smoke`, {}, false));
	assert.ok((await publicPage.text()).includes(`${base}/${username}/deployment-smoke`));
	const pdf = await checked(await request(`/api/resumes/${username}/deployment-smoke/pdf`, {}, false));
	assert.equal(
		Buffer.from(await pdf.arrayBuffer())
			.subarray(0, 5)
			.toString(),
		"%PDF-",
	);
	const file = new File([new Uint8Array(10 * 1024 * 1024).fill(97)], "maximum.txt", { type: "text/plain" });
	const form = new FormData();
	form.set("data", JSON.stringify({ json: {}, maps: [[]] }));
	form.set("0", file);
	const uploaded = await rpc("storage/uploadFile", form, staged);
	const download = await checked(await request(uploaded.url, {}, false));
	assert.equal((await download.arrayBuffer()).byteLength, file.size);
	await rpc("storage/deleteFile", { filename: uploaded.path });
	console.log("Pages, auth, resume CRUD, public PDF, 10 MiB upload/download: passed");
	if (staged && process.env.SMOKE_AI_BASE_URL && process.env.SMOKE_AI_API_KEY) {
		const provider = await rpc("aiProviders/create", {
			label: "Smoke provider",
			provider: "openai-compatible",
			model: "smoke-model",
			baseURL: process.env.SMOKE_AI_BASE_URL,
			apiKey: process.env.SMOKE_AI_API_KEY,
		});
		await rpc("aiProviders/test", { id: provider.id });
		const thread = await rpc("agent/threads/create", { aiProviderId: provider.id });
		const attachment = await rpc(
			"agent/attachments/create",
			{
				threadId: thread.id,
				filename: "maximum.txt",
				mediaType: "text/plain",
				data: Buffer.alloc(25 * 1024 * 1024, 97).toString("base64"),
			},
			true,
		);
		assert.equal(attachment.size, 25 * 1024 * 1024);
		await rpc("agent/attachments/delete", { id: attachment.id });
		console.log("25 MiB private attachment: passed");
	}
} finally {
	await rpc("auth/deleteAccount");
	console.log("Smoke account and files removed");
}
