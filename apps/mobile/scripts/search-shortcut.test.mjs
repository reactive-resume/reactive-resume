// Execute collection search and modal lifetimes through the shipped hardware-command owner. Host proof only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const serverRequire = createRequire(new URL("../../server/package.json", import.meta.url));
const { transformSync } = createRequire(serverRequire.resolve("tsx"))("esbuild");
const element = (type, props, ...children) => ({ type, props: { ...props, children } });
let current;
let cursor;
let focused = true;
let commands = [];
let dispatch;
const react = {
	createElement: element,
	useRef(initial) {
		const index = cursor++;
		return (current.hooks[index] ??= { current: initial });
	},
	useState(initial) {
		const index = cursor++;
		const hooks = current.hooks;
		if (!(index in hooks)) hooks[index] = initial;
		return [hooks[index], (value) => (hooks[index] = value)];
	},
	useCallback: (callback) => callback,
	useEffect(effect, deps) {
		const index = cursor++;
		const previous = current.hooks[index];
		if (deps && previous?.deps && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
		const hooks = current.hooks;
		current.effects.push(() => {
			previous?.cleanup?.();
			hooks[index] = { deps, cleanup: effect() };
		});
	},
};
const theme = {
	colors: {},
	radius: {},
	size: { hit: 44, icon: { row: 20 } },
	space: {},
	type: {},
	shadows: { e3: {} },
};
const mocks = {
	react,
	"expo-router": { useIsFocused: () => focused },
	"../../modules/key-commands": {
		keyCommands: {
			setCommands: (next) => (commands = next),
			addListener: (_event, listener) => (dispatch = listener),
		},
	},
	"react-native": {
		AccessibilityInfo: { isScreenReaderEnabled: async () => false, addEventListener() {} },
		StyleSheet: { hairlineWidth: 1 },
		TextInput: "TextInput",
		View: "View",
		I18nManager: { isRTL: false },
		Keyboard: { dismiss() {} },
		Platform: { OS: "ios" },
		useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
	},
	"@lingui/react/macro": { useLingui: () => ({ t: (parts) => parts.join("") }) },
	"@/ui": { useTheme: () => theme, Text: "Text", Icon: "Icon", IconButton: "IconButton" },
	"@lodev09/react-native-true-sheet": { TrueSheet: "TrueSheet" },
	"react-native-reanimated": {},
	"react-native-worklets": {},
	"./button": {},
	"./motion": { useIsWide: () => false, useReducedMotion: () => false },
	"./safe-area": { useWindowSafeAreaInsets: () => ({ top: 44 }) },
	"./text": { Text: "Text" },
	"./theme": { useTheme: () => theme },
};
function load(path) {
	const module = { exports: {} };
	const code = transformSync(readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8"), {
		loader: path.endsWith(".tsx") ? "tsx" : "ts",
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
const keyCommands = load("shell/key-commands.ts");
mocks["@/shell/key-commands"] = keyCommands;
const { CollectionHeader } = load("components/collection-header.tsx");
const { Sheet, ConfirmDialog } = load("ui/overlays.tsx");
function mount(component, props) {
	const instance = { hooks: [], effects: [] };
	return {
		render(next = props) {
			current = instance;
			cursor = 0;
			instance.effects = [];
			const tree = component(next);
			for (const effect of instance.effects) effect();
			return tree;
		},
		unmount() {
			for (const hook of instance.hooks) hook?.cleanup?.();
		},
	};
}
const nodes = (tree) =>
	!tree || typeof tree !== "object"
		? []
		: Array.isArray(tree)
			? tree.flatMap(nodes)
			: [tree, ...nodes(tree.props.children)];
const props = {
	title: "Applications",
	searchLabel: "Search applications",
	placeholder: "Role, company or contact",
	value: "",
	onChangeText() {},
};
const header = mount(CollectionHeader, props);
assert.equal(
	nodes(header.render()).some((node) => node.type === "TextInput"),
	false,
);
const searchId = commands.find((command) => command.input === "f").id;
header.render({ ...props, value: "Cedar" });
dispatch({ id: searchId });
let input = nodes(header.render({ ...props, value: "Cedar" })).find((node) => node.type === "TextInput");
assert.equal(input.props.autoFocus, true, "Hardware search must open and focus the collapsed search");
let focuses = 0;
input.props.ref.current = { focus: () => focuses++ };
header.render({ ...props, value: "Cedar" });
dispatch({ id: searchId });
assert.equal(focuses, 1, "Existing filtered search must regain focus");
input = nodes(header.render({ ...props, value: "Cedar" })).find((node) => node.type === "TextInput");
assert.equal(input.props.value, "Cedar", "Refocusing must preserve the filter");

const sheetProps = { open: true, onClose() {}, children: null };
const sheet = mount(Sheet, sheetProps);
sheet.render();
assert.deepEqual(commands, [], "An open sheet must release background shortcuts");
dispatch({ id: searchId });
assert.equal(focuses, 1, "A late native event must not focus a field behind a sheet");
const alertProps = { open: true, confirmLabel: "Delete", onConfirm() {}, onCancel() {} };
const alert = mount(ConfirmDialog, alertProps);
alert.render();
sheet.render({ ...sheetProps, open: false });
assert.deepEqual(commands, [], "Closing one overlay must preserve the other overlay's suspension");
alert.unmount();
assert.ok(commands.some((command) => command.input === "f"));
dispatch({ id: searchId });
assert.equal(focuses, 2, "Search must resume after the final overlay closes");
sheet.unmount();

header.render({ ...props, disabled: true });
assert.deepEqual(commands, []);
dispatch({ id: searchId });
assert.equal(focuses, 2, "Disabled search must ignore late native events");
header.render();
focused = false;
header.render();
assert.deepEqual(commands, [], "An unfocused screen must unregister its search shortcut");
header.unmount();
console.log("PASS native collection search focus, retained filter, nested modal suspension and screen lifetime");
