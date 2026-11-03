// Actual native review component and shared proposal/recovery logic. HTTP and native widgets are boundaries.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../..", import.meta.url));
const req = createRequire(`${root}/apps/mobile/package.json`);
const { buildSync } = createRequire(createRequire(`${root}/apps/server/package.json`).resolve("tsx"))("esbuild");
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
const t = (parts, ...values) => parts.reduce((out, part, index) => out + part + (values[index] ?? ""), "");
let env;
const Button = ({ label, onPress, disabled }) => h("button", { disabled, onClick: onPress }, label);
const TextArea = ({ label, value, onChangeText, editable, maxLength }) =>
	h("textarea", {
		"aria-label": label,
		value,
		disabled: editable === false,
		maxLength,
		onChange: (event) => onChangeText(event.target.value),
	});
const View = ({ children }) => h("div", null, children);
const mocks = {
	react: React,
	"react/jsx-runtime": req("react/jsx-runtime"),
	"react-native": { View },
	"expo-crypto": { randomUUID: () => "new-answer" },
	"@lingui/react/macro": { useLingui: () => ({ t }) },
	"expo-router": { useRouter: () => ({ push() {} }) },
	"@/routes": { routes: { assistant: (id) => `/builder/${id}/assistant` } },
	"@/features/ai/report-content": { ReportAiContent: () => null },
	"@/auth/session": { getAccountScope: () => env.scope },
	"./hooks": {
		useDraft: (name, initial) => {
			const key = `${env.scope}:${name}`;
			const [value, setValue] = React.useState(() => env.drafts.get(key) ?? initial);
			return {
				value,
				setValue: (update) =>
					setValue((previous) => {
						const next = typeof update === "function" ? update(previous) : update;
						env.drafts.set(key, JSON.parse(JSON.stringify(next)));
						return next;
					}),
			};
		},
		useWorkspace: () => ({
			settled: async () => env.workspace,
			save: async (patch, expected) => {
				env.writes.push({ patch, expected });
				env.workspace = { ...env.workspace, ...patch };
				return { ok: true };
			},
		}),
		workspaceError: () => "Couldn't complete this action. Try again.",
	},
	"@/features/assistant/messages": {
		ChangeSet: ({ proposals, onAccept, locked }) =>
			h(
				"div",
				null,
				proposals.map((proposal) =>
					h(
						"button",
						{ key: proposal.id, disabled: locked, onClick: () => onAccept([proposal]) },
						`Accept ${proposal.id}`,
					),
				),
			),
	},
	"@/ui": {
		Button,
		Text: View,
		TextArea,
		showToast: (notice) => env.errors.push(notice),
		useTheme: () => ({ space: {} }),
	},
	"@/api/client": {
		client: {
			applications: {
				ai: {
					prepare: async (input) => {
						env.requests.push(input);
						if (env.hold) return env.hold;
						return structuredClone(env.result);
					},
				},
			},
			resume: {
				update: async (input) => {
					env.resumes.push(input);
					if (env.conflict) throw new Error("conflict");
					return { ...env.result.resume, ...input, updatedAt: new Date("2026-11-03T12:01:00Z") };
				},
			},
			coverLetters: {
				update: async (input) => {
					env.letters.push(input);
					return { ...input, revision: input.expectedRevision + 1 };
				},
			},
			agent: { messages: { setEditStatus: async () => {} }, threads: { get: async () => ({ messages: [] }) } },
		},
	},
};
const code = buildSync({
	stdin: {
		contents: `export {PrepareReview} from "./apps/mobile/src/features/workspace/prepare-review"; export {sampleResumeData} from "./packages/schema/src/resume/sample";`,
		resolveDir: root,
		loader: "ts",
	},
	bundle: true,
	platform: "node",
	format: "cjs",
	jsx: "automatic",
	write: false,
	external: Object.keys(mocks),
	absWorkingDir: root,
}).outputFiles[0].text;
const mod = { exports: {} };
new Function("require", "module", "exports", code)(
	(name) => {
		assert.ok(name in mocks, name);
		return mocks[name];
	},
	mod,
	mod.exports,
);
const { PrepareReview, sampleResumeData } = mod.exports;
const app = { id: "job", resumeId: "base", jobDescription: "Fictional posting", requirements: [] };
function setup() {
	const data = structuredClone(sampleResumeData);
	data.summary.content = "<p>Built services.</p>";
	env = {
		scope: "alice",
		drafts: new Map(),
		workspace: { answers: [{ id: "existing", question: "Original", answer: "Unsaved parent answer", factIds: [] }] },
		requests: [],
		resumes: [],
		letters: [],
		writes: [],
		errors: [],
		conflict: false,
		result: {
			threadId: "thread",
			generationStatus: "ready",
			resume: { id: "copy", data, updatedAt: new Date("2026-11-03T12:00:00Z"), isLocked: false, aiOperationIds: [] },
			sets: [
				{
					messageId: "message",
					toolCallId: "call",
					title: "Clear wording",
					tailoredFor: "job",
					edits: [
						{
							id: "proposal",
							target: { sectionId: "summary", field: "content" },
							location: "Summary",
							before: "<p>Built services.</p>",
							after: "<p>Built reliable services.</p>",
							why: "Clear",
							status: "pending",
						},
					],
					skipped: [],
					aiOperationIds: ["op-tailor"],
				},
			],
			letter: {
				document: { id: "letter", content: "", revision: 1, aiOperationIds: [] },
				text: "Fictional letter draft",
				aiOperationIds: ["op-letter"],
			},
			answers: [
				{
					question: "Why this role?",
					answer: { answer: "Fictional answer", factIds: [], aiOperationIds: ["op-answer"] },
					note: null,
				},
			],
			failed: [],
		},
	};
	return render(h(PrepareReview, { application: app, disabled: false }));
}
const click = async (name) => {
	await act(async () => fireEvent.click(screen.getByRole("button", { name })));
};
test("native Prepare keeps all outputs editable, applies only approved proposals, preserves parent answers, and recovers unsaved drafts", async () => {
	const mounted = setup();
	await act(async () =>
		fireEvent.change(screen.getByLabelText("Form questions (optional)"), { target: { value: "Why this role?" } }),
	);
	await click("Prepare drafts for review");
	assert.deepEqual(env.requests, [{ id: "job", questions: ["Why this role?"] }]);
	assert.equal(env.resumes.length + env.letters.length + env.writes.length, 0);
	await click("Accept proposal");
	assert.equal(env.resumes[0].data.summary.content, "<p>Built reliable services.</p>");
	assert.deepEqual(env.resumes[0].proposalApplications, { proposal: "<p>Built reliable services.</p>" });
	await click("Undo");
	assert.equal(env.resumes[1].data.summary.content, "<p>Built services.</p>");
	assert.deepEqual(env.resumes[1].proposalApplications, { proposal: false });
	await act(async () =>
		fireEvent.change(screen.getByLabelText("Letter draft"), { target: { value: "Edited fictional letter" } }),
	);
	mounted.unmount();
	render(h(PrepareReview, { application: app, disabled: false }));
	assert.equal(screen.getByLabelText("Letter draft").value, "Edited fictional letter");
	await click("Keep letter");
	assert.equal(env.letters[0].content, "<p>Edited fictional letter</p>");
	assert.deepEqual(env.letters[0].aiOperationIds, ["op-letter"]);
	await click("Keep answer");
	assert.equal(env.workspace.answers[0].answer, "Unsaved parent answer");
	assert.equal(env.workspace.answers[1].answer, "Fictional answer");
	assert.deepEqual(env.workspace.answers[1].aiOperationIds, ["op-answer"]);
	cleanup();
});
test("native Prepare bounds complete questions, reports version conflicts, and ignores late account completion", async () => {
	const mounted = setup();
	await act(async () =>
		fireEvent.change(screen.getByLabelText("Form questions (optional)"), {
			target: { value: Array(6).fill("Question").join("\n\n") },
		}),
	);
	assert.equal(screen.getByRole("button", { name: "Prepare drafts for review" }).disabled, true);
	assert.equal(env.requests.length, 0);
	await act(async () =>
		fireEvent.change(screen.getByLabelText("Form questions (optional)"), { target: { value: "Why?" } }),
	);
	await click("Prepare drafts for review");
	env.conflict = true;
	await click("Accept proposal");
	assert.equal(env.errors.length, 1);
	assert.equal(env.resumes.length, 1);
	cleanup();
	setup();
	let resolve;
	env.hold = new Promise((done) => {
		resolve = done;
	});
	await click("Prepare drafts for review");
	env.scope = "bob";
	await act(async () => resolve(structuredClone(env.result)));
	assert.equal(screen.queryByLabelText("Letter draft"), null);
	assert.equal(env.resumes.length, 0);
	mounted.unmount();
	cleanup();
});
