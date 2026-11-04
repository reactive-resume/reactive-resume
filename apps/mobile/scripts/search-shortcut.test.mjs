// Execute collection search and modal lifetimes through the shipped hardware-command owner. Host proof only.
import assert from "node:assert/strict";
import * as harness from "./harness.mjs";

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
	"@/shell/shortcut-help": { ShortcutHelpButton: "ShortcutHelpButton" },
	react,
	"expo-router": { useIsFocused: () => focused },
	"../../modules/key-commands": {
		keyCommands: {
			supportsUnmodifiedCommands: true,
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
const load = (path) => harness.load(`../src/${path}`, mocks, { jsx: "transform", globals: { React: react } });
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

let dismissed = 0;
const sheetProps = { open: true, onClose() {}, onDismissed: () => dismissed++, children: null };
const sheet = mount(Sheet, sheetProps);
sheet.render();
assert.deepEqual(commands, [], "An open sheet must release background shortcuts");
dispatch({ id: searchId });
assert.equal(focuses, 1, "A late native event must not focus a field behind a sheet");
const alertProps = { open: true, confirmLabel: "Delete", onConfirm() {}, onCancel() {} };
const alert = mount(ConfirmDialog, alertProps);
alert.render();
const closedSheet = sheet.render({ ...sheetProps, open: false });
assert.equal(dismissed, 0, "Focus callback must wait for native dismissal");
closedSheet.props.onDidDismiss();
assert.equal(dismissed, 1, "Native dismissal releases the opener focus callback");
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

// Same key in different modifier families must coexist; eligible metadata follows screen/overlay lifetime.
focused = true;
let primaryRuns = 0;
let bareRuns = 0;
const register = mount(
	({ enabled = true }) =>
		keyCommands.useKeyCommands([
			{ id: "search", input: "f", title: "Search", run: () => primaryRuns++ },
			{ id: "follow-up", input: "f", modifier: "none", title: "Followed up", enabled, run: () => bareRuns++ },
		]),
	{},
);
register.render();
const followUpId = commands.find((command) => command.modifier === "none").id;
assert.equal(commands.length, 2);
assert.deepEqual(
	keyCommands.getRegisteredKeyCommands().map(({ id, modifier }) => [id, modifier]),
	[
		["search", undefined],
		["follow-up", "none"],
	],
);
dispatch({ id: followUpId });
dispatch({ id: commands.find((command) => command.modifier !== "none")?.id });
assert.equal(bareRuns, 1);
assert.equal(primaryRuns, 1);
register.render({ enabled: false });
dispatch({ id: followUpId });
assert.equal(bareRuns, 1, "Disabled commands reject late native delivery");
assert.deepEqual(
	keyCommands.getRegisteredKeyCommands().map(({ id }) => id),
	["search"],
);
register.render({ enabled: true });
const blocking = mount(({ open }) => keyCommands.useKeyCommandBlocker(open), { open: true });
blocking.render();
assert.deepEqual(keyCommands.getRegisteredKeyCommands(), []);
dispatch({ id: followUpId });
assert.equal(bareRuns, 1);
blocking.unmount();
assert.equal(keyCommands.getRegisteredKeyCommands().length, 2);
focused = false;
register.render();
assert.deepEqual(keyCommands.getRegisteredKeyCommands(), []);
dispatch({ id: followUpId });
assert.equal(bareRuns, 1);
register.unmount();
focused = true;
const replacement = mount(
	() =>
		keyCommands.useKeyCommands([
			{ id: "follow-up", input: "f", modifier: "none", title: "Followed up", run: () => bareRuns++ },
		]),
	{},
);
replacement.render();
dispatch({ id: followUpId });
assert.equal(bareRuns, 1, "A queued event for the previous account owner cannot target its replacement");
dispatch({ id: commands[0].id });
assert.equal(bareRuns, 2);
replacement.unmount();
// Old binary: bare commands are neither advertised nor sent as accidental Cmd shortcuts.
mocks["../../modules/key-commands"].keyCommands.supportsUnmodifiedCommands = undefined;
const legacy = load("shell/key-commands.ts");
const oldRegister = mount(
	() =>
		legacy.useKeyCommands(
			[
				{ id: "bare", input: "f", modifier: "none", title: "Followed up", run: () => bareRuns++ },
				{ id: "primary", input: "f", title: "Search", run: () => primaryRuns++ },
			],
			"global",
		),
	{},
);
oldRegister.render();
assert.deepEqual(
	legacy.getRegisteredKeyCommands().map(({ id }) => id),
	["primary"],
);
assert.equal(legacy.getRegisteredKeyCommands().length, 1);
dispatch({ id: "bare" });
assert.equal(bareRuns, 2);
oldRegister.unmount();
console.log(
	"PASS native command metadata, modifier families, disabled/screen/blocker lifetime and old-binary eligibility",
);
