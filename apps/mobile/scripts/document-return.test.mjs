import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const requireServer = createRequire(new URL("../../server/package.json", import.meta.url));
const { transformSync } = createRequire(requireServer.resolve("tsx"))("esbuild");
const code = transformSync(readFileSync(new URL("../src/routes.ts", import.meta.url), "utf8"), {
	loader: "ts",
	format: "cjs",
}).code;
const module = { exports: {} };
new Function("module", "exports", code)(module, module.exports);
const { routes } = module.exports;

test("native document links retain selected application and submitted version, including reserved characters", () => {
	assert.equal(routes.builder("shared", "page", "job /2"), "/builder/shared/page?applicationId=job%20%2F2");
	assert.equal(
		routes.history("shared", "sent /1", "job /2"),
		"/builder/shared/history?version=sent%20%2F1&applicationId=job%20%2F2",
	);
	assert.equal(
		routes.letter("letter", "write", "sent /1", "job /2"),
		"/letter/letter/write?version=sent%20%2F1&applicationId=job%20%2F2",
	);
	assert.equal(
		routes.letter("letter", "design", undefined, "job /2"),
		"/letter/letter/design?applicationId=job%20%2F2",
	);
	// Existing deep links stay byte-compatible for installed clients and saved bookmarks.
	assert.equal(routes.assistant("shared", "job /2"), "/builder/shared/assistant?applicationId=job%20%2F2");
	assert.equal(routes.builder("shared"), "/builder/shared/write");
	assert.equal(routes.letter("letter"), "/letter/letter/write");
	assert.equal(routes.history("shared", "sent"), "/builder/shared/history?version=sent");
});
