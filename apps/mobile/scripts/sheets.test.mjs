// Exercise the shared sheet contract with deferred native presentation/dismissal callbacks.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const serverRequire = createRequire(new URL("../../server/package.json", import.meta.url));
const { transformSync } = createRequire(serverRequire.resolve("tsx"))("esbuild");
const hooks = [];
let cursor = 0;
let effects = [];
const react = {
	createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
	useRef(initial) {
		const index = cursor++;
		return (hooks[index] ??= { current: initial });
	},
	useState(initial) {
		const index = cursor++;
		if (!(index in hooks)) hooks[index] = initial;
		return [hooks[index], (value) => (hooks[index] = value)];
	},
	useEffect: (effect) => effects.push(effect),
	useCallback: (callback) => callback,
};
const theme = {
	colors: {},
	radius: {},
	size: { formSheet: 540 },
	space: { s2: 8, s3: 12, s4: 16, s6: 24 },
};
const tag = (parts, ...values) => parts.reduce((text, part, index) => text + part + (values[index] ?? ""), "");
const mocks = {
	react,
	"react-native": {
		AccessibilityInfo: { isScreenReaderEnabled: async () => false, addEventListener() {} },
		Platform: { OS: "ios" },
		StyleSheet: { hairlineWidth: 1 },
		useWindowDimensions: () => ({ height: 844, width: 390 }),
	},
	"react-native-reanimated": {},
	"react-native-worklets": {},
	"@lingui/react/macro": { useLingui: () => ({ t: tag }) },
	"@lodev09/react-native-true-sheet": { TrueSheet: "TrueSheet" },
	"./button": { Button: "Button" },
	"./motion": { haptics: { selection() {} }, useIsWide: () => false, useReducedMotion: () => false },
	"./safe-area": { useWindowSafeAreaInsets: () => ({ top: 44, bottom: 34 }) },
	"./text": { Text: "Text" },
	"./theme": { useTheme: () => theme },
};
const module = { exports: {} };
const code = transformSync(readFileSync(new URL("../src/ui/overlays.tsx", import.meta.url), "utf8"), {
	loader: "tsx",
	format: "cjs",
	jsx: "transform",
}).code;
new Function("React", "require", "module", "exports", code)(
	react,
	(name) => {
		assert.ok(name in mocks, `Missing boundary fixture: ${name}`);
		return mocks[name];
	},
	module,
	module.exports,
);
const { Sheet, EditorSheet } = module.exports;
const settle = async () => {
	for (let i = 0; i < 5; i++) await Promise.resolve();
};
let presents = 0;
let dismisses = 0;
let closes = 0;
let finishPresent;
const native = {
	present() {
		presents++;
		return new Promise((resolve) => {
			finishPresent = resolve;
		});
	},
	dismiss() {
		dismisses++;
		return Promise.resolve();
	},
};
const render = (component, props) => {
	cursor = 0;
	effects = [];
	const tree = component(props);
	if (component === Sheet) tree.props.ref.current = native;
	for (const effect of effects) effect();
	return tree;
};
const props = { open: false, onClose: () => closes++ };
render(Sheet, props);
assert.equal(presents, 0, "Closed sheets must not present on mount");
render(Sheet, { ...props, open: true });
render(Sheet, props);
assert.equal(dismisses, 0, "A close waits for native presentation to finish");
finishPresent();
await settle();
assert.equal(dismisses, 1);
let tree = render(Sheet, { ...props, open: true });
assert.equal(presents, 1, "Reopen waits for the previous dismissal callback");
tree.props.onDidDismiss();
assert.equal(presents, 2);
assert.equal(closes, 0, "A stale dismissal must not close a reopened sheet");
finishPresent();
await settle();
tree = render(Sheet, { ...props, open: true, dismissible: false });
assert.equal(tree.props.dismissible, false);
tree.props.onDidDismiss();
assert.equal(closes, 0, "Pending saves block incidental dismissal");
assert.equal(presents, 3);
finishPresent();
await settle();
tree = render(Sheet, { ...props, open: true });
tree.props.onDidDismiss();
assert.equal(closes, 1, "Interactive dismissal reaches the owning form once");

// Title-only sheets keep their accessible pane name without a heading under the grabber.
tree = render(Sheet, { ...props, title: "Document options" });
assert.equal(tree.props.header, undefined);
assert.equal(tree.props.accessibilityOptions.paneTitle, "Document options");
tree = render(Sheet, { ...props, title: "Edit", headerEnd: "Save" });
assert.ok(tree.props.header, "Sheets with header actions must preserve Save/Cancel controls");
assert.equal(tree.props.header.props.headerEnd, "Save");
const header = tree.props.header.type(tree.props.header.props);
assert.equal(header.props.style.paddingTop, theme.space.s6);
tree = render(Sheet, { ...props, scroll: false, children: "virtualized grid" });
assert.equal(tree.props.children[0].props.children[0], "virtualized grid");
assert.equal(tree.props.children[0].props.style.flex, 1);

hooks.length = 0;
const editor = { dirty: true, pending: false, onClose: () => closes++, children: "unsaved form" };
tree = render(EditorSheet, editor);
tree.props.children[0].props.onClose();
tree = render(EditorSheet, editor);
assert.equal(tree.props.children[0].props.open, false);
assert.equal(tree.props.children[1].props.open, true, "Dirty forms ask before discarding");
assert.equal(tree.props.children[0].props.children[0], "unsaved form");
tree.props.children[1].props.onCancel();
tree = render(EditorSheet, editor);
assert.equal(tree.props.children[0].props.open, true, "Keep editing reopens the existing owner");
assert.equal(tree.props.children[1].props.open, false);
tree = render(EditorSheet, { ...editor, pending: true });
tree.props.children[0].props.onClose();
assert.equal(closes, 1, "An explicit close cannot discard a pending save");
console.log("PASS deferred native presentation, rapid reopen, blocked dismissal and dirty-form preservation");
