// Runs the shipped copy-for-job caller against a fake server; only the network client is replaced.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const serverRequire = createRequire(new URL("../../server/package.json", import.meta.url));
const { transformSync } = createRequire(serverRequire.resolve("tsx"))("esbuild");

function load(path, mocks) {
	const module = { exports: {} };
	const code = transformSync(readFileSync(new URL(path, import.meta.url), "utf8"), {
		loader: "ts",
		format: "cjs",
	}).code;
	new Function("require", "module", "exports", code)(
		(name) => {
			assert.ok(name in mocks, "Missing boundary: " + name);
			return mocks[name];
		},
		module,
		module.exports,
	);
	return module.exports;
}

const strings = load("../../../packages/utils/src/string.ts", { uuid: { v7: randomUUID } });

/** A server that records each call; `copy` decides what copyForJob does (a current server returns the ID it was sent). */
function fakeServer({ copy }) {
	const calls = [];
	const client = {
		documents: {
			copyForJob: async (input) => (calls.push(["copyForJob", input]), copy(input)),
			linkApplication: async (input) => void calls.push(["linkApplication", input]),
		},
		applications: { create: async (input) => (calls.push(["create", input]), "job-old-server") },
	};
	const { copyForJob } = load("../src/features/documents/copy-for-job.ts", {
		"@/api/client": { client },
		"@reactive-resume/utils/string": strings,
	});
	return { calls, copyForJob, names: () => calls.map(([name]) => name) };
}

const signal = new AbortController().signal;
const job = { company: "Fieldnote", role: "Designer" };
const sentIds = (server) => server.calls.filter(([name]) => name === "copyForJob").map(([, sent]) => sent.newId);

test("saves the job with its copy in one request on a current server", async () => {
	const server = fakeServer({ copy: (input) => input.newId });
	const id = await server.copyForJob({ resumeId: "base", application: job }, signal);

	assert.deepEqual(server.calls, [["copyForJob", { resumeId: "base", application: job, newId: id }]]);
});

test("a lost response or a refused request never saves the job a second way, and the retry sends the same ID", async () => {
	const refusals = [
		new TypeError("Network request failed"),
		Object.assign(new Error("This ID is already in use."), { code: "CONFLICT" }),
		// A current server whose copy's job was deleted since refuses the retry; it never sends a copy without its job.
		Object.assign(new Error("The job saved with this copy has since been deleted or unlinked."), { code: "CONFLICT" }),
	];
	for (const [index, failure] of refusals.entries()) {
		let attempts = 0;
		const server = fakeServer({ copy: (input) => (attempts++ === 0 ? Promise.reject(failure) : input.newId) });
		const input = { resumeId: `base-${index}`, application: job };

		await assert.rejects(server.copyForJob(input, signal), failure);
		assert.deepEqual(server.names(), ["copyForJob"]);
		const id = await server.copyForJob(input, signal);

		const [first, second] = sentIds(server);
		assert.equal(first, second);
		assert.equal(id, first);
		assert.ok(!server.names().includes("create"));
	}
});

test("only a server from before saving the job with its copy, which ignores the ID, gets the old two-step save", async () => {
	const server = fakeServer({ copy: () => "copy-old-server" });
	const id = await server.copyForJob({ resumeId: "base-old", application: job }, signal);

	assert.equal(id, "copy-old-server");
	assert.deepEqual(server.calls.slice(1), [
		["create", { ...job, resumeId: "copy-old-server" }],
		["linkApplication", { type: "resume", id: "copy-old-server", applicationId: "job-old-server" }],
	]);
});

test("a copy for an existing job or no job sends no new job, whatever the server", async () => {
	for (const copy of [(input) => input.newId, () => "copy-old-server"]) {
		const server = fakeServer({ copy });
		await server.copyForJob({ resumeId: "base-existing", applicationId: "job-9" }, signal);

		assert.deepEqual(server.names(), ["copyForJob"]);
	}
});

test("a settled request starts a new one with a new ID; the same job for another resume is another request", async () => {
	const server = fakeServer({ copy: (input) => input.newId });
	const input = { resumeId: "base-again", application: job };
	const first = await server.copyForJob(input, signal);
	const second = await server.copyForJob(input, signal);
	assert.notEqual(first, second);

	// Two pending requests for one job from different resumes (another account's, say) never share an ID.
	const failing = fakeServer({ copy: () => Promise.reject(new TypeError("Network request failed")) });
	await assert.rejects(failing.copyForJob({ resumeId: "account-a-base", application: job }, signal));
	await assert.rejects(failing.copyForJob({ resumeId: "account-b-base", application: job }, signal));
	const [a, b] = sentIds(failing);
	assert.notEqual(a, b);
});
