// Exercises native Checklist output and handlers on the host; no device/runtime claim.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { i18n } from "@lingui/core";
import { esbuild, load as loadSource, tag } from "./harness.mjs";

i18n.loadAndActivate({ locale: "en-US", messages: {} });

const root = new URL("../../..", import.meta.url).pathname;
const serverRequire = createRequire(root + "/apps/server/package.json");
const { buildSync } = esbuild;
const sharedCode = buildSync({
	entryPoints: [root + "/packages/schema/src/applications/preparation.ts"],
	bundle: true,
	platform: "node",
	format: "cjs",
	write: false,
}).outputFiles[0].text;
const shared = { exports: {} };
new Function("require", "module", "exports", sharedCode)(serverRequire, shared, shared.exports);
const dataCode = buildSync({
	entryPoints: [root + "/packages/schema/src/applications/data.ts"],
	bundle: true,
	platform: "node",
	format: "cjs",
	write: false,
}).outputFiles[0].text;
const submission = { exports: {} };
new Function("require", "module", "exports", dataCode)(serverRequire, submission, submission.exports);
const jsx = (type, props) => ({ type, props });
const application = {
	id: "job",
	role: "Engineer",
	company: "Example",
	status: "saved",
	activity: [],
	jobDescription: "Posting",
	resumeId: null,
	coverLetterId: null,
	resumeFileUrl: null,
	coverLetterUrl: null,
};
const empty = { answers: [], checklist: [], questions: [], evidence: {}, ticks: {}, message: "" };

function load(data, overrides = {}) {
	const saves = [];
	const dependencies = {
		"@lingui/core": { i18n },
		"@lingui/core/macro": {
			ph: (named) => Object.values(named)[0],
			plural: (n, forms) => forms.other.replace("#", String(n)),
		},
		"@lingui/react/macro": { useLingui: () => ({ t: tag }) },
		"@tanstack/react-query": { useQueryClient: () => ({}), useMutation: () => ({}) },
		"expo-clipboard": {},
		"expo-crypto": {},
		"expo-router": {},
		react: { useState: (value) => [value, () => {}] },
		"react/jsx-runtime": { jsx, jsxs: jsx },
		"react-native": { View: "View" },
		"@reactive-resume/schema/application-answers": {},
		"@reactive-resume/schema/applications/data": submission.exports,
		"@reactive-resume/schema/applications/preparation": shared.exports,
		"@reactive-resume/schema/career": {},
		"@reactive-resume/utils/string": {},
		"../answer-library": {},
		"../hooks": { useWorkspace: () => ({ data, current: () => data, save: (patch) => saves.push(patch) }) },
		"../logic": {},
		"../parts": { Block: "Block", CheckRow: "CheckRow", Actions: "Actions" },
		"../preparation": {},
		"../share": {},
		"../shell": {},
		"../state": {},
		"@/api/client": { orpc: { career: { submitApplication: { mutationOptions: () => ({}) } } } },
		"@/draft": {},
		"@/auth/session": { getAccountScope: () => "fixture" },
		"@/features/ai/providers": {},
		"@/features/application-detail/sections": {},
		"@/features/applications/prior-no-response": { PriorNoResponse: "PriorNoResponse" },
		"@/features/applications/queries": { useInvalidateApplications: () => () => {} },
		"@/features/career/undo": {},
		"@/features/documents/queries": { useDocuments: () => ({ data: [] }) },
		"@/routes": {},
		"@/ui": { Button: "Button", Text: "Text", Sheet: "Sheet", ListRow: "ListRow", useTheme: () => ({ space: {} }) },
	};
	Object.assign(dependencies, overrides);
	const exports = loadSource("../src/features/workspace/tabs/apply.tsx", dependencies, {
		append: "\nmodule.exports.Checklist = Checklist; module.exports.Apply = Apply;",
	});
	return { ...exports, saves };
}

