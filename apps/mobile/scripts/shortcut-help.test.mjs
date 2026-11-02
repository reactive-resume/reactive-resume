// Native help UI adapter contract. Host execution, not hardware or device proof.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const serverRequire = createRequire(new URL("../../server/package.json", import.meta.url));
const { transformSync } = createRequire(serverRequire.resolve("tsx"))("esbuild");
const element = (type, props, ...children) => ({ type, props: { ...props, children } });
const nodes = (tree) =>
	!tree || typeof tree !== "object"
		? []
		: Array.isArray(tree)
			? tree.flatMap(nodes)
			: [tree, ...nodes(tree.props.children)];
let registered = [{ id: "search", input: "f", title: "Search fictional collection" }];
let bindings;
let returnedFocus = null;
let focusedInput = null;
const stored = new Map();
let failStorage = false;
const react = { createElement: element, useRef: () => ({ current: null }) };
const mocks = {
	react,
	"@lingui/react/macro": { useLingui: () => ({ t: (parts) => parts.join("") }) },
	"expo-sqlite/kv-store": {
		getItemSync: (key) => stored.get(key),
		setItemSync: (key, value) => {
			if (failStorage) throw new Error("Storage unavailable");
			stored.set(key, value);
		},
	},
	"react-native": {
		TextInput: { State: { currentlyFocusedInput: () => focusedInput } },
		View: "View",
		Platform: { OS: "ios" },
		AccessibilityInfo: {
			sendAccessibilityEvent: (handle, type) => {
				assert.equal(type, "focus");
				returnedFocus = handle;
			},
		},
	},
	zustand: {
		create: (initialize) => {
			let state;
			const set = (value) => {
				state = { ...state, ...value };
			};
			state = initialize(set);
			const useStore = () => state;
			useStore.getState = () => state;
			return useStore;
		},
	},
	"./key-commands": {
		getRegisteredKeyCommands: () => registered,
		useKeyCommands: (next) => {
			bindings = next;
		},
	},
	"@/ui": {
		Button: "Button",
		IconButton: "IconButton",
		Sheet: "Sheet",
		Switch: "Switch",
		Text: "Text",
		useTheme: () => ({ space: {} }),
	},
};
function load() {
	const module = { exports: {} };
	const code = transformSync(readFileSync(new URL("../src/shell/shortcut-help.tsx", import.meta.url), "utf8"), {
		loader: "tsx",
		format: "cjs",
		jsx: "transform",
	}).code;
	new Function("React", "require", "module", "exports", code)(
		react,
		(name) => {
			assert.ok(name in mocks, `Missing native boundary: ${name}`);
			return mocks[name];
		},
		module,
		module.exports,
	);
	return module.exports;
}
let { KeyboardShortcuts, ShortcutHelpButton, CharacterShortcutSetting } = load();
KeyboardShortcuts();
assert.equal(bindings[0].input, "?");
assert.equal(bindings[0].modifier, "none");
let searchRefocused = 0;
focusedInput = { focus: () => searchRefocused++ };
bindings[0].run();
let sheet = KeyboardShortcuts();
assert.equal(sheet.props.open, true);
assert.equal(bindings.length, 0, "Help must not reopen from a late background command while its sheet is open");
assert.ok(
	nodes(sheet).some((node) => node.props.children.includes("Search fictional collection")),
	"Help must render the registry's current titles",
);
registered = [];
assert.ok(
	nodes(KeyboardShortcuts()).some((node) => node.props.children.includes("Search fictional collection")),
	"The sheet keeps the pre-blocker snapshot",
);
sheet.props.onClose();
sheet.props.onDismissed();
assert.equal(searchRefocused, 1, "Help opened from search restores the native text-input focus");
focusedInput = null;

registered = [{ id: "download", input: "p", shift: true, title: "Download fictional document" }];
const trigger = ShortcutHelpButton();
const handle = {};
trigger.props.ref.current = handle;
trigger.props.onPress();
sheet = KeyboardShortcuts();
assert.ok(nodes(sheet).some((node) => node.props.children.includes("Download fictional document")));
assert.ok(
	!nodes(sheet).some((node) => node.props.children.includes("Search fictional collection")),
	"Opening on another screen refreshes the snapshot",
);
assert.equal(returnedFocus, null);
nodes(CharacterShortcutSetting())
	.find((node) => node.type === "Switch")
	.props.onValueChange(false);
assert.equal(stored.get("character-shortcuts"), "off");
sheet.props.onClose();
assert.equal(returnedFocus, null, "Focus must wait until the native sheet has dismissed");
sheet.props.onDismissed();
assert.equal(returnedFocus, handle);
KeyboardShortcuts();
assert.equal(bindings.length, 0);
({ KeyboardShortcuts, ShortcutHelpButton, CharacterShortcutSetting } = load());
KeyboardShortcuts();
assert.equal(bindings.length, 0, "The off preference survives module startup");
ShortcutHelpButton().props.onPress();
sheet = KeyboardShortcuts();
assert.equal(sheet.props.open, true, "The visible entry must work when ? is off");
failStorage = true;
nodes(CharacterShortcutSetting())
	.find((node) => node.type === "Switch")
	.props.onValueChange(true);
sheet.props.onClose();
KeyboardShortcuts();
assert.equal(bindings[0].input, "?", "A failed preference write still applies for this session");
console.log(
	"PASS native help registry snapshot, screen refresh, dismissal focus return, keyboard off switch and storage failure",
);
