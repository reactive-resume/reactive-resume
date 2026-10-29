import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const requireMobile = createRequire(new URL("../package.json", import.meta.url));
const requireServer = createRequire(new URL("../../server/package.json", import.meta.url));
const { transformSync } = createRequire(requireServer.resolve("tsx"))("esbuild");
const calls = [];
const modules = {
	"@lingui/core/macro": { t: (parts, ...values) => String.raw({ raw: parts }, ...values) },
	"@/api/client": { client: { coverLetters: { update: async (input) => calls.push(input) } } },
	"@reactive-resume/schema/cover-letter/data": {},
	"@reactive-resume/schema/resume/data": {},
	"@reactive-resume/schema/resume/dates": {},
};
const code = transformSync(readFileSync(new URL("../src/draft/adapters.ts", import.meta.url), "utf8"), {
	loader: "ts",
	format: "cjs",
	target: "es2022",
	sourcefile: fileURLToPath(new URL("../src/draft/adapters.ts", import.meta.url)),
}).code;
const module = { exports: {} };
new Function("require", "module", "exports", code)(
	(name) => modules[name] ?? requireMobile(name),
	module,
	module.exports,
);
const { letterAdapter } = module.exports;
const baseline = {
	id: "letter",
	revision: 1,
	senderLinked: false,
	style: {
		basics: {
			name: "Jordan",
			email: "jordan@example.test",
			phone: "",
			location: "Berlin",
			headline: "Engineer",
			customFields: [],
		},
		metadata: { template: "ditto" },
	},
};

test("native sender saves patch only changed contact fields and retain server-owned linking behavior", async () => {
	const edited = structuredClone(baseline);
	edited.style.basics.email = "letter@example.test";
	edited.style.basics.phone = "5550100";
	await letterAdapter.save(edited, baseline, "session", false, "fixture");
	assert.deepEqual(calls.pop(), {
		id: "letter",
		expectedRevision: 1,
		sessionId: "session",
		sender: { email: "letter@example.test", phone: "5550100" },
	});
	await letterAdapter.save(baseline, baseline, "session", false, "fixture");
	assert.equal("sender" in calls.pop(), false);
	// Relinking and history rebasing must not send the previous independent details back to the API.
	edited.senderLinked = true;
	await letterAdapter.save(edited, baseline, "session", false, "fixture");
	assert.deepEqual(calls.pop(), { id: "letter", expectedRevision: 1, sessionId: "session", senderLinked: true });
});

test("typing during unlink preserves fresh server sender fields and saves only the concurrent edit", async () => {
	const submitted = structuredClone(baseline);
	const current = structuredClone(submitted);
	current.style.basics.name = "Independent name";
	const saved = structuredClone(submitted);
	saved.revision = 2;
	saved.style.basics.email = "current-resume@example.test";
	saved.style.basics.location = "Updated city";
	saved.style.metadata.template = "onyx";

	const merged = letterAdapter.merge(saved, submitted, current);

	assert.equal(merged.style.basics.name, "Independent name");
	assert.equal(merged.style.basics.email, "current-resume@example.test");
	assert.equal(merged.style.basics.location, "Updated city");
	assert.equal(merged.style.metadata.template, "onyx");
	await letterAdapter.save(merged, saved, "session", false, "fixture");
	assert.deepEqual(calls.pop(), {
		id: "letter",
		expectedRevision: 2,
		sessionId: "session",
		sender: { name: "Independent name" },
	});
});
