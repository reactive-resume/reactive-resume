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
const ready = (data) => ({ data, isPending: false, isError: false });
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

test("practice for an interview opens its exact round, directly for one and by explicit choice for several", () => {
	reset();
	const interview = (id) => ({
		id,
		company: id,
		status: "interview",
		activity: [{ id: `${id}-round`, at: "2030-11-04T10:00:00Z" }],
	});
	applications.data = [interview("job")];
	StoryPracticeButton({ story }).props.onPress();
	assert.deepEqual(calls, [
		{ id: "job", tab: "practise", search: { speak: true, story: "story", round: "job-round" } },
	]);
	reset();
	applications.data = [interview("first"), interview("second")];
	StoryPracticeButton({ story }).props.onChange("second-round");
	assert.deepEqual(calls, [
		{ id: "second", tab: "practise", search: { speak: true, story: "story", round: "second-round" } },
	]);
});

// canUseCareerStory's cases live in packages/schema/src/career-practice.test.ts; this proves the button uses it.
test("a story whose backing fact is switched off fails closed", () => {
	reset();
	facts.data = [{ ...fact, status: "excluded" }];
	const tree = StoryPracticeButton({ story });
	assert.equal(find(tree, "Button").props.disabled, true);
	assert.deepEqual(calls, []);
});
