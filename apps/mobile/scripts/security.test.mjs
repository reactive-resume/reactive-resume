import assert from "node:assert/strict";
import { test } from "node:test";
import * as harness from "./harness.mjs";

const load = (path, mocks, development = true) =>
	harness.load(`../src/${path}`, mocks, {
		loader: "ts",
		supported: { "dynamic-import": false },
		globals: { __DEV__: development },
	});

function previewSession(values = [], development = true, clearAccountExportCache = () => {}) {
	const store = new Map(values);
	const session = load(
		"auth/session.ts",
		{
			"@lingui/core": { i18n: { locale: "en-US" } },
			"expo-auth-session": {},
			"expo-network": {},
			"expo-web-browser": {},
			"expo-sqlite/kv-store": {},
			"@/features/settings/export-cache": { clearAccountExportCache },
			react: {},
			"@reactive-resume/utils/string": { fnv1a: () => 1 },
			"expo-secure-store": {
				getItemAsync: async (key) => store.get(key) ?? null,
				setItemAsync: async (key, value) => {
					store.set(key, value);
				},
				deleteItemAsync: async (key) => {
					store.delete(key);
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

test("session expiry removes private exports and repeated unauthorized responses cannot clear files again", async () => {
	let cleanups = 0;
	const { session, store } = previewSession(
		[
			["server", "https://real.example"],
			["tokens:https://real.example", JSON.stringify({ accessToken: "real-token" })],
		],
		true,
		() => cleanups++,
	);
	await session.restoreSession();
	assert.equal(cleanups, 1, "cold start removes previous export files");
	const credentials = await session.getCredentials();
	await session.rejectCredentials(credentials);
	assert.equal(session.getSession().status, "expired");
	assert.equal(cleanups, 2);
	assert.equal(store.has("tokens:https://real.example"), false);
	await session.rejectCredentials(credentials);
	assert.equal(cleanups, 2, "a repeated 401 cannot clean files again");
});

test("export cleanup failure still expires and retires credentials", async () => {
	let failCleanup = false;
	const { session, store } = previewSession(
		[["tokens:https://rxresu.me", JSON.stringify({ accessToken: "real-token" })]],
		true,
		() => {
			if (failCleanup) throw new Error("Disk unavailable");
		},
	);
	await session.restoreSession();
	const credentials = await session.getCredentials();
	failCleanup = true;
	await assert.rejects(session.rejectCredentials(credentials), /Disk unavailable/);
	assert.equal(session.getSession().status, "expired");
	assert.equal(await session.getAccessToken(), null);
	assert.equal(store.has("tokens:https://rxresu.me"), false);
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
