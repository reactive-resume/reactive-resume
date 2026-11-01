import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const serverRequire = createRequire(new URL("../../server/package.json", import.meta.url));
const { transformSync } = createRequire(serverRequire.resolve("tsx"))("esbuild");
const code = transformSync(readFileSync(new URL("../src/features/assistant/handoff.ts", import.meta.url), "utf8"), {
	loader: "ts",
	format: "cjs",
}).code;

function load() {
	const module = { exports: {} };
	new Function("module", "exports", code)(module, module.exports);
	return module.exports;
}

test("Add to resume hands text only to the same account's chosen resume, once", () => {
	const { handToAssistant, takeAssistantHandoff } = load();
	handToAssistant("account-a", "resume-1", "Add this to my resume.");
	assert.equal(takeAssistantHandoff("account-b", "resume-1"), null, "another account never receives it");
	assert.equal(takeAssistantHandoff("account-a", "resume-2"), null, "another resume never receives it");
	assert.equal(takeAssistantHandoff(null, "resume-1"), null, "a signed-out screen never receives it");
	assert.equal(takeAssistantHandoff("account-a", "resume-1"), "Add this to my resume.");
	assert.equal(takeAssistantHandoff("account-a", "resume-1"), null, "it is taken once");
});
