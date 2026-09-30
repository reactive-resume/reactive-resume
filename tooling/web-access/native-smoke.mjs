import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Opt-in against a test account with a tested AI connection and a non-personal sample resume.
// The run creates only its own conversation, which is removed in finally.
const providerName = process.argv[2];
assert(
	["openai", "anthropic", "gemini"].includes(providerName),
	"Usage: node tooling/web-access/native-smoke.mjs openai|anthropic|gemini",
);
const { APP_URL, AI_NATIVE_SMOKE_API_KEY, AI_NATIVE_SMOKE_PROVIDER_ID, AI_NATIVE_SMOKE_RESUME_ID } = process.env;
assert(
	APP_URL && AI_NATIVE_SMOKE_API_KEY && AI_NATIVE_SMOKE_PROVIDER_ID && AI_NATIVE_SMOKE_RESUME_ID,
	"Set APP_URL, AI_NATIVE_SMOKE_API_KEY, AI_NATIVE_SMOKE_PROVIDER_ID and AI_NATIVE_SMOKE_RESUME_ID for a test account/sample resume.",
);
const origin = new URL(APP_URL);
assert(["http:", "https:"].includes(origin.protocol), "APP_URL must use HTTP(S).");
const runSignal = AbortSignal.timeout(90_000);

async function request(path, method = "GET", body = undefined, signal = runSignal) {
	const response = await fetch(new URL(`/api/openapi${path}`, origin), {
		method,
		headers: {
			"x-api-key": AI_NATIVE_SMOKE_API_KEY,
			"content-type": "application/json",
		},
		...(body ? { body: JSON.stringify(body) } : {}),
		signal,
		redirect: "error",
	});
	assert(response.ok, `Native smoke ${method} failed (HTTP ${response.status}).`);
	return response;
}

const web = await (await request("/integrations/web-access")).json();
assert.equal(
	web.provider,
	null,
	"Native search smoke requires no external web connection on the server or test account.",
);
const providers = await (await request("/ai-providers")).json();
const provider = providers.find((item) => item.id === AI_NATIVE_SMOKE_PROVIDER_ID);
assert.equal(provider?.provider, providerName, "AI connection must match the selected provider.");
const thread = await (
	await request("/agent/threads", "POST", {
		resumeId: AI_NATIVE_SMOKE_RESUME_ID,
		aiProviderId: provider.id,
	})
).json();
let succeeded = false;
try {
	const response = await request("/agent/messages/send", "POST", {
		threadId: thread.id,
		context: { document: true, posting: false },
		message: {
			id: randomUUID(),
			role: "user",
			parts: [
				{
					type: "text",
					text: "Smoke test: call read_resume once. Then use native web search once to find the official Node.js releases page. Reply with one sentence and cite its source. Do not propose edits, read another page, or run any further search.",
				},
			],
		},
	});
	assert(response.body, "Native smoke response had no stream.");
	const reader = response.body.getReader();
	let bytes = 0;
	let pending = "";
	let visibleSteps = 0;
	const decoder = new TextDecoder();
	// Bound the stream even if a provider ignores the short-output instruction.
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		bytes += value.byteLength;
		assert(bytes <= 1_000_000, "Native smoke response exceeded 1 MB.");
		pending += decoder.decode(value, { stream: true }).replace(/\r/g, "");
		while (pending.includes("\n\n")) {
			const separator = pending.indexOf("\n\n");
			const frame = pending.slice(0, separator);
			pending = pending.slice(separator + 2);
			const data = frame
				.split("\n")
				.filter((line) => line.startsWith("data:"))
				.map((line) => line.slice(5).trim())
				.join("\n");
			if (!data || data === "[DONE]") continue;
			let chunk = JSON.parse(data);
			if (typeof chunk === "string") chunk = JSON.parse(chunk);
			chunk = chunk.json ?? chunk;
			if (chunk.type === "start-step") assert(++visibleSteps <= 4, "Native smoke exceeded four visible model steps.");
			assert(chunk.type !== "error", "Native smoke stream returned an error.");
		}
	}
	const history = await (await request(`/agent/threads/${encodeURIComponent(thread.id)}`)).json();
	const parts = history.messages.flatMap((message) => message.parts);
	assert(
		parts.some((part) => part.type === "tool-read_resume" && part.state === "output-available"),
		"Native/custom combination did not execute read_resume.",
	);
	assert(!parts.some((part) => part.type === "tool-search_web"), "External search ran during native smoke.");
	assert(
		parts.some((part) => part.type === "source-url" && part.url.startsWith("https://")),
		"Native search returned no source evidence.",
	);
	assert(!parts.some((part) => part.state === "output-error"), "Native smoke contains a failed tool.");
	const steps = parts.filter((part) => part.type === "step-start").length;
	assert(steps <= 4, "Native smoke exceeded four visible model steps.");
	succeeded = true;
	console.log(
		JSON.stringify({
			provider: providerName,
			model: provider.model,
			documentTool: "passed",
			nativeSources: "passed",
			steps,
		}),
	);
} finally {
	// Client stream abort alone does not stop the resumable server run.
	try {
		if (!succeeded) await request("/agent/messages/stop", "POST", { threadId: thread.id }, AbortSignal.timeout(10_000));
	} finally {
		await request(`/agent/threads/${encodeURIComponent(thread.id)}`, "DELETE", undefined, AbortSignal.timeout(10_000));
	}
}
