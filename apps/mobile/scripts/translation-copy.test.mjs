import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const serverRequire = createRequire(`${root}/apps/server/package.json`);
const { buildSync } = createRequire(serverRequire.resolve("tsx"))("esbuild");
const jsx = (type, props) => ({ type, props });
const tag = (parts, ...values) => parts.reduce((text, part, index) => text + part + (values[index] ?? ""), "");

function fixture() {
	let state = [];
	let cursor = 0;
	let scope = "account-a";
	const calls = [];
	let release;
	const saved = new Promise((resolve) => {
		release = resolve;
	});
	const dependencies = {
		"react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
		react: {
			useState: (value) => {
				const i = cursor++;
				state[i] ??= value;
				return [
					state[i],
					(next) => {
						state[i] = next;
					},
				];
			},
			useRef: (value) => {
				const i = cursor++;
				state[i] ??= { current: value };
				return state[i];
			},
		},
		"react-native": { View: "View" },
		"@lingui/react/macro": { useLingui: () => ({ t: tag, i18n: { _: (descriptor) => descriptor.message } }) },
		"expo-router": { useRouter: () => ({ replace: (href) => calls.push(["navigate", href]) }) },
		"@/api/client": {
			client: {
				resume: {
					duplicate: async (input, options) => {
						calls.push(["duplicate", input, options]);
						return "copy";
					},
				},
			},
		},
		"@/auth/session": { getAccountScope: () => scope },
		"./handoff": { handToAssistant: (...args) => calls.push(["handoff", ...args]) },
		"@/features/documents/queries": {
			useDocumentOperations: () => ({
				busy: false,
				run: async (work) => {
					await work();
					return true;
				},
			}),
		},
		"@/features/settings/locale-names": {
			localeMap: { "de-DE": { message: "German" }, "fr-FR": { message: "French" } },
		},
		"@/features/share/document": {
			flushResume: async (id) => {
				calls.push(["flush", id]);
				await saved;
				return { name: "Priya Raman" };
			},
		},
		"@/i18n": { selectableLocales: ["de-DE", "fr-FR"] },
		"@/routes": { routes: { assistant: (id) => `/builder/${id}/assistant` } },
		"@/ui": {
			Button: "Button",
			SelectSheet: "SelectSheet",
			Sheet: "Sheet",
			Text: "Text",
			useTheme: () => ({ space: {} }),
		},
	};
	const code = buildSync({
		entryPoints: [`${root}/apps/mobile/src/features/assistant/translate-resume.tsx`],
		bundle: true,
		platform: "node",
		format: "cjs",
		write: false,
		jsx: "automatic",
		external: Object.keys(dependencies),
	}).outputFiles[0].text;
	const module = { exports: {} };
	new Function("require", "module", "exports", code)(
		(name) => {
			assert.ok(name in dependencies, name);
			return dependencies[name];
		},
		module,
		module.exports,
	);
	const render = () => {
		cursor = 0;
		return module.exports.TranslateResume({ resumeId: "source", onClose: () => calls.push(["close"]) });
	};
	const nodes = (node) =>
		Array.isArray(node)
			? node.flatMap(nodes)
			: node && typeof node === "object"
				? [node, ...nodes(node.props?.children)]
				: [];
	return {
		render,
		calls,
		nodes,
		release,
		changeAccount: () => {
			scope = "account-b";
		},
	};
}

test("native language copy waits for explicit action, flushes once, and hands an unsent draft only to its account/copy", async () => {
	const f = fixture();
	let tree = f.render();
	assert.deepEqual(f.calls, []);
	const picker = f.nodes(tree).find((node) => node.type === "SelectSheet");
	assert.equal(picker.props.label, "Language");
	picker.props.onChange("fr-FR");
	tree = f.render();
	const button = f.nodes(tree).find((node) => node.type === "Button");
	assert.equal(button.props.label, "Create language copy");
	const first = button.props.onPress();
	button.props.onPress();
	assert.deepEqual(f.calls, [["flush", "source"]]);
	f.release();
	await first;
	// onPress intentionally returns void; the production async action settles on the same microtask queue.
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(f.calls[1], [
		"duplicate",
		{ id: "source", name: "Priya Raman — French", pageLocale: "fr-FR" },
		{ context: { scope: "account-a" } },
	]);
	assert.deepEqual(f.calls.at(-1), ["navigate", "/builder/copy/assistant"]);
	const handed = f.calls.find(([kind]) => kind === "handoff");
	assert.deepEqual(handed.slice(1, 3), ["account-a", "copy"]);
	assert.match(handed[3], /language copy into fr-FR/);
	assert.equal(f.calls.filter(([kind]) => kind === "duplicate").length, 1);
});

test("an account change during a native copy prevents composer handoff and navigation", async () => {
	const f = fixture();
	f.nodes(f.render())
		.find((node) => node.type === "Button")
		.props.onPress();
	f.changeAccount();
	f.release();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(f.calls.filter(([kind]) => ["handoff", "navigate"].includes(kind)).length, 0);
	assert.equal(f.calls.find(([kind]) => kind === "duplicate")[2].context.scope, "account-a");
});
