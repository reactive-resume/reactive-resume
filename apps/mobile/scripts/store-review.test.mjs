// Run: node apps/mobile/scripts/store-review.test.mjs
// Real oRPC client/interceptors; native dialogs, credentials and remote HTTP are boundary fixtures.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const mobile = new URL("../", import.meta.url);
const requireMobile = createRequire(new URL("package.json", mobile));
const requireServer = createRequire(new URL("../../server/package.json", import.meta.url));
const { transformSync } = createRequire(requireServer.resolve("tsx"))("esbuild");
let account = "fixture-account";
let dialog;
let calls = [];
let available = true;
let headers = [];
const provider = {
	id: "provider-a",
	recipientVersion: "a".repeat(64),
	label: "Fixture AI",
	provider: "openai",
	model: "fixture",
	baseURL: "https://ai.fixture.test/v1",
	enabled: true,
	testStatus: "success",
	apiKeyFingerprint: "key-a",
};
const sessions = {
	getAccountScope: () => account,
	getServer: () => "https://server.fixture.test",
	getCredentials: async () => ({ scope: account, server: "https://server.fixture.test", accessToken: "fixture-only" }),
	recoverFromUnauthorized: async () => null,
	rejectCredentials: async () => {},
};
const modules = {
	"@/auth/session": sessions,
	"@lingui/core/macro": { t: (parts, ...values) => String.raw({ raw: parts }, ...values) },
	"react-native": {
		Alert: {
			alert: (title, message, buttons, options) => {
				dialog = { title, message, buttons, options };
			},
		},
	},
	"expo/fetch": {
		fetch: async (url, init) => {
			headers.push(new Headers(init?.headers));
			calls.push(new URL(url).pathname);
			const value = url.includes("aiProviders/list")
				? available
					? [provider]
					: []
				: url.includes("webAccess/status")
					? { provider: "tavily", search: true, revision: "web-a" }
					: url.includes("agent/threads/get")
						? { thread: { aiProviderId: provider.id } }
						: url.includes("ai/capabilities")
							? { explicitNoAi: true, recipientApproval: 1 }
							: { id: "result" };
			return new Response(JSON.stringify({ json: value }), { headers: { "content-type": "application/json" } });
		},
	},
};
function load(path) {
	const filename = fileURLToPath(new URL(path, mobile));
	const code = transformSync(readFileSync(filename, "utf8"), { loader: "ts", format: "cjs", target: "es2022" }).code;
	const module = { exports: {} };
	new Function("require", "module", "exports", code)(
		(name) => modules[name] ?? requireMobile(name),
		module,
		module.exports,
	);
	return module.exports;
}
modules.zod = createRequire(new URL("../../packages/ai/package.json", mobile))("zod");
modules["./defaults"] = load("../../packages/ai/src/defaults.ts");
modules["@reactive-resume/ai/types"] = load("../../packages/ai/src/types.ts");
modules["./ai-consent"] = load("src/api/ai-consent.ts");
const { client, streamClient, rest } = load("src/api/client.ts");
async function waitForDialog() {
	for (let step = 0; step < 100 && !dialog; step++) await new Promise((resolve) => setImmediate(resolve));
	assert.ok(dialog, "sharing must require a dialog before transmission");
}
const sent = () =>
	calls.filter((path) => !/aiProviders\/list|webAccess\/status|agent\/threads\/get|ai\/capabilities/.test(path));
function reset() {
	calls = [];
	dialog = null;
	account = "fixture-account";
}

for (const request of [
	() => client.ai.parsePdf({ file: { name: "fictional.pdf", data: "AA==" } }),
	() => client.ai.atsReview({ text: "fictional" }),
	() => client.applications.ai.autofill({ jobDescription: "fictional" }),
	() => streamClient.coverLetters.draft({ id: "fictional" }),
	() =>
		client.career.suggestTargetRoles({
			providerId: provider.id,
			recipientVersion: provider.recipientVersion,
			resumeId: null,
			includeKnowledge: true,
		}),
	() => client.career.generate({ applicationId: "fictional", task: { task: "fit" } }),
	() => streamClient.agent.messages.send({ threadId: "fictional", message: { id: "m", role: "user", parts: [] } }),
	() =>
		client.agent.attachments.create({
			threadId: "fictional",
			filename: "fictional.txt",
			data: "AA==",
			mediaType: "text/plain",
		}),
	() => client.career.voice.speak({ providerId: provider.id, model: "fixture", text: "fictional" }),
	() => client.career.saveSchedule({ enabled: true }),
	() => {
		const body = new FormData();
		body.set("providerId", provider.id);
		body.set("model", "whisper-1");
		return rest("/career/voice/transcribe", { method: "POST", body });
	},
]) {
	reset();
	const result = request().then(
		() => null,
		(error) => error,
	);
	await waitForDialog();
	assert.deepEqual(sent(), [], "personal data must not leave before affirmative permission");
	assert.match(dialog.message, /ai.fixture.test/);
	dialog.buttons[0].onPress();
	assert.equal((await result).name, "AbortError");
	assert.deepEqual(sent(), [], "declining must prevent transmission");
}

