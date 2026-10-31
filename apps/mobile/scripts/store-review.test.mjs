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
const provider = {
	id: "provider-a",
	recipientVersion: "a".repeat(64),
	label: "Fixture AI",
	provider: "openai",
	model: "fixture",
	baseURL: "https://ai.fixture.test/v1",
	enabled: true,
	testStatus: "success",
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
		fetch: async (url) => {
			calls.push(new URL(url).pathname);
			const value = url.includes("aiProviders/list")
				? [provider]
				: url.includes("webAccess/status")
					? { provider: "tavily", search: true }
					: url.includes("agent/threads/get")
						? { thread: { aiProviderId: provider.id } }
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
modules["./ai-consent"] = load("src/api/ai-consent.ts");
const { client, streamClient, rest } = load("src/api/client.ts");
async function waitForDialog() {
	for (let step = 0; step < 100 && !dialog; step++) await new Promise((resolve) => setImmediate(resolve));
	assert.ok(dialog, "sharing must require a dialog before transmission");
}
const sent = () => calls.filter((path) => !/aiProviders\/list|webAccess\/status|agent\/threads\/get/.test(path));
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
