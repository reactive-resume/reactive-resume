import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const req = createRequire(new URL("../package.json", import.meta.url));
const serverReq = createRequire(new URL("../../server/package.json", import.meta.url));
const { transformSync } = createRequire(serverReq.resolve("tsx"))("esbuild");
function load(path, mocks) {
	const module = { exports: {} };
	const code = transformSync(readFileSync(new URL(path, import.meta.url), "utf8"), {
		loader: "tsx",
		format: "cjs",
		jsx: "automatic",
	}).code;
	new Function("require", "module", "exports", code)(
		(name) => {
			assert.ok(name in mocks, `Unexpected dependency: ${name}`);
			return mocks[name];
		},
		module,
		module.exports,
	);
	return module.exports;
}
const origin = "https://fictional.example";
const original = JSON.stringify([origin, "fictional-account"]);
function browserFixture() {
	const state = { scope: original, urls: [], pending: null };
	const { openAccountSettings } = load("../src/features/settings/browser.ts", {
		"@/auth/session": { getAccountScope: () => state.scope },
		"expo-web-browser": {
			openBrowserAsync: async (url) => {
				state.urls.push(new URL(url));
				if (state.pending) await state.pending.promise;
				return { type: "cancel" };
			},
		},
	});
	return { state, openAccountSettings };
}

test("security targets and existing key/deletion entries retain server, account and explicit intent without credentials", async () => {
	const { state, openAccountSettings } = browserFixture();
	for (const target of ["email", "password", "two-step", "passkeys", "linked-accounts"]) {
		assert.equal(await openAccountSettings(`/dashboard/settings/account#${target}`), true);
		const url = state.urls.at(-1);
		assert.equal(url.origin, origin);
		assert.equal(url.pathname, "/dashboard/settings/account");
		assert.equal(url.hash, `#${target}`);
		assert.deepEqual([...url.searchParams], [["forAccount", "fictional-account"]]);
	}
	await openAccountSettings("/dashboard/settings/account?deleteAccount=true");
	assert.equal(state.urls.at(-1).searchParams.get("deleteAccount"), "true");
	await openAccountSettings("/dashboard/settings/ai?newKey=true#api-keys");
	assert.equal(state.urls.at(-1).pathname, "/dashboard/settings/ai");
	assert.equal(state.urls.at(-1).searchParams.get("newKey"), "true");
	assert.equal(state.urls.at(-1).hash, "#api-keys");
});

test("signed-out and stale entries cannot open; account changes during browser return suppress follow-up effects", async () => {
	const { state, openAccountSettings } = browserFixture();
	state.scope = null;
	assert.equal(await openAccountSettings(), false);
	state.scope = JSON.stringify([origin, "other-account"]);
	assert.equal(await openAccountSettings(undefined, original), false);
	assert.equal(state.urls.length, 0);
	state.scope = original;
	state.pending = Promise.withResolvers();
	const returning = openAccountSettings();
	state.scope = JSON.stringify(["https://other.example", "fictional-account"]);
	state.pending.resolve();
	assert.equal(await returning, false);
});

const { Window } = await import(req.resolve("happy-dom"));
const window = new Window();
Object.assign(globalThis, {
	window,
	document: window.document,
	HTMLElement: window.HTMLElement,
	IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", { configurable: true, value: window.navigator });
const React = req("react");
const { act, cleanup, fireEvent, render, screen } = req("@testing-library/react");
const h = React.createElement;
const tag = (parts, ...values) => parts.reduce((text, part, i) => text + part + (values[i] ?? ""), "");
const Group = ({ children }) => h("div", null, children);

test("native account rows select all five browser areas and ignore stale completion/errors", async () => {
	const { state, openAccountSettings } = browserFixture();
	let refetches = 0;
	let invalidations = 0;
	let errors = 0;
	const refetch = async () => {
		refetches++;
	};
	const { default: AccountScreen } = load("../app/(tabs)/settings/account.tsx", {
		react: React,
		"react/jsx-runtime": req("react/jsx-runtime"),
		"@lingui/react/macro": { useLingui: () => ({ t: tag }) },
		"@tanstack/react-query": {
			useQueryClient: () => ({
				invalidateQueries: async () => {
					invalidations++;
				},
			}),
		},
		"@/api/client": { orpc: { auth: { apiKeys: { list: { key: () => ["keys"] } } } } },
		"@/auth/session": { getAccountScope: () => state.scope },
		"@/features/settings/api-keys": { ApiKeys: () => null },
		"@/features/settings/browser": { openAccountSettings },
		"@/features/settings/export": { ExportDataRow: () => null },
		"@/features/settings/layout": { SettingsGroup: Group, SettingsPage: Group },
		"@/features/settings/profile": { ProfileEditor: () => null },
		"@/features/settings/queries": {
			useProfile: () => ({ data: { id: "fictional-account", email: "fictional@example.invalid" }, refetch }),
		},
		"@/features/settings/sign-out": { SignOutRow: () => null },
		"@/ui": {
			Banner: () => null,
			Icon: () => null,
			Skeleton: () => null,
			useTheme: () => ({ size: { input: 44 } }),
			ListRow: ({ title, onPress }) => h("button", { onClick: onPress }, title),
			showToast: () => {
				errors++;
			},
		},
	});
	try {
		render(h(AccountScreen));
		for (const [label, target] of [
			["Email", "email"],
			["Password", "password"],
			["Two-step verification", "two-step"],
			["Passkeys", "passkeys"],
			["Linked accounts", "linked-accounts"],
		]) {
			await act(async () => fireEvent.click(screen.getByRole("button", { name: label, exact: true })));
			assert.equal(state.urls.at(-1).hash, `#${target}`);
		}
		assert.equal(refetches, 5);
		assert.equal(invalidations, 5);
		state.pending = Promise.withResolvers();
		fireEvent.click(screen.getByRole("button", { name: "Password", exact: true }));
		state.scope = JSON.stringify([origin, "other-account"]);
		await act(async () => {
			state.pending.resolve();
		});
		assert.equal(refetches, 5);
		assert.equal(invalidations, 5);
		const launched = state.urls.length;
		await act(async () => fireEvent.click(screen.getByRole("button", { name: "Email", exact: true })));
		assert.equal(state.urls.length, launched, "stale rendered account cannot launch new-account settings");
		state.scope = original;
		state.pending = Promise.withResolvers();
		fireEvent.click(screen.getByRole("button", { name: "Passkeys", exact: true }));
		state.scope = null;
		await act(async () => {
			state.pending.reject(new Error("Browser unavailable"));
		});
		assert.equal(errors, 0, "old-account errors cannot appear in new session");
	} finally {
		cleanup();
	}
});