reset();
let result = client.ai.parsePdf({}).then(
	() => null,
	(error) => error,
);
await waitForDialog();
dialog.buttons[1].onPress();
assert.equal(await result, null);
assert.deepEqual(sent(), ["/api/rpc/ai/parsePdf"]);
dialog = null;
result = client.ai.parsePdf({}).then(
	() => null,
	(error) => error,
);
await waitForDialog();
account = "another-account";
dialog.buttons[1].onPress();
assert.match((await result).message, /account changed/);
assert.equal(sent().length, 1, "approval cannot transmit under a different account");

reset();
const controller = new AbortController();
result = client.ai.parsePdf({}, { signal: controller.signal }).then(
	() => null,
	(error) => error,
);
await waitForDialog();
controller.abort();
dialog.buttons[1].onPress();
assert.equal((await result).name, "AbortError");
assert.deepEqual(sent(), []);

reset();
result = client.career.saveSchedule({ kind: "discovery", enabled: true, query: "Platform engineer" }).then(
	() => null,
	(error) => error,
);
await waitForDialog();
assert.equal(
	calls.some((path) => path.includes("aiProviders")),
	false,
	"manual discovery must never require an AI connection",
);
assert.match(dialog.message, /Only the search query/);
assert.match(dialog.message, /tavily/);
assert.match(dialog.message, /Found posting links are read by Reactive Resume/);
assert.match(dialog.message, /links.*tavily[\s\S]*reader may charge/);
assert.deepEqual(sent(), []);
dialog.buttons[1].onPress();
assert.equal(await result, null);
assert.deepEqual(sent(), ["/api/rpc/career/saveSchedule"]);
reset();
result = client.applications.ai.searchPostings({ query: "Platform engineer" }).then(
	() => null,
	(error) => error,
);
await waitForDialog();
assert.equal(
	calls.some((path) => path.includes("aiProviders")),
	false,
	"manual search requires only web search",
);
assert.doesNotMatch(dialog.message, /Found posting links/);
dialog.buttons[1].onPress();
assert.equal(await result, null);
assert.deepEqual(sent(), ["/api/rpc/applications/ai/searchPostings"]);
reset();
await client.career.saveSchedule({ kind: "follow-up", enabled: true });
assert.equal(dialog, null, "local follow-up reminders need no AI sharing");
assert.deepEqual(sent(), ["/api/rpc/career/saveSchedule"]);

reset();
await client.ai.reportContent({ source: "other", reason: "other", content: "fictional unsafe content" });
assert.equal(dialog, null, "a safety report must not require AI-provider consent");
assert.deepEqual(sent(), ["/api/rpc/ai/reportContent"]);
console.log(
	"PASS: eleven AI entry points blocked before consent and on decline; acceptance, identity change, cancellation, and reporting exercised through real API client.",
);

// New suggestion requests carry the exact configuration shown in the screen.
reset();
let stale = await client.career
	.suggestTargetRoles({
		providerId: provider.id,
		recipientVersion: "b".repeat(64),
		resumeId: null,
		includeKnowledge: true,
	})
	.catch((error) => error);
assert.match(stale.message, /AI settings changed/);
assert.equal(dialog, null);
assert.deepEqual(sent(), []);
reset();
result = client.career
	.suggestTargetRoles({
		providerId: provider.id,
		recipientVersion: provider.recipientVersion,
		resumeId: null,
		includeKnowledge: true,
	})
	.catch((error) => error);
await waitForDialog();
assert.match(dialog.message, /fixture/);
provider.recipientVersion = "b".repeat(64); // Same displayed provider/model/origin, replaced credential.
dialog.buttons[1].onPress();
assert.match((await result).message, /AI settings changed/);
assert.deepEqual(sent(), []);
reset();
result = client.career
	.suggestTargetRoles({
		providerId: provider.id,
		recipientVersion: provider.recipientVersion,
		resumeId: null,
		includeKnowledge: true,
	})
	.catch((error) => error);
await waitForDialog();
dialog.buttons[1].onPress();
await result;
assert.deepEqual(sent(), ["/api/rpc/career/suggestTargetRoles"]);
console.log("PASS native same-ID recipient revision cutoff before and during consent, unchanged approval transmitted");
for (const change of [
	{ apiKeyFingerprint: "key-b" },
	{ model: "changed-model" },
	{ baseURL: "https://other.fixture.test/v1" },
]) {
	reset();
	const previous = { ...provider };
	const result = client.ai.parsePdf({}).then(
		() => null,
		(error) => error,
	);
	await waitForDialog();
	Object.assign(provider, change, { recipientVersion: "c".repeat(64) });
	dialog.buttons[1].onPress();
	assert.match((await result).message, /settings changed/);
	assert.deepEqual(sent(), [], "same-ID configuration changes must not transmit stale consent");
	Object.assign(provider, previous);
}
console.log("PASS: changed native key/model/URL during consent prevents transmission.");

