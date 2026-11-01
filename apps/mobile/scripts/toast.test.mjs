// Exercise the real Toaster's action callback the way two quick taps reach it: both from one render, before the
// dismissal re-renders it. Host proof only; it says nothing about device touch delivery.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const serverRequire = createRequire(new URL("../../server/package.json", import.meta.url));
const { transformSync } = createRequire(serverRequire.resolve("tsx"))("esbuild");
const react = {
	createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
	useCallback: (callback) => callback,
	useEffect() {},
	useRef: (current) => ({ current }),
	useState: (initial) => [initial, () => {}],
	useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
};
const animation = { duration: () => animation };
const theme = {
	colors: {},
	motion: { d1: 120, d2: 200 },
	radius: {},
	shadows: { e2: {}, e3: {} },
	size: { button: 44, formSheet: 540, hit: 44, tabBar: 56 },
	space: { s0: 2, s1: 4, s2: 8, s3: 12, s4: 16, s8: 32 },
};
const mocks = {
	react,
	"react-native": {
		AccessibilityInfo: {
			isScreenReaderEnabled: async () => false,
			addEventListener() {},
			announceForAccessibility() {},
		},
		I18nManager: { isRTL: false },
		Platform: { OS: "ios" },
		Pressable: "Pressable",
		View: "View",
	},
	"react-native-reanimated": {
		default: { View: "Animated.View" },
		FadeIn: animation,
		FadeInDown: animation,
		FadeOut: animation,
		FadeOutDown: animation,
	},
	"react-native-worklets": {},
	"@lingui/react/macro": { useLingui: () => ({ t: (parts) => parts.join("") }) },
	"@lodev09/react-native-true-sheet": {},
	"./button": {},
	"./motion": { useIsWide: () => false, useReducedMotion: () => true },
	"./safe-area": { useWindowSafeAreaInsets: () => ({ bottom: 34 }) },
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
const { Toaster, showToast } = module.exports;

const find = (node, type) => {
	if (!node || typeof node !== "object") return undefined;
	if (Array.isArray(node)) {
		for (const child of node) {
			const found = find(child, type);
			if (found) return found;
		}
		return undefined;
	}
	if (node.type === type) return node;
	return find(node.props?.children, type);
};

let undos = 0;
showToast({ message: "Section cleared", undo: () => undos++ });
const action = find(Toaster(), "Pressable");
assert.ok(action, "The toast renders its Undo action");
action.props.onPress();
action.props.onPress();
assert.equal(undos, 1, "A second tap before the toast re-renders must not undo twice");
assert.equal(find(Toaster(), "Pressable"), undefined, "Undo dismisses its toast");

// A newer toast is untouched: its own Undo still runs once.
let later = 0;
showToast({ message: "Entry deleted", undo: () => later++ });
const next = find(Toaster(), "Pressable");
next.props.onPress();
assert.equal(later, 1);
assert.equal(undos, 1);
console.log("PASS toast action runs once per toast, even when tapped twice before it re-renders");

let attempts = 0;
showToast({
	message: "Retry action",
	undo: () => {
		attempts++;
		if (attempts === 1) throw new Error("Temporary failure");
	},
});
const retry = find(Toaster(), "Pressable");
assert.throws(() => retry.props.onPress(), /Temporary failure/);
assert.ok(find(Toaster(), "Pressable"), "A throwing action remains available");
retry.props.onPress();
assert.equal(attempts, 2, "A synchronous failure permits retry");
assert.equal(find(Toaster(), "Pressable"), undefined);