function render(data, readOnly = false, versionId = undefined, currentAnswers = data.answers) {
	const { Checklist, saves } = load(data);
	const tree = Checklist({
		application,
		answerCount: currentAnswers.filter((answer) => answer.answer.trim()).length,
		currentAnswers: () => currentAnswers,
		versionId,
		readOnly,
		canSubmit: true,
		submitting: false,
		onSubmittingChange: () => {},
	});
	const nodes = [];
	const visit = (node) => {
		if (Array.isArray(node)) return node.forEach(visit);
		if (!node || typeof node !== "object") return;
		nodes.push(node);
		visit(node.props?.children);
	};
	visit(tree);
	return { tree, nodes, saves };
}

test("native absent subjects keep submission index 3 and omit empty answer actions", () => {
	const { nodes, saves } = render(empty);
	const checks = nodes.filter((n) => n.type === "CheckRow");
	assert.equal(checks.length, 1);
	assert.equal(checks[0].props.label, "Submit through the employer's application page yourself.");
	checks[0].props.onChange(true);
	assert.deepEqual(saves, [{ checklist: [3] }]);
	assert.equal(
		nodes.some((n) => n.type === "Actions"),
		false,
	);
});

test("native first-submission review stays read-only and legacy/version history stays honest", () => {
	for (const kind of ["recorded", "legacy", "first version", "version"]) {
		const data = {
			...empty,
			checklist: [0],
			submissionReview:
				kind === "legacy"
					? null
					: { at: "2026-11-03T10:00:00Z", checklist: [1], documents: false, answers: true, answerVersionId: "first" },
		};
		const { tree, nodes } = render(
			data,
			kind === "version" || kind === "first version",
			kind === "first version" ? "first" : "later",
		);
		assert.equal(tree.props.trailing, undefined);
		const checks = nodes.filter((n) => n.type === "CheckRow");
		assert.equal(checks.length, kind === "recorded" || kind === "first version" ? 2 : 0);
		if (kind === "recorded" || kind === "first version") {
			assert.deepEqual(
				checks.map((n) => n.props.checked),
				[true, false],
			);
			assert.ok(checks.every((n) => n.props.disabled));
		}
		assert.equal(
			nodes.some((n) => n.type === "Button" && n.props.label === "Mark as applied"),
			false,
		);
		assert.ok(
			nodes.some(
				(n) =>
					n.type === "Text" &&
					n.props.children ===
						(kind === "recorded" || kind === "first version"
							? "Review checks recorded at first submission."
							: "Historical review checks unavailable."),
			),
		);
	}
});

