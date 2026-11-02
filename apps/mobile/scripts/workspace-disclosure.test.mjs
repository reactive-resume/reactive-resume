// Render the actual native AI notice across Knowledge query states. No device or provider traffic.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const req = createRequire(`${root}/apps/server/package.json`);
const { buildSync } = createRequire(req.resolve("tsx"))("esbuild");

function load(file, deps) {
	const code = buildSync({
		stdin: {
			contents: readFileSync(file, "utf8"),
			sourcefile: file,
			resolveDir: file.slice(0, file.lastIndexOf("/")),
			loader: "tsx",
		},
		bundle: true,
		platform: "node",
		format: "cjs",
		write: false,
		external: Object.keys(deps),
		jsx: "automatic",
		absWorkingDir: root,
	}).outputFiles[0].text;
	const mod = { exports: {} };
	new Function("require", "module", "exports", code)(
		(name) => {
			assert.ok(name in deps, `unexpected dependency ${name} in ${file}`);
			return deps[name];
		},
		mod,
		mod.exports,
	);
	return mod.exports;
}

const t = (pieces, ...values) => pieces.reduce((text, part, i) => text + part + (values[i] ?? ""), "");
const i18n = { locale: "en-US" };
const jsx = (type, props) => ({ type, props });

const application = {
	id: "app-1",
	resumeId: "resume-1",
	coverLetterId: null,
	jobDescription: "Posting",
	requirements: [],
	notes: "Notes",
	contacts: [{ name: "Maya" }],
};

function sentenceOf(tree) {
	const strings = [];
	const walk = (node) => {
		if (typeof node === "string") return strings.push(node);
		if (Array.isArray(node)) return node.forEach(walk);
		if (!node || typeof node !== "object") return;
		walk(node.props?.children);
	};
	walk(tree);
	return strings.find((value) => value.includes("Sends ")) ?? "";
}

const pending = { data: undefined, isPending: true, isError: false };
const errored = { data: undefined, isPending: false, isError: true };
const empty = { data: [], isPending: false, isError: false };
const filled = { data: [{ id: "fact-1" }], isPending: false, isError: false };
function nativeLine(query) {
	const components = [
		"ActivityIndicator",
		"Banner",
		"Block",
		"Button",
		"Card",
		"Icon",
		"Pressable",
		"PrivacyLine",
		"ReportAiContent",
		"Switch",
		"Text",
		"View",
	];
	const ui = Object.fromEntries(components.map((name) => [name, (props) => jsx(name, props)]));
	const { AiNotice } = load(`${root}/apps/mobile/src/features/workspace/parts.tsx`, {
		"@lingui/core/macro": { t },
		"@lingui/react/macro": { useLingui: () => ({ t, i18n }) },
		react: { useEffect: () => {}, useState: (init) => [typeof init === "function" ? init() : init, () => {}] },
		"react-native": {
			ActivityIndicator: (p) => jsx("ActivityIndicator", p),
			Pressable: (p) => jsx("Pressable", p),
			View: (p) => jsx("View", p),
		},
		"react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
		"./hooks": { useFacts: () => query.facts, useStories: () => query.stories },
		"@/features/ai/providers": {
			useHasAIProvider: () => ({
				defaultProvider: { label: "Provider", id: "p", model: "m" },
				isLoading: false,
				error: null,
				retry: () => {},
			}),
			AIProviderSetupSheet: (p) => jsx("AIProviderSetupSheet", p),
		},
		"@/features/ai/report-content": { ReportAiContent: (p) => jsx("ReportAiContent", p) },
		"@/ui": ui,
		"@/shell/workspace-tab-label": { workspaceTabLabel: (label) => label },
	});
	return sentenceOf(AiNotice({ task: "briefing", application, interview: true }));
}

for (const [name, facts, stories, expected] of [
	["pending", pending, pending, true],
	["facts pending", pending, empty, true],
	["stories pending", empty, pending, true],
	["facts failed", errored, empty, true],
	["stories failed", empty, errored, true],
	["both empty", empty, empty, false],
	["facts present", filled, empty, true],
	["stories present", empty, filled, true],
]) {
	test(`AI notice discloses Knowledge when ${name}`, () => {
		const line = nativeLine({ facts, stories });
		assert.match(line, /Sends .*interview details.*Provider/);
		assert.equal(line.includes("Knowledge"), expected, line);
	});
}
