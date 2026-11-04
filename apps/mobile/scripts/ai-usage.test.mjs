import assert from "node:assert/strict";
import { test } from "node:test";
import { load, mobileRequire } from "./harness.mjs";
const { authorizeAiRequest } = load("../src/api/ai-consent.ts", {
	"@lingui/core/macro": { t: (parts) => parts.join("") },
	"@orpc/client": mobileRequire("@orpc/client"),
	"react-native": { Alert: { alert: () => assert.fail("History must not ask for AI sharing") } },
	"@reactive-resume/ai/task-models": {},
	"@reactive-resume/ai/types": {},
	"@/auth/session": { getAccountScope: () => "account", getServer: () => "https://fictional.invalid" },
});
test("native usage history needs no provider or sharing approval", async () => {
	let lookups = 0;
	const api = {
		aiProviders: {
			list: async () => {
				lookups++;
				return [];
			},
		},
	};
	assert.equal(await authorizeAiRequest(["ai", "usage"], {}, api, "account"), undefined);
	assert.equal(lookups, 0);
});
