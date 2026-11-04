// Native character-shortcut preference contract. Host execution, not hardware or device proof.
import assert from "node:assert/strict";
import * as harness from "./harness.mjs";

const element = (type, props, ...children) => ({ type, props: { ...props, children } });
const nodes = (tree) =>
	!tree || typeof tree !== "object"
		? []
		: Array.isArray(tree)
			? tree.flatMap(nodes)
			: [tree, ...nodes(tree.props.children)];
const registered = [{ id: "search", input: "f", title: "Search fictional collection" }];
let bindings;
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
		TextInput: { State: { currentlyFocusedInput: () => null } },
		View: "View",
		Platform: { OS: "ios" },
		AccessibilityInfo: { sendAccessibilityEvent() {} },
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
const load = () =>
	harness.load("../src/shell/shortcut-help.tsx", mocks, { jsx: "transform", globals: { React: react } });
let { KeyboardShortcuts, ShortcutHelpButton, CharacterShortcutSetting } = load();
nodes(CharacterShortcutSetting())
	.find((node) => node.type === "Switch")
	.props.onValueChange(false);
assert.equal(stored.get("character-shortcuts"), "off");
KeyboardShortcuts();
assert.equal(bindings.length, 0);
({ KeyboardShortcuts, ShortcutHelpButton, CharacterShortcutSetting } = load());
KeyboardShortcuts();
assert.equal(bindings.length, 0, "The off preference survives module startup");
ShortcutHelpButton().props.onPress();
const sheet = KeyboardShortcuts();
assert.equal(sheet.props.open, true, "The visible entry must work when ? is off");
failStorage = true;
nodes(CharacterShortcutSetting())
	.find((node) => node.type === "Switch")
	.props.onValueChange(true);
sheet.props.onClose();
KeyboardShortcuts();
assert.equal(bindings[0].input, "?", "A failed preference write still applies for this session");
console.log(
	"PASS native character-shortcut switch persists across startup, keeps the visible help entry and applies when storage fails",
);
