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
	state.explicit = true;
	state.session = { status: "signed-in", server: "https://resume.example" };
	const effects = [];
	const writes = [];
	const invalidations = [];
	const activations = [];
	const restarts = [];
	let finish;
	const response = new Promise((resolve) => (finish = resolve));
	const mocks = {
		"@lingui/react": { useLingui: () => ({ i18n: { locale: state.locale } }) },
		"@tanstack/react-query": {
			useQuery: () => ({ data: state.data }),
			useQueryClient: () => ({ invalidateQueries: (options) => invalidations.push(options) }),
		},
		react: { useEffect: (effect) => effects.push(effect), useState: () => [null, (value) => restarts.push(value)] },
		"@reactive-resume/utils/locale": {
			isLocale: (locale) => ["en-US", "ar-SA"].includes(locale),
			isRTL: (locale) => locale === "ar-SA",
		},
		"react-native": { I18nManager: { isRTL: false } },
		"@/api/client": {
			client: { auth: { updateProfile: (...args) => (writes.push(args), response) } },
			orpc: { auth: { getProfile: { key: () => ["profile"], queryOptions: (options) => options } } },
		},
		"@/auth/session": {
			getAccountScope: () => state.scope,
			getSession: () => state.session,
			useSession: () => state.session,
		},
		"@/i18n": {
			hasLocalePreference: () => state.explicit,
			getDeviceLocale: () => "en-US",
			selectableLocales: ["en-US", "ar-SA"],
			activateLocale: (locale, current) => {
				activations.push({ locale, current });
				return response.then(() => current());
			},
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
		activations,
		restarts,
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

test("an unconfigured device restores the account without overwriting it", async () => {
	const h = harness();
	h.state.explicit = false;
	h.render();
	h.effect();
	assert.deepEqual(h.writes, []);
	assert.equal(h.activations[0].locale, "en-US");
	assert.equal(h.activations[0].current(), true);
	h.finish();
	await new Promise(setImmediate);
	assert.deepEqual(h.restarts, []);
});

test("account replacement, cleanup and an explicit choice each fence derived catalog activation", () => {
	for (const replace of [
		(h) => (h.state.scope = "account-B"),
		(h) => (h.state.session = { ...h.state.session }),
		(h) => (h.state.explicit = true),
		(_, cleanup) => cleanup(),
	]) {
		const h = harness();
		h.state.explicit = false;
		h.render();
		const cleanup = h.effect();
		replace(h, cleanup);
		assert.equal(h.activations[0].current(), false);
	}
});

test("missing, unsupported and old-server account languages follow the device without a write", () => {
	for (const data of [{}, { locale: null }, { locale: "unsupported" }]) {
		const h = harness();
		h.state.data = data;
		h.state.explicit = false;
		h.render();
		h.effect();
		assert.equal(h.activations[0].locale, "en-US");
		assert.deepEqual(h.writes, []);
	}
});

test("sign-out returns an unconfigured device to its language", () => {
	const h = harness("ar-SA");
	h.state.explicit = false;
	h.state.scope = null;
	h.state.session = { ...h.state.session, status: "signed-out" };
	h.render();
	h.effect();
	assert.equal(h.activations[0].locale, "en-US");
	assert.deepEqual(h.writes, []);
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

test("derived RTL language shows restart guidance while explicit language leaves it to Preferences", () => {
	const h = harness("ar-SA");
	h.state.explicit = false;
	const view = h.render();
	assert.equal(view.restart, true);
	view.dismissRestart();
	assert.deepEqual(h.restarts, [{ session: h.state.session, locale: "ar-SA" }]);
	h.state.explicit = true;
	assert.equal(h.render().restart, false);
});
