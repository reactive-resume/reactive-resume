import assert from "node:assert/strict";
import { test } from "node:test";
import * as harness from "./harness.mjs";

const load = () => harness.load("../src/features/assistant/handoff.ts");

test("Add to resume hands text only to the same account's chosen resume, once", () => {
	const { handToAssistant, takeAssistantHandoff } = load();
	handToAssistant("account-a", "resume-1", "Add this to my resume.");
	assert.equal(takeAssistantHandoff("account-b", "resume-1"), null, "another account never receives it");
	assert.equal(takeAssistantHandoff("account-a", "resume-2"), null, "another resume never receives it");
	assert.equal(takeAssistantHandoff(null, "resume-1"), null, "a signed-out screen never receives it");
	assert.equal(takeAssistantHandoff("account-a", "resume-1"), "Add this to my resume.");
	assert.equal(takeAssistantHandoff("account-a", "resume-1"), null, "it is taken once");
});
