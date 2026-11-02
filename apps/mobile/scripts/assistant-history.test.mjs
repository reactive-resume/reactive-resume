import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const serverRequire = createRequire(`${root}/apps/server/package.json`);
const { buildSync } = createRequire(serverRequire.resolve("tsx"))("esbuild");
const jsx = (type, props) => ({ type, props });
const dependencies = {
	"react/jsx-runtime": { jsx, jsxs: jsx },
	react: { useState: (value) => [value, () => {}] },
	"react-native": { ScrollView: "ScrollView", View: "View" },
	"@lingui/core/macro": { plural: (_count, options) => options.other.replace("#", "2") },
	"@lingui/react/macro": {
		Trans: "Trans",
		useLingui: () => ({
			t: (pieces, ...values) => pieces.reduce((text, part, index) => text + part + (values[index] ?? ""), ""),
			i18n: { locale: "en-US" },
		}),
	},
	"@tanstack/react-query": { useQueryClient: () => ({}) },
	"./chat": { refreshThreads: () => {} },
	"@/api/client": { client: {} },
	"@/auth/session": { getAccountScope: () => "fixture-account" },
	"@/ui": {
		ConfirmDialog: "ConfirmDialog",
		IconButton: "IconButton",
		ListRow: "ListRow",
		Text: "Text",
		showToast: () => {},
		useTheme: () => ({ space: {} }),
	},
};
const code = buildSync({
	entryPoints: [`${root}/apps/mobile/src/features/assistant/threads.tsx`],
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
		assert.ok(name in dependencies, `Unexpected dependency ${name}`);
		return dependencies[name];
	},
	module,
	module.exports,
);

test("native history retains task title, original-message subtitle and open action, including old servers", () => {
	const thread = {
		id: "history-thread",
		title: "Tailor summary to payments roles",
		firstMessage: "I'm applying for payments roles. Please tailor my summary.",
		lastMessageAt: "2026-11-02T12:00:00Z",
		editsProposed: 2,
		editsAccepted: 1,
	};
	for (const firstMessage of [thread.firstMessage, null, undefined]) {
		const opened = [];
		const tree = module.exports.PastConversations({
			threads: [{ ...thread, firstMessage }],
			isMine: () => true,
			currentId: thread.id,
			onOpen: (value) => opened.push(value.id),
			onDeleted: () => {},
		});
		const section = tree.props.children[0];
		const row = section.props.children[0];
		assert.equal(row.props.title, thread.title);
		assert.ok(row.props.subtitle.includes("1 of 2 edits accepted"));
		assert.equal(row.props.subtitle.startsWith(`${thread.firstMessage}\n`), !!firstMessage);
		assert.ok(!row.props.subtitle.includes("undefined"));
		assert.equal(row.props.selected, true);
		row.props.onPress();
		assert.deepEqual(opened, [thread.id]);
	}
});
