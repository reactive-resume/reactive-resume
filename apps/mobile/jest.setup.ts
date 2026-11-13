// Shared Jest setup. Motion owner may append Reanimated setup here.

// Motion (agent M). Reanimated's own test setup (setUpTests, timer-driven animations) needs
// `"resolver": "react-native-reanimated/jest/resolver"` in the Jest config; until the lead adds it, this stand-in
// covers what the motion module's pure functions touch: shared values, timing configs (recorded in
// `globalThis.__timings`, callbacks run on demand), easings and runOnJS.
jest.mock("react-native-reanimated", () => {
	const { Easing } = jest.requireActual("react-native-reanimated/src/Easing");
	const timings: { to: unknown; config: unknown; callback?: (finished: boolean) => void }[] = [];
	(globalThis as { __timings?: typeof timings }).__timings = timings;
	const mutable = <T>(value: T) => ({ value, get: () => value, set: () => {} });
	const View = jest.requireActual("react-native").View;
	return {
		__esModule: true,
		default: { View, ScrollView: View, Text: View, createAnimatedComponent: (c: unknown) => c },
		Easing,
		ReduceMotion: { System: "system", Always: "always", Never: "never" },
		makeMutable: mutable,
		useSharedValue: mutable,
		withTiming: (to: unknown, config: unknown, callback?: (finished: boolean) => void) => {
			timings.push({ to, config, ...(callback ? { callback } : {}) });
			return to;
		},
		withDelay: (_ms: number, a: unknown) => a,
		withSequence: (...a: unknown[]) => a.at(-1),
		withRepeat: (a: unknown) => a,
		cancelAnimation: () => {},
		runOnJS: (fn: (...a: unknown[]) => unknown) => fn,
		runOnUI: (fn: (...a: unknown[]) => unknown) => fn,
		interpolate: (v: number, [i0 = 0, i1 = 1]: number[], [o0 = 0, o1 = 1]: number[]) =>
			o0 + ((v - i0) / (i1 - i0)) * (o1 - o0),
		interpolateColor: (_v: number, _i: number[], o: string[]) => o[0],
		useAnimatedStyle: (fn: () => object) => fn(),
		useAnimatedReaction: () => {},
		useAnimatedScrollHandler: () => () => {},
		useDerivedValue: (fn: () => unknown) => mutable(fn()),
		useReducedMotion: () => false,
		useFrameCallback: () => {},
		useAnimatedRef: () => ({ current: null }),
		scrollTo: () => {},
		LayoutAnimationConfig: ({ children }: { children: unknown }) => children,
	};
});
jest.mock("react-native-gesture-handler", () => {
	const chain = (): unknown => new Proxy({}, { get: () => () => chain() });
	return {
		Gesture: new Proxy({}, { get: () => () => chain() }),
		GestureDetector: ({ children }: { children: unknown }) => children,
	};
});
jest.mock("react-native-keyboard-controller", () => require("react-native-keyboard-controller/jest"));
jest.mock("expo-haptics", () => ({
	selectionAsync: jest.fn(() => Promise.resolve()),
	impactAsync: jest.fn(() => Promise.resolve()),
	notificationAsync: jest.fn(() => Promise.resolve()),
	performAndroidHapticsAsync: jest.fn(() => Promise.resolve()),
	ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy", Rigid: "rigid", Soft: "soft" },
	NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
	AndroidHaptics: new Proxy({}, { get: (_t, k) => k }),
}));

// Lingui (agent U). Files that use the `t` / `Trans` macros need an active locale; with no catalog loaded the
// macros fall back to their source strings, so tests read the English copy.
require("@lingui/core").i18n.loadAndActivate({ locale: "en", messages: {} });
