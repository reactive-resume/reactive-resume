import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const serverRequire = createRequire(new URL("../../server/package.json", import.meta.url));
const { transformSync } = createRequire(serverRequire.resolve("tsx"))("esbuild");
const tag = (parts, ...values) => parts.reduce((text, part, index) => text + part + (values[index] ?? ""), "");

function load(path, mocks, development = true) {
	const module = { exports: {} };
	const code = transformSync(readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8"), {
		loader: "ts",
		format: "cjs",
	}).code;
	new Function("require", "module", "exports", "__DEV__", code)(
		(name) => {
			assert.ok(name in mocks, `Unexpected dependency: ${name}`);
			return mocks[name];
		},
		module,
		module.exports,
		development,
	);
	return module.exports;
}

test("AI imports retain the selecting account through parsing", async () => {
	let scope = "original-account";
	const parsed = Promise.withResolvers();
	const started = Promise.withResolvers();
	let saved = 0;
	class SessionChangedError extends Error {}
	const { importDocument } = load("features/documents/import-file.ts", {
		"@lingui/core/macro": { t: tag },
		"expo-file-system": {
			File: class {
				size = 12;
				base64 = async () => "file";
			},
		},
		"@reactive-resume/schema/cover-letter/data": {},
		"@/auth/session": { getAccountScope: () => scope },
		"@/api/client": {
			SessionChangedError,
			client: {
				ai: {
					parsePdf: (_input, options) => {
						assert.equal(options.context.scope, "original-account");
						started.resolve();
						return parsed.promise;
					},
				},
				resume: {
					import: async () => {
						saved++;
						return "id";
					},
				},
			},
		},
	});
	const result = importDocument({ name: "private.pdf", uri: "fixture" }, true, true, new AbortController().signal);
	await started.promise;
	scope = "different-account";
	parsed.resolve({ basics: { name: "Private" } });
	await assert.rejects(result, SessionChangedError);
	assert.equal(saved, 0);
});

function previewSession(values = [], development = true) {
	const store = new Map(values);
	const session = load(
		"auth/session.ts",
		{
			"expo-auth-session": {},
			"expo-network": {},
			"expo-web-browser": {},
			"expo-sqlite/kv-store": {},
			react: {},
			"@reactive-resume/utils/string": { fnv1a: () => 1 },
			"expo-secure-store": {
				getItemAsync: async (key) => store.get(key) ?? null,
				setItemAsync: async (key, value) => {
					store.set(key, value);
				},
			},
			"./oauth": { storeKey: (kind, origin) => `${kind}:${origin}`, isAllowedServer: () => true },
		},
		development,
	);
	return { session, store };
}

test("development previews never replace real credentials", async () => {
	const values = [
		["server", "https://real.example"],
		["tokens:https://real.example", JSON.stringify({ accessToken: "real-token" })],
	];
	const { session, store } = previewSession(values);
	await assert.rejects(session.installDevelopmentSession("http://localhost:3000"), /Sign out/);
	assert.deepEqual([...store], values);
	assert.equal(session.getServer(), "https://real.example");
});

test("a development fixture changes disk and memory together and rejects remote origins", async () => {
	const { session, store } = previewSession();
	await assert.rejects(session.installDevelopmentSession("https://external.example"), /local development/);
	await session.installDevelopmentSession("http://localhost:3000");
	assert.equal(store.get("server"), "http://localhost:3000");
	assert.equal(session.getServer(), "http://localhost:3000");
	assert.equal(session.getAccountScope(), JSON.stringify(["http://localhost:3000", "rr-M3T4-preview"]));
	await assert.rejects(
		previewSession([], false).session.installDevelopmentSession("http://localhost:3000"),
		/local development/,
	);
});
