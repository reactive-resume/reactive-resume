import assert from "node:assert/strict";
import { test } from "node:test";
import { bundle, tag } from "./harness.mjs";

const jsx = (type, props) => ({ type, props });
const dependencies = {
	"react/jsx-runtime": { jsx, jsxs: jsx },
	react: { useState: (value) => [value, () => {}] },
	"react-native": { ScrollView: "ScrollView", View: "View" },
	"@lingui/core/macro": { plural: (_count, options) => options.other.replace("#", "2") },
	"@lingui/react/macro": {
		Trans: "Trans",
		useLingui: () => ({
			t: tag,
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
const load = (file, dependencies) => bundle(`../src/${file}`, dependencies);
const { PastConversations } = load("features/assistant/threads.tsx", dependencies);

test("native history retains task title, original-message subtitle and open action, including old servers", () => {
	const thread = {
		id: "history-thread",
		title: "Tailor summary to payments roles",
		firstMessage: "I'm applying for payments roles. Please tailor my summary.",
		lastMessageAt: "2026-11-02T12:00:00Z",
		editsProposed: 2,
		editsAccepted: 1,
	};
	for (const firstMessage of [thread.firstMessage, "Long opening message ".repeat(8).slice(0, 160), null, undefined]) {
		const opened = [];
		const tree = PastConversations({
			threads: [{ ...thread, firstMessage }],
			isMine: () => true,
			currentId: thread.id,
			onOpen: (value) => opened.push(value.id),
			onDeleted: () => {},
		});
		const section = tree.props.children[0];
		const row = section.props.children[0];
		assert.equal(row.props.title, thread.title);
		assert.equal(typeof row.props.subtitle, "object", "preview and metadata need separate native Text nodes");
		const parts = row.props.subtitle.props.children.filter(Boolean);
		const metadata = parts.at(-1);
		assert.ok(metadata.props.children.includes("1 of 2 edits accepted"));
		assert.equal(metadata.props.numberOfLines, undefined, "preview truncation must not hide metadata");
		assert.equal(parts.length, firstMessage ? 2 : 1);
		if (firstMessage) {
			assert.equal(parts[0].props.children, firstMessage);
			assert.equal(parts[0].props.numberOfLines, 1);
			assert.equal(parts[0].props.ellipsizeMode, "tail");
		}
		assert.equal(row.props.selected, true);
		row.props.onPress();
		assert.deepEqual(opened, [thread.id]);
	}
});

test("ListRow preserves separately bounded preview elements and existing string subtitles at larger fonts", () => {
	let fontScale = 1;
	const { ListRow } = load("ui/layout.tsx", {
		...dependencies,
		"react-native": {
			Platform: { OS: "ios" },
			Pressable: "Pressable",
			StyleSheet: { hairlineWidth: 1 },
			View: "View",
			useWindowDimensions: () => ({ fontScale }),
		},
		"expo-image": {},
		"react-native-reanimated": {},
		"@reactive-resume/utils/string": {},
		"./button": {},
		"./icon": { Icon: "Icon" },
		"./motion": {},
		"./pressable": {},
		"./text": { Text: "Text" },
		"./theme": {
			useTheme: () => ({ colors: {}, size: { row: 48, icon: {} }, space: { s1: 4, s2: 8, s3: 12, s4: 16 } }),
		},
	});
	const nodes = (tree) =>
		Array.isArray(tree)
			? tree.flatMap(nodes)
			: tree && typeof tree === "object"
				? [tree, ...nodes(tree.props?.children)]
				: [];
	const preview = jsx("Text", { children: "Long opening message", numberOfLines: 1, ellipsizeMode: "tail" });
	const metadata = jsx("Text", { children: "Today · no edits" });
	const richSubtitle = jsx("View", { children: [preview, metadata] });
	for (fontScale of [1, 2]) {
		for (const subtitle of [richSubtitle, "Existing subtitle", "", undefined]) {
			const tree = ListRow({ title: "Task", subtitle });
			const text = nodes(tree).filter((node) => node.type === "Text");
			assert.deepEqual(
				text.map((node) => node.props.children),
				subtitle === richSubtitle
					? ["Task", preview.props.children, metadata.props.children]
					: subtitle
						? ["Task", subtitle]
						: ["Task"],
			);
		}
	}
});
