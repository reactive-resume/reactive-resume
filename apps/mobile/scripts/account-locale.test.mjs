// Host proof of account lifetime; native rendering remains device QA.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const serverRequire = createRequire(new URL("../../server/package.json", import.meta.url));
const { transformSync } = createRequire(serverRequire.resolve("tsx"))("esbuild");
const code = transformSync(
	readFileSync(new URL("../src/features/settings/account-locale.ts", import.meta.url), "utf8"),
	{ loader: "ts", format: "cjs" },
).code;

function harness(saved = "en-US") {
	const state = { scope: "account-A", locale: "ar-SA", data: saved === undefined ? undefined : { locale: saved } };
	const effects = [];
	const writes = [];
	const invalidations = [];
	let finish;
	const response = new Promise((resolve) => (finish = resolve));
	const mocks = {
		"@lingui/react": { useLingui: () => ({ i18n: { locale: state.locale } }) },
		"@tanstack/react-query": {
			useQuery: () => ({ data: state.data }),
			useQueryClient: () => ({ invalidateQueries: (options) => invalidations.push(options) }),
		},
		react: { useEffect: (effect) => effects.push(effect) },
		"@reactive-resume/utils/locale": { isLocale: (locale) => ["en-US", "ar-SA"].includes(locale) },
		"@/api/client": {
			client: { auth: { updateProfile: (...args) => (writes.push(args), response) } },
			orpc: { auth: { getProfile: { key: () => ["profile"], queryOptions: (options) => options } } },
		},
		"@/auth/session": {
			getAccountScope: () => state.scope,
			useSession: () => ({ status: "signed-in", server: "https://resume.example" }),
		},
	};
	const module = { exports: {} };
	new Function("require", "module", "exports", code)(
		(name) => {
			assert.ok(name in mocks, `Missing boundary: ${name}`);
			return mocks[name];
		},
		module,
		module.exports,
	);
	return {
		state,
		writes,
		invalidations,
		finish,
		render: module.exports.useAccountLocale,
		effect: () => effects.shift()(),
	};
}

test("language sync stays bound to the rendered account and ignores its late success after account replacement", async () => {
	const h = harness();
	h.render();
	h.effect();
	assert.deepEqual(h.writes, [[{ locale: "ar-SA" }, { context: { scope: "account-A" } }]]);
	h.state.scope = "account-B";
	h.finish({ status: true });
	await new Promise(setImmediate);
	assert.deepEqual(h.invalidations, []);
});

test("account replaced between render and effect sends no old account language", () => {
	const h = harness();
	h.render();
	h.state.scope = "account-B";
	h.effect();
	assert.deepEqual(h.writes, []);
});

test("old servers without language support and already synchronized accounts receive no language write", () => {
	for (const data of [{}, { locale: "ar-SA" }]) {
		const h = harness();
		h.state.data = data;
		h.render();
		h.effect();
		assert.deepEqual(h.writes, []);
	}
});
