// Exercises native Checklist output and handlers on the host; no device/runtime claim.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const root = new URL("../../..", import.meta.url).pathname;
const serverRequire = createRequire(root + "/apps/server/package.json");
const { buildSync, transformSync } = createRequire(serverRequire.resolve("tsx"))("esbuild");
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
const tag = (parts, ...values) => parts.reduce((out, part, i) => out + part + (values[i] ?? ""), "");
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

function render(data, readOnly = false) {
	const saves = [];
	const dependencies = {
		"@lingui/core/macro": { plural: (n, forms) => forms.other.replace("#", String(n)) },
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
		"@/features/ai/providers": {},
		"@/features/application-detail/sections": {},
		"@/features/applications/prior-no-response": { PriorNoResponse: "PriorNoResponse" },
		"@/features/applications/queries": { useInvalidateApplications: () => () => {} },
		"@/features/career/undo": {},
		"@/features/documents/queries": { useDocuments: () => ({ data: [] }) },
		"@/routes": {},
		"@/ui": { Button: "Button", Text: "Text", Sheet: "Sheet", ListRow: "ListRow", useTheme: () => ({ space: {} }) },
	};
	const code = transformSync(readFileSync(root + "/apps/mobile/src/features/workspace/tabs/apply.tsx", "utf8"), {
		loader: "tsx",
		format: "cjs",
		jsx: "automatic",
	}).code;
	const module = { exports: {} };
	new Function("require", "module", "exports", code + "\nmodule.exports.Checklist = Checklist;")(
		(name) => {
			assert.ok(name in dependencies, name);
			return dependencies[name];
		},
		module,
		module.exports,
	);
	const tree = module.exports.Checklist({
		application,
		answers: data.answers,
		currentAnswers: () => data.answers,
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
	for (const kind of ["recorded", "legacy", "version"]) {
		const data = {
			...empty,
			checklist: [0],
			submissionReview:
				kind === "legacy" ? null : { at: "2026-11-03T10:00:00Z", checklist: [1], documents: false, answers: true },
		};
		const { tree, nodes } = render(data, kind === "version");
		assert.equal(tree.props.trailing, undefined);
		const checks = nodes.filter((n) => n.type === "CheckRow");
		assert.equal(checks.length, kind === "recorded" ? 2 : 0);
		if (kind === "recorded") {
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
						(kind === "recorded"
							? "Review checks recorded at first submission."
							: "Historical review checks unavailable."),
			),
		);
	}
});
