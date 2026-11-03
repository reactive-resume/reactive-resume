import assert from "node:assert/strict";
import { test } from "node:test";
import { filterOptions } from "@reactive-resume/utils/string";
import { bundle, tag } from "./harness.mjs";

const jsx = (type, props) => ({ type, props });

function fixture(locale = "en-US", uiLocale = "en-US") {
	let state = [];
	let cursor = 0;
	let scope = "account-a";
	let source = locale === null ? null : { id: "source", name: "Priya Raman", data: { metadata: { page: { locale } } } };
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
		"@lingui/react/macro": {
			useLingui: () => ({
				t: tag,
				i18n: {
					_: (descriptor) =>
						uiLocale === "de-DE"
							? ({ French: "Französisch", English: "Englisch", German: "Deutsch" }[descriptor.message] ??
								descriptor.message)
							: descriptor.message,
				},
			}),
		},
		"@lingui/core/macro": { msg: (parts, ...values) => ({ message: tag(parts, ...values) }) },
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
		"@/draft": { useResumeStore: (select) => select({ document: source, data: source?.data ?? null }) },
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
		"@/features/share/document": {
			flushResume: async (id) => {
				calls.push(["flush", id]);
				await saved;
				return source;
			},
		},
		"@/i18n": { selectableLocales: ["en-US", "de-DE", "fr-FR"] },
		"@/routes": { routes: { assistant: (id) => `/builder/${id}/assistant` } },
		"@/ui": {
			Button: "Button",
			SelectSheet: "SelectSheet",
			Sheet: "Sheet",
			Text: "Text",
			useTheme: () => ({ space: {} }),
		},
	};
	const { TranslateResume } = bundle("../src/features/assistant/translate-resume.tsx", dependencies);
	const render = () => {
		cursor = 0;
		return TranslateResume({ resumeId: "source", onClose: () => calls.push(["close"]) });
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
		changeSourceLocale: (locale) => {
			source = { id: "source", name: "Priya Raman", data: { metadata: { page: { locale } } } };
		},
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

test("native language copy excludes the source locale and rechecks the saved locale before duplication", async () => {
	const f = fixture("de-DE");
	const tree = f.render();
	const picker = f.nodes(tree).find((node) => node.type === "SelectSheet");
	assert.equal(picker.props.value, "en-US");
	assert.ok(picker.props.options.every((option) => option.value !== "de-DE"));
	f.nodes(tree)
		.find((node) => node.type === "Button")
		.props.onPress();
	f.changeSourceLocale("en-US");
	f.release();
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(f.calls, [["flush", "source"]]);
});

test("native translation picker shows the endonym and retains hidden search names", () => {
	const f = fixture("en-US", "de-DE");
	const picker = f.nodes(f.render()).find((node) => node.type === "SelectSheet").props;
	const french = picker.options.find((option) => option.value === "fr-FR");
	assert.equal(french.label, "Français");
	assert.equal(french.description, "Französisch");
	for (const query of ["Français", "French", "Französisch", "fr-FR"]) {
		assert.deepEqual(filterOptions(picker.options, query), [french]);
	}
});

test("native language selection follows a late-loaded source and retains only compatible user choices", () => {
	const f = fixture(null);
	const picker = () => f.nodes(f.render()).find((node) => node.type === "SelectSheet").props;
	const button = () => f.nodes(f.render()).find((node) => node.type === "Button").props;
	assert.equal(button().disabled, true);
	f.changeSourceLocale("de-DE");
	assert.equal(picker().value, "en-US");
	assert.equal(button().disabled, false);
	picker().onChange("fr-FR");
	f.changeSourceLocale("en-US");
	assert.equal(picker().value, "fr-FR");
	f.changeSourceLocale("fr-FR");
	assert.equal(picker().value, "de-DE");
	assert.equal(button().disabled, false);
	assert.ok(picker().options.every((option) => option.value !== "fr-FR"));
	assert.deepEqual(f.calls, []);
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
