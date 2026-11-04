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

function load(deviceLocales) {
	const storage = new Map([["locale", "zu-ZA"]]);
	const directions = [];
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
		"react-native": {
			I18nManager: {
				isRTL: false,
				allowRTL: (rtl) => directions.push(["allow", rtl]),
				forceRTL: (rtl) => directions.push(["force", rtl]),
			},
			Platform: { OS: "android" },
		},
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
		false,
	);
	return { ...module.exports, storage, directions, active: () => active };
}

test("production recovers saved pseudo-locale to the device language and excludes it from choices", async () => {
	const app = load([{ languageTag: "de-DE", languageCode: "de" }]);
	assert.equal(app.selectableLocales.includes("zu-ZA"), false);
	assert.equal(app.getLocalePreference(), null);
	await app.initI18n();
	assert.equal(app.active().locale, "de-DE");
	assert.match(app.active().messages.catalog, /de-DE\.po$/);
	await app.setLocalePreference("zu-ZA");
	assert.equal(app.storage.get("locale"), "system");
	assert.equal(app.hasLocalePreference(), true);
	assert.equal(app.active().locale, "de-DE");
	await app.setLocalePreference("fr-FR");
	assert.equal(app.getLocalePreference(), "fr-FR");
	assert.equal(app.active().locale, "fr-FR");
});

test("unconfigured and explicit System are distinct, and derived account languages are never saved locally", async () => {
	const app = load([{ languageTag: "de-DE" }]);
	app.storage.clear();
	assert.equal(app.hasLocalePreference(), false);
	await app.activateLocale("fr-FR");
	assert.equal(app.active().locale, "fr-FR");
	assert.equal(app.hasLocalePreference(), false);
	await app.setLocalePreference(null);
	assert.equal(app.active().locale, "de-DE");
	assert.equal(app.getLocalePreference(), null);
	assert.equal(app.hasLocalePreference(), true);
});

test("a replaced account and a newer local choice prevent a late catalog from activating", async () => {
	const app = load([{ languageTag: "de-DE" }]);
	await app.initI18n();
	await app.activateLocale("fr-FR", () => false);
	assert.equal(app.active().locale, "de-DE");
	await Promise.all([app.activateLocale("fr-FR"), app.setLocalePreference("en-US")]);
	assert.equal(app.active().locale, "en-US");
	assert.equal(app.getLocalePreference(), "en-US");
});

test("a restored RTL catalog requests a restart without saving an explicit preference", async () => {
	const app = load([{ languageTag: "en-US" }]);
	app.storage.clear();
	assert.equal(await app.activateLocale("ar-SA"), true);
	assert.equal(app.active().locale, "ar-SA");
	assert.deepEqual(app.directions, [
		["allow", true],
		["force", true],
	]);
	assert.equal(app.hasLocalePreference(), false);
	assert.equal(await app.activateLocale("he-IL", () => false), false);
	assert.equal(app.active().locale, "ar-SA");
});