test("native Apply copies unsaved drafts and opens first-submission or legacy recorded answers", async () => {
	const rootRequire = createRequire(root + "/package.json");
	const React = rootRequire("react");
	const { act } = React;
	const { Window } = await import(rootRequire.resolve("happy-dom"));
	const window = new Window();
	globalThis.window = window;
	globalThis.document = window.document;
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = rootRequire("react-dom/client");
	const primitives = ({ children }) => React.createElement("div", null, children);
	const button = ({ label, title, accessibilityLabel, onPress, disabled, children }) =>
		React.createElement(
			"button",
			{ onClick: onPress, disabled, "aria-label": label ?? title ?? accessibilityLabel },
			label ?? title ?? children,
		);
	const values = new Map();
	let copied;
	let savedItems = [];
	const data = { ...empty, answers: [{ id: "first", question: "Why?", answer: "", factIds: [] }] };
	const { Apply, saves } = load(data, {
		react: React,
		"react/jsx-runtime": rootRequire("react/jsx-runtime"),
		"react-native": { View: primitives, Pressable: button },
		"expo-router": { useRouter: () => ({}) },
		"expo-clipboard": {
			setStringAsync: async (text) => {
				copied = text;
			},
		},
		"@reactive-resume/schema/career": bundle("/packages/schema/src/career.ts"),
		"@reactive-resume/schema/application-answers": { answerLimit: () => null },
		"../hooks": {
			useWorkspace: () => ({
				data,
				current: () => data,
				save: (patch) => {
					saves.push(patch);
					return new Promise(() => {});
				},
			}),
			useDraft: (_key, initial) => {
				const [value, setValue] = React.useState(initial);
				return { value, setValue, clear: () => {} };
			},
			useAutosave: (value, _saved, save) => ({ flush: () => save(value) }),
			latest: () => undefined,
			useSavedItems: () => ({ data: savedItems }),
			useFacts: () => ({ data: [] }),
			useGenerate: () => ({}),
		},
		"../logic": bundle("/apps/mobile/src/features/workspace/logic.ts"),
		"../parts": {
			Block: ({ title, children, trailing }) => React.createElement("section", null, title, trailing, children),
			CheckRow: primitives,
			Actions: primitives,
			AiNotice: () => null,
			GenerateNotice: () => null,
			SaveError: () => null,
			useWorking: (_pending, _steps, fallback) => fallback,
			workingSteps: () => [],
		},
		"@/features/application-detail/sections": { WhatYouSent: () => null },
		"../preparation": { Preparation: () => null },
		"../answer-library": { AnswerLibrary: () => null },
		"@/features/ai/providers": { useHasAIProvider: () => ({}) },
		"@/features/applications/prior-no-response": { PriorNoResponse: () => null },
		"@/ui": {
			Button: button,
			IconButton: button,
			ListRow: button,
			Chip: button,
			Banner: () => null,
			Skeleton: () => null,
			Text: primitives,
			Sheet: ({ open, children }) => (open ? React.createElement("div", null, children) : null),
			TextArea: ({ label, value, onChangeText, onBlur }) => {
				values.set(label, onChangeText);
				return React.createElement("textarea", { "aria-label": label, value, readOnly: true, onBlur });
			},
			showToast: () => {},
			useTheme: () => ({ space: {}, colors: {}, radius: {} }),
		},
	});
	const container = window.document.createElement("div");
	window.document.body.append(container);
	const owner = createRoot(container);
	const find = (name) =>
		[...container.querySelectorAll("button")].find((node) => node.getAttribute("aria-label") === name);
	try {
		await act(async () => owner.render(React.createElement(Apply, { application })));
		assert.equal(find("Copy answers"), undefined);
		await act(async () => values.get("Why?")("First local answer"));
		assert.ok(find("Copy answers"));
		assert.ok(find("Download"));
		assert.equal(saves.length, 0);
		await act(async () => find("Copy answers").click());
		assert.equal(copied, "Why?\nFirst local answer");
		await act(async () =>
			container.querySelector("textarea").dispatchEvent(new window.FocusEvent("focusout", { bubbles: true })),
		);
		assert.equal(saves.length, 1);
		await act(async () => values.get("Why?")("   "));
		assert.equal(find("Copy answers"), undefined);
		assert.equal(find("Download"), undefined);
		const first = { id: "first-version", submission: true, data: { kind: "answers", answers: [] } };
		const later = { ...first, id: "later-version" };
		savedItems = [later, first];
		for (const kind of ["first receipt", "legacy"]) {
			data.submissionReview =
				kind === "legacy"
					? null
					: {
							at: "2026-11-03T10:00:00Z",
							checklist: [],
							documents: false,
							answers: true,
							answerVersionId: first.id,
						};
			let destination;
			await act(async () =>
				owner.render(
					React.createElement(Apply, {
						key: kind,
						application: { ...application, status: "applied" },
						go: (...args) => {
							destination = args;
						},
					}),
				),
			);
			await act(async () => find("View recorded answers").click());
			assert.deepEqual(destination, ["apply", { version: kind === "legacy" ? later.id : first.id }]);
		}
	} finally {
		await act(async () => owner.unmount());
		window.happyDOM.abort();
		delete globalThis.window;
		delete globalThis.document;
		delete globalThis.IS_REACT_ACT_ENVIRONMENT;
	}
});

function bundle(path) {
	const module = { exports: {} };
	new Function(
		"require",
		"module",
		"exports",
		buildSync({
			entryPoints: [root + path],
			bundle: true,
			platform: "node",
			format: "cjs",
			write: false,
		}).outputFiles[0].text,
	)(serverRequire, module, module.exports);
	return module.exports;
}