reset();
result = client.career.voice
	.speak({ providerId: provider.id, model: "tts-1", text: "Fictional text" })
	.catch((error) => error);
await waitForDialog();
assert.match(dialog.message, /tts-1/);
assert.match(dialog.message, /Only the text to read aloud/);
dialog.buttons[1].onPress();
await result;
assert.deepEqual(JSON.parse(headers.at(-1).get("x-ai-destination")).at(-1), { kind: "speech", model: "tts-1" });
reset();
available = false;
result = client.applications.ai.parsePosting({ input: "fictional manual posting" }).catch((error) => error);
await waitForDialog();
dialog.buttons[1].onPress();
await result;
assert.equal(headers.at(-1).get("x-ai-destination"), "none");
reset();
result = client.applications.ai.parsePosting({ input: "fictional manual posting" }).catch((error) => error);
await waitForDialog();
available = true;
dialog.buttons[1].onPress();
assert.match((await result).message, /settings changed/);
assert.deepEqual(sent(), []);
reset();
available = false;
assert.match(
	(await client.applications.ai.autofill({ jobDescription: "fictional" }).catch((error) => error)).message,
	/Choose a tested/,
);
assert.deepEqual(sent(), []);
assert.equal(dialog, null);
available = true;
console.log("PASS: native voice model/scope, explicit no-AI header, transition race and AI-only refusal.");

reset();
const form = new FormData();
form.set("providerId", provider.id);
form.set("model", "whisper-1");
form.set("audio", new Blob(["fictional recording"], { type: "audio/webm" }), "fictional.webm");
result = rest("/career/voice/transcribe", { method: "POST", body: form }).catch((error) => error);
await waitForDialog();
assert.match(dialog.message, /whisper-1/);
assert.match(dialog.message, /Only your recording/);
dialog.buttons[1].onPress();
await result;
assert.deepEqual(JSON.parse(headers.at(-1).get("x-ai-destination")).at(-1), {
	kind: "transcription",
	model: "whisper-1",
});
assert.deepEqual(sent(), ["/api/openapi/career/voice/transcribe"]);
console.log("PASS native multipart REST binds actual transcription kind/model and recording-only disclosure");

reset();
const canceledVoice = new AbortController();
result = rest("/career/voice/transcribe", { method: "POST", body: form, signal: canceledVoice.signal }).catch(
	(error) => error,
);
await waitForDialog();
canceledVoice.abort();
dialog.buttons[1].onPress();
await result;
assert.deepEqual(sent(), [], "leaving voice context while approval is queued cannot upload recording");
console.log("PASS canceled queued multipart approval makes zero REST uploads");

// Exercise the shipped interceptor, including callers that do not use the posting form.
let supportError = false;
let supportWait;
let releaseSupport;
const probeInputs = [];
modules["expo/fetch"].fetch = async (url, init) => {
	calls.push(new URL(url).pathname);
	if (url.includes("applications/findPosting")) {
		probeInputs.push(JSON.parse(new TextDecoder().decode(init.body)).json);
		if (supportWait) await supportWait;
		if (supportError) return new Response("NOT_FOUND", { status: 404 });
		return Response.json({ json: { application: null } });
	}
	return Response.json({ json: url.includes("aiProviders/list") ? [] : { id: "parsed" } });
};
const readWithoutAi = (options) =>
	client.applications.ai.parsePosting(
		{ input: `https://jobs.example.test/role?ref=${"a".repeat(2100)}`, useAI: false },
		options,
	);
reset();
await readWithoutAi();
assert.equal(dialog, null, "a confirmed no-AI read must not ask for AI consent");
assert.deepEqual(probeInputs, [{ sourceUrl: "" }], "support discovery must not reject long posting URLs");
assert.deepEqual(calls, ["/api/rpc/applications/findPosting", "/api/rpc/applications/ai/parsePosting"]);

reset();
supportError = true;
await assert.rejects(readWithoutAi(), /Reading without AI couldn't be confirmed/);
assert.deepEqual(calls, ["/api/rpc/applications/findPosting"], "an old server must never receive the parse");
supportError = false;

for (const cancel of [() => (account = "another-account"), (signal) => signal.abort()]) {
	reset();
	const pendingController = new AbortController();
	supportWait = new Promise((resolve) => (releaseSupport = resolve));
	const pending = readWithoutAi({ signal: pendingController.signal }).catch((error) => error);
	for (let step = 0; step < 100 && !calls.length; step++) await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(calls, ["/api/rpc/applications/findPosting"]);
	cancel(pendingController);
	releaseSupport();
	assert.ok((await pending) instanceof Error);
	assert.deepEqual(calls, ["/api/rpc/applications/findPosting"], "a departed operation must never parse");
	supportWait = undefined;
}
console.log("PASS no-AI posting reads through real client: no provider/consent, old server, long URL and cancellation");
