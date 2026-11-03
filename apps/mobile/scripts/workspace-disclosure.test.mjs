// Render the actual native AI notice across Knowledge query states. No device or provider traffic.
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { bundle, tag as t } from "./harness.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const load = (file, deps) => bundle(file, deps, { absWorkingDir: root });
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
		"expo-router": { useRouter: () => ({ push: () => {} }) },
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
