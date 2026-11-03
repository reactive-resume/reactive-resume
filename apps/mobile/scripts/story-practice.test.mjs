// Exercise the shipped Practice entry. Native platform/navigation/query boundaries are explicit host substitutes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../..", import.meta.url));
const req = createRequire(`${root}/apps/server/package.json`);
const { buildSync } = createRequire(req.resolve("tsx"))("esbuild");
const jsx = (type, props) => ({ type, props });
const tag = (parts, ...values) =>
	Array.isArray(parts) ? parts.reduce((text, part, i) => text + part + (values[i] ?? ""), "") : parts.message;
let facts;
let applications;
let calls;
const deps = {
	"@lingui/react/macro": { useLingui: () => ({ t: tag }) },
	"expo-router": {
		useRouter: () => ({ push: (href) => calls.push(href), setParams: (params) => calls.push({ params }) }),
	},
	react: { useState: () => [null, () => {}] },
	"react/jsx-runtime": { jsx, jsxs: jsx },
	"react-native": { View: "View" },
	"./hooks": {
		useNow: () => new Date("2030-11-03T09:00:00Z"),
		useCareerTime: () => ({ when: (at) => at.toISOString() }),
	},
	"./scheduling": {
		collectInterviews: (rows, now) =>
			rows
				.filter((row) => row.status !== "closed")
				.flatMap((application) =>
					application.activity.map((interview) => ({ application, interview, start: new Date(interview.at) })),
				)
				.filter((item) => item.start >= now),
	},
	"@/features/applications/queries": { useApplications: () => applications },
	"@/features/workspace/hooks": {
		useFacts: (id) => {
			assert.equal(id, null);
			return facts;
		},
	},
	"@/features/workspace/shell": { workspaceHref: (id, tab, search) => ({ id, tab, search }) },
	"@/ui": { Banner: "Banner", Button: "Button", SelectSheet: "SelectSheet", Text: "Text" },
};
const file = `${root}/apps/mobile/src/features/career/story-practice-button.tsx`;
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
		assert.ok(name in deps, name);
		return deps[name];
	},
	mod,
	mod.exports,
);
const { StoryPracticeButton } = mod.exports;
const fact = { id: "shared", status: "active", applicationId: null, updatedAt: "2030-11-01", revisions: [] };
const story = { id: "story", applicationId: null, updatedAt: "2030-11-02", data: { factIds: [fact.id] } };
const ready = (data) => ({ data, isPending: false, isError: false, refetch: () => calls.push("retry") });
function reset() {
	calls = [];
	facts = ready([fact]);
	applications = ready([]);
}
function find(tree, type) {
	if (!tree || typeof tree !== "object") return undefined;
	if (tree.type === type) return tree;
	return (Array.isArray(tree.props?.children) ? tree.props.children : [tree.props?.children])
		.map((child) => find(child, type))
		.find(Boolean);
}

test("no interview opens shared story practice without a fabricated application", () => {
	reset();
	const tree = StoryPracticeButton({ story });
	assert.equal(tree.type, "Button");
	assert.equal(tree.props.disabled, undefined);
	tree.props.onPress();
	assert.deepEqual(calls, [{ params: { practice: "story" } }]);
});

test("one named interview preserves the selected story and exact round", () => {
	reset();
	applications.data = [
		{
			id: "job",
			company: "Fictional Cedar",
			status: "interview",
			activity: [{ id: "round", at: "2030-11-04T10:00:00Z" }],
		},
	];
	const tree = StoryPracticeButton({ story });
	assert.equal(tree.props.label, "Practice for Fictional Cedar");
	tree.props.onPress();
	assert.deepEqual(calls, [{ id: "job", tab: "practise", search: { speak: true, story: "story", round: "round" } }]);
});

test("several interviews offer an explicit round choice", () => {
	reset();
	applications.data = ["first", "second"].map((id) => ({
		id,
		company: id,
		status: "interview",
		activity: [{ id: `${id}-round`, at: "2030-11-04T10:00:00Z" }],
	}));
	const tree = StoryPracticeButton({ story });
	assert.equal(tree.type, "SelectSheet");
	assert.equal(tree.props.options.length, 2);
	tree.props.onChange("second-round");
	assert.equal(calls[0].id, "second");
	assert.equal(calls[0].search.round, "second-round");
});

test("missing, private, excluded and changed backing facts fail closed", () => {
	for (const data of [
		[],
		[{ ...fact, applicationId: "private-job" }],
		[{ ...fact, status: "excluded" }],
		[{ ...fact, revisions: [{}], updatedAt: "2030-11-03" }],
	]) {
		reset();
		facts.data = data;
		const tree = StoryPracticeButton({ story });
		assert.equal(find(tree, "Button").props.disabled, true);
		assert.deepEqual(calls, []);
	}
});

test("failed or loading reads do not offer a misleading practice action", () => {
	reset();
	applications.isPending = true;
	assert.equal(StoryPracticeButton({ story }).props.disabled, true);
	applications.isPending = false;
	facts.isError = true;
	const tree = StoryPracticeButton({ story });
	assert.equal(tree.type, "Banner");
	tree.props.action.onPress();
	assert.deepEqual(calls, ["retry", "retry"]);
});
