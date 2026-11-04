// Runs the shipped copy-for-job caller against a fake server; only the network client is replaced.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { load } from "./harness.mjs";

const strings = load("../../../packages/utils/src/string.ts", { uuid: { v7: randomUUID } });

/** A server that records each call; `copy` decides what copyForJob does (a current server returns the ID it was sent). */
function fakeServer({ copy, create = () => "job-old-server", scope = () => "fixture-account" }) {
	const calls = [];
	const client = {
		documents: {
			copyForJob: async (input) => (calls.push(["copyForJob", input]), copy(input)),
			linkApplication: async (input) => void calls.push(["linkApplication", input]),
		},
		applications: { create: async (input) => (calls.push(["create", input]), create(input)) },
	};
	const { copyForJob } = load("../src/features/documents/copy-for-job.ts", {
		"@/api/client": {
			client,
			SessionChangedError: class SessionChangedError extends Error {
				constructor() {
					super("Session changed");
					this.name = "SessionChangedError";
				}
			},
		},
		"@/auth/session": { getAccountScope: scope },
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

// The caller never inspects the failure, so a server refusal (CONFLICT) takes this same path.
test("a lost response never saves the job a second way, and the retry sends the same ID", async () => {
	const failure = new TypeError("Network request failed");
	let attempts = 0;
	const server = fakeServer({ copy: (input) => (attempts++ === 0 ? Promise.reject(failure) : input.newId) });
	const input = { resumeId: "base-lost", application: job };

	await assert.rejects(server.copyForJob(input, signal), failure);
	assert.deepEqual(server.names(), ["copyForJob"]);
	const id = await server.copyForJob(input, signal);

	const [first, second] = sentIds(server);
	assert.equal(first, second);
	assert.equal(id, first);
	assert.ok(!server.names().includes("create"));
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

test("account change after copy cannot save or link a job through the older-server fallback", async () => {
	let scope = "account-A";
	const server = fakeServer({
		scope: () => scope,
		copy: () => {
			scope = "account-B";
			return "older-copy";
		},
	});
	await assert.rejects(server.copyForJob({ resumeId: "private-base", application: job }, signal), {
		name: "SessionChangedError",
	});
	assert.deepEqual(server.names(), ["copyForJob"]);
});

test("account change after fallback job creation cannot link the old copy", async () => {
	let scope = "account-A";
	const server = fakeServer({
		scope: () => scope,
		copy: () => "older-copy",
		create: () => {
			scope = "account-B";
			return "old-job";
		},
	});
	await assert.rejects(server.copyForJob({ resumeId: "private-base", application: job }, signal), {
		name: "SessionChangedError",
	});
	assert.deepEqual(server.names(), ["copyForJob", "create"]);
});

test("an aborted or signed-out copy dispatches nothing", async () => {
	const cancelled = new AbortController();
	cancelled.abort();
	const server = fakeServer({ copy: (input) => input.newId });
	await assert.rejects(server.copyForJob({ resumeId: "private-base" }, cancelled.signal), { name: "AbortError" });
	assert.deepEqual(server.names(), []);
	const signedOut = fakeServer({ copy: (input) => input.newId, scope: () => null });
	await assert.rejects(signedOut.copyForJob({ resumeId: "private-base" }, signal), { name: "SessionChangedError" });
	assert.deepEqual(signedOut.names(), []);
});

test("the save form's lost copy reply is retried by the recovery picker under the same ID", async () => {
	let attempts = 0;
	const server = fakeServer({
		copy: (input) => (attempts++ === 0 ? Promise.reject(new TypeError("Lost reply")) : input.newId),
	});
	await assert.rejects(
		server.copyForJob({ resumeId: "base-recovery", applicationId: "saved-job", name: "Base — Job" }, signal),
	);
	const id = await server.copyForJob(
		{ resumeId: "base-recovery", name: "Base — Job", applicationId: "saved-job" },
		signal,
	);
	assert.deepEqual(sentIds(server), [id, id]);
});

test("identical pending copy inputs from different accounts never share a create ID", async () => {
	let scope = "account-A";
	const server = fakeServer({ scope: () => scope, copy: () => Promise.reject(new TypeError("Lost reply")) });
	const input = { resumeId: "imported-id", applicationId: "job-id", name: "Copy" };
	await assert.rejects(server.copyForJob(input, signal));
	scope = "account-B";
	await assert.rejects(server.copyForJob(input, signal));
	const [a, b] = sentIds(server);
	assert.notEqual(a, b);
});
