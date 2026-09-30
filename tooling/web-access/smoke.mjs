import assert from "node:assert/strict";

const provider = process.argv[2];
assert(
	["firecrawl", "tavily", "exa"].includes(provider),
	"Usage: node tooling/web-access/smoke.mjs firecrawl|tavily|exa",
);
assert(
	process.env.APP_URL && process.env.WEB_ACCESS_SMOKE_API_KEY,
	"Set APP_URL and WEB_ACCESS_SMOKE_API_KEY (an API key for a maintainer test account).",
);
const origin = new URL(process.env.APP_URL);
assert(["https:", "http:"].includes(origin.protocol), "APP_URL must use HTTP(S).");

async function request(path, method = "GET") {
	const response = await fetch(new URL(`/api/openapi/integrations/web-access${path}`, origin), {
		method,
		headers: { "x-api-key": process.env.WEB_ACCESS_SMOKE_API_KEY },
		signal: AbortSignal.timeout(30_000),
		redirect: "error",
	});
	assert(response.ok, `Web access ${method} failed (HTTP ${response.status}).`);
	return response.json();
}

const status = await request("");
assert.equal(
	status.provider,
	provider,
	"Select the expected provider in the test account or server configuration first.",
);
const result = await request("/test", "POST");
console.log(JSON.stringify({ provider, search: result.search, read: result.read }, null, 2));
assert(
	result.search.success && result.read.success,
	"Provider search or reading failed; no fallback is used by this probe.",
);
