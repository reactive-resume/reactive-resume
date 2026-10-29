import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import * as localeUtils from "@reactive-resume/utils/locale";

const serverRequire = createRequire(new URL("../../server/package.json", import.meta.url));
const { transformSync } = createRequire(serverRequire.resolve("tsx"))("esbuild");
const code = transformSync(readFileSync(new URL("../src/i18n/index.ts", import.meta.url), "utf8"), {
	loader: "ts",
	format: "cjs",
	supported: { "dynamic-import": false },
}).code;

function load(development, deviceLocales) {
	const storage = new Map([["locale", "zu-ZA"]]);
	let active;
	const dependencies = {
		"@reactive-resume/utils/locale": localeUtils,
		"@lingui/core": { i18n: { loadAndActivate: (value) => (active = value) } },
		"expo-localization": { getLocales: () => deviceLocales },
		"expo-sqlite/kv-store": {
			getItemSync: (key) => storage.get(key) ?? null,
			setItemSync: (key, value) => storage.set(key, value),
			removeItemSync: (key) => storage.delete(key),
		},
		"react-native": { I18nManager: { isRTL: false }, Platform: { OS: "android" } },
	};
	const module = { exports: {} };
	new Function("require", "module", "exports", "__DEV__", code)(
		(name) => {
			if (name.endsWith(".po")) return { messages: { catalog: name } };
			assert.ok(name in dependencies, `Missing boundary: ${name}`);
			return dependencies[name];
		},
		module,
		module.exports,
		development,
	);
	return { ...module.exports, storage, active: () => active };
}

test("production recovers saved pseudo-locale to the device language and excludes it from choices", async () => {
	const app = load(false, [{ languageTag: "de-DE", languageCode: "de" }]);
	assert.equal(app.selectableLocales.includes("zu-ZA"), false);
	assert.equal(app.getLocalePreference(), null);
	await app.initI18n();
	assert.equal(app.active().locale, "de-DE");
	assert.match(app.active().messages.catalog, /de-DE\.po$/);
	await app.setLocalePreference("zu-ZA");
	assert.equal(app.storage.has("locale"), false);
	assert.equal(app.active().locale, "de-DE");
	await app.setLocalePreference("fr-FR");
	assert.equal(app.getLocalePreference(), "fr-FR");
	assert.equal(app.active().locale, "fr-FR");
});

test("a Zulu device never gets pseudo-English automatically, including in development", () => {
	for (const development of [false, true]) {
		const app = load(development, [
			{ languageTag: "zu-ZA", languageCode: "zu" },
			{ languageTag: "fr-CA", languageCode: "fr" },
		]);
		assert.equal(app.getDeviceLocale(), "fr-FR");
		assert.equal(load(development, [{ languageTag: "zu-ZA", languageCode: "zu" }]).getDeviceLocale(), "en-US");
	}
});

test("development preserves explicit pseudo-localization testing", async () => {
	const app = load(true, [{ languageTag: "en-US", languageCode: "en" }]);
	assert.equal(app.selectableLocales.includes("zu-ZA"), true);
	assert.equal(app.getLocalePreference(), "zu-ZA");
	await app.initI18n();
	assert.equal(app.active().locale, "zu-ZA");
	assert.match(app.active().messages.catalog, /zu-ZA\.po$/);
});
