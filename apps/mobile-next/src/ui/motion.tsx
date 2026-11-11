// Reference implementation of the motion, haptics, hit-area and micro-interaction layer (design/MOTION.md), final
// storyboard (v4). Copy into the new app's src/ui/motion.tsx and adapt names. Rule: screens never call
// withTiming/withSpring/LayoutAnimation/Animated.timing or expo-haptics directly; they use the primitives below, so every
// duration, curve, haptic and hit area comes from reference/tokens.ts.
// Written against react-native-reanimated 4, react-native-gesture-handler 2 and 3 (the Gesture builder API, type-checked with
// both), @react-navigation/stack 7 and expo-haptics with performAndroidHapticsAsync. Check the installed versions.

import type {
	StackCardInterpolatedStyle,
	StackCardInterpolationProps,
	StackNavigationOptions,
} from "expo-router/js-stack";
import * as Haptics from "expo-haptics";
import React, { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import {
	AccessibilityInfo,
	Animated as RNAnimated,
	Easing as RNEasing,
	Platform,
	StyleSheet,
	View,
	type StyleProp,
	type ViewStyle,
	type AccessibilityRole,
	type AccessibilityState,
	type Insets,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
	cancelAnimation,
	Easing,
	interpolate,
	makeMutable,
	ReduceMotion,
	runOnJS,
	useAnimatedStyle,
	useReducedMotion,
	useSharedValue,
	withDelay,
	withSequence,
	withTiming,
	type SharedValue,
	type WithTimingConfig,
} from "react-native-reanimated";
import { create } from "zustand";
import { colors, haptics, hitTarget, motion, type HapticToken, type ThemeName } from "./tokens";

// -------------------------------------------------------------------------------------------------
// 0. Debug switches (dev and storyboard builds only)
// -------------------------------------------------------------------------------------------------

const STORYBOARD = process.env.EXPO_PUBLIC_STORYBOARD === "1";

/**
 * Multiplies every duration. 0 = instant (storyboard captures), 1 = normal, 5 = "Slow animations" in the dev menu.
 * A shared value so worklets read the live value. Release builds never change it.
 */
export const timeScale: SharedValue<number> = makeMutable(1);

export function dur(ms: number): number {
	"worklet";
	return Math.round(ms * timeScale.value);
}

// -------------------------------------------------------------------------------------------------
// 1. Curves
// -------------------------------------------------------------------------------------------------

const c = motion.curves;

/** Reanimated easings (worklets, layout animation builders). */
export const curve = {
	ease: Easing.bezier(c.ease[0], c.ease[1], c.ease[2], c.ease[3]),
	easeInOutStrong: Easing.bezier(
		c.easeInOutStrong[0],
		c.easeInOutStrong[1],
		c.easeInOutStrong[2],
		c.easeInOutStrong[3],
	),
	easeOutStrong: Easing.bezier(c.easeOutStrong[0], c.easeOutStrong[1], c.easeOutStrong[2], c.easeOutStrong[3]),
	easeDrawer: Easing.bezier(c.easeDrawer[0], c.easeDrawer[1], c.easeDrawer[2], c.easeDrawer[3]),
	linear: Easing.linear,
};

/** React Native Animated easings, for React Navigation's transitionSpec (the JS stack runs on the native driver). */
export const navCurve = {
	ease: RNEasing.bezier(c.ease[0], c.ease[1], c.ease[2], c.ease[3]),
	easeDrawer: RNEasing.bezier(c.easeDrawer[0], c.easeDrawer[1], c.easeDrawer[2], c.easeDrawer[3]),
};

type Curve = (typeof curve)[keyof typeof curve];

/**
 * Timing for something entering or changing state. We apply our own reduced-motion policy (§5 of MOTION.md),
 * so Reanimated's own reduce-motion handling is switched off on every animation.
 */
export function enter(ms: number, easing: Curve = curve.ease): WithTimingConfig {
	"worklet";
	return { duration: dur(ms), easing, reduceMotion: ReduceMotion.Never };
}

/** Timing for something leaving: 70% of the entry duration. */
export function leave(ms: number, easing: Curve = curve.ease): WithTimingConfig {
	"worklet";
	return { duration: dur(Math.round(ms * motion.exitFactor)), easing, reduceMotion: ReduceMotion.Never };
}

/** Linear timing (toast fuses, spinners). */
export function linear(ms: number): WithTimingConfig {
	"worklet";
	return { duration: dur(ms), easing: Easing.linear, reduceMotion: ReduceMotion.Never };
}

/**
 * Release of a dragged sheet, drawer or card: ease-drawer, duration scaled by the remaining distance, max d3,
 * at least d1 so a nearly settled release still reads as motion.
 */
export function release(remaining: number, total: number): WithTimingConfig {
	"worklet";
	const f = total > 0 ? Math.min(1, Math.abs(remaining) / total) : 1;
	return {
		duration: dur(Math.max(motion.d1, Math.round(motion.d3 * f))),
		easing: curve.easeDrawer,
		reduceMotion: ReduceMotion.Never,
	};
}

// -------------------------------------------------------------------------------------------------
// 2. Reduced motion policy
// -------------------------------------------------------------------------------------------------

/**
 * Reduced motion (system setting): movement, stagger and decoration go; transitions finish at once. Sheets, dialogs,
 * menus and toasts keep a d1 fade in place. Spinners keep turning; haptics stay on.
 */
export function useMotionPolicy() {
	const reduced = useReducedMotion();
	return useMemo(
		() => ({
			reduced,
			/** Distance for fade-ups and slides: 0 when reduced. */
			distance: (px: number) => (reduced ? 0 : px),
			/** Duration for movement: 0 when reduced. */
			movement: (ms: number) => (reduced ? 0 : ms),
			/** Duration for an overlay's fade (sheet, dialog, menu, toast): d1 when reduced. */
			overlayFade: (ms: number) => (reduced ? motion.d1 : ms),
			stagger: (ms: number) => (reduced ? 0 : ms),
		}),
		[reduced],
	);
}

// -------------------------------------------------------------------------------------------------
// 3. Haptics
// -------------------------------------------------------------------------------------------------

export type HapticEvent = { token: HapticToken; at: number; played: boolean };

let hapticsEnabled = true; // Settings › Preferences › Haptics. The system setting is respected by the OS itself.
const hapticEvents: HapticEvent[] = [];
const hapticListeners = new Set<(e: HapticEvent) => void>();

export function setHapticsEnabled(on: boolean) {
	hapticsEnabled = on;
}

/** Dev and storyboard builds keep the last 50 haptics; tests and the haptic overlay read them. */
export function hapticLog(): readonly HapticEvent[] {
	return hapticEvents;
}
export function clearHapticLog() {
	hapticEvents.length = 0;
}
export function onHaptic(listener: (e: HapticEvent) => void) {
	hapticListeners.add(listener);
	return () => {
		hapticListeners.delete(listener);
	};
}

/**
 * Play one haptic from the vocabulary. One per gesture, at the moment the state changes (MOTION.md §3).
 * Android uses the haptic engine (performAndroidHapticsAsync), never impactAsync (a Vibrator simulation there).
 */
export function haptic(token: HapticToken): void {
	const played = hapticsEnabled;
	if (__DEV__ || STORYBOARD) {
		const e = { token, at: Date.now(), played };
		hapticEvents.push(e);
		if (hapticEvents.length > 50) hapticEvents.shift();
		hapticListeners.forEach((l) => l(e));
	}
	if (!played) return;
	const spec = haptics[token];
	if (Platform.OS === "android") {
		const name = Number(Platform.Version) >= spec.minApi ? spec.android : spec.fallback;
		Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics[name]).catch(() => {});
		return;
	}
	const p = (() => {
		switch (spec.ios) {
			case "selection":
				return Haptics.selectionAsync();
			case "impactLight":
				return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
			case "impactMedium":
				return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
			case "impactRigid":
				return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
			case "impactSoft":
				return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
			case "notifySuccess":
				return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
			case "notifyWarning":
				return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
			case "notifyError":
				return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
		}
	})();
	p?.catch(() => {});
}

/** From a gesture worklet (UI thread). */
export function hapticOnUI(token: HapticToken) {
	"worklet";
	runOnJS(haptic)(token);
}

// -------------------------------------------------------------------------------------------------
// 4. Touchable: press feedback on the UI thread
// -------------------------------------------------------------------------------------------------

/** The minimum hit square on this platform: 44 pt on iOS, 48 dp on Android (Reach board). */
export const minHit: number = Platform.OS === "ios" ? hitTarget.ios : hitTarget.android;

/**
 * hitSlop that grows a drawing of width × height to the platform's minimum hit square, evenly on each side.
 * Neighbours must not overlap: if two extended areas would, the layout changes instead (more gap, a second row,
 * a picker), never a smaller hit area. Rows, switch rows and chips are already their own targets.
 */
export function hitSlopFor(width: number, height: number): Insets {
	const min = Platform.OS === "ios" ? hitTarget.ios : hitTarget.android;
	const x = Math.max(0, (min - width) / 2);
	const y = Math.max(0, (min - height) / 2);
	return { top: y, bottom: y, left: x, right: x };
}

export type Feedback =
	| "scale" // buttons, icon buttons, chips, swatches, cards you tap: scale to 0.97 (d1)
	| "wash" // rows, menu items, sheet rows: the `press` token over the full row (d1)
	| "none";

export type TouchableProps = {
	onPress?: (() => void) | undefined;
	/** Long-press opens an actions sheet: plays `light` when it fires (pass longPressHaptic={null} to skip). */
	onLongPress?: (() => void) | undefined;
	longPressHaptic?: HapticToken | null | undefined;
	disabled?: boolean | undefined;
	feedback?: Feedback | undefined;
	/** Rows inside scroll views: wait this long before washing, so a scroll never flashes rows. */
	washDelay?: number | undefined;
	theme: ThemeName;
	radius?: number | undefined;
	style?: StyleProp<ViewStyle> | undefined;
	children?: React.ReactNode | undefined;
	accessibilityRole?: AccessibilityRole | undefined;
	accessibilityLabel?: string | undefined;
	accessibilityHint?: string | undefined;
	accessibilityState?: AccessibilityState | undefined;
	/** false when the content holds its own control that screen readers must reach (ListRow `trailingAction`). */
	accessible?: boolean | undefined;
	testID?: string | undefined;
	/** Extra touch area around the drawing; use hitSlopFor(width, height) for anything drawn under 44/48. */
	hitSlop?: number | Insets | undefined;
	/** The press progress (0 → 1), for the motion lab to drive with pressDown / pressUp. */
	pressedValue?: SharedValue<number> | undefined;
};

/** Touch-down feedback: 0 → 1 in d1 `ease` (after `washDelay` for rows in scroll views). */
export function pressDown(pressed: SharedValue<number>, washDelay = 0) {
	"worklet";
	const t = enter(motion.d1);
	pressed.value = washDelay > 0 ? withDelay(dur(washDelay), withTiming(1, t)) : withTiming(1, t);
}

/** Release: back to 0 in 84 ms; a tap shorter than the wash delay still flashes the wash. */
export function pressUp(pressed: SharedValue<number>, washDelay = 0) {
	"worklet";
	if (washDelay > 0 && pressed.value < 0.5) {
		pressed.value = withSequence(withTiming(1, enter(motion.d1 / 2)), withTiming(0, leave(motion.d1)));
	} else {
		pressed.value = withTiming(0, leave(motion.d1));
	}
}

/**
 * Feedback starts on touch-down in the same frame (worklet), never waits for the JS thread, and is cancelled when a
 * scroll or another gesture takes over. The action runs on release (onPress) or after 500 ms (onLongPress).
 * No haptic on press-down of an ordinary button (MOTION.md §3).
 */
export function Touchable({
	onPress,
	onLongPress,
	longPressHaptic = "light",
	disabled = false,
	feedback = "scale",
	washDelay = 0,
	theme,
	radius = 0,
	style,
	children,
	accessibilityRole = "button",
	accessibilityLabel,
	accessibilityHint,
	accessibilityState,
	accessible = true,
	testID,
	hitSlop,
	pressedValue,
}: TouchableProps) {
	const own = useSharedValue(0);
	const pressed = pressedValue ?? own;
	const showHitAreas = useMotionDebug((d) => d.showHitAreas);

	const press = useCallback(() => onPress?.(), [onPress]);
	const longPress = useCallback(() => {
		if (longPressHaptic) haptic(longPressHaptic);
		onLongPress?.();
	}, [onLongPress, longPressHaptic]);

	const gesture = useMemo(() => {
		const down = () => {
			"worklet";
			pressDown(pressed, washDelay);
		};
		const up = () => {
			"worklet";
			pressUp(pressed, washDelay);
		};
		const tap = Gesture.Tap()
			.enabled(!disabled && !!onPress)
			.hitSlop(hitSlop ?? 0)
			.maxDuration(60_000)
			.onBegin(down)
			.onFinalize(up)
			.onEnd((_e, success) => {
				if (success) runOnJS(press)();
			});
		if (!onLongPress) return tap;
		const long = Gesture.LongPress()
			.enabled(!disabled)
			.hitSlop(hitSlop ?? 0)
			.minDuration(500)
			.onBegin(down)
			.onStart(() => {
				runOnJS(longPress)();
			})
			.onFinalize(up);
		return Gesture.Exclusive(long, tap);
	}, [disabled, onPress, onLongPress, press, longPress, washDelay, pressed, hitSlop]);

	const scaleStyle = useAnimatedStyle(() =>
		feedback === "scale" ? { transform: [{ scale: interpolate(pressed.value, [0, 1], [1, motion.pressScale]) }] } : {},
	);
	const washStyle = useAnimatedStyle(() => ({ opacity: pressed.value }));

	return (
		<GestureDetector gesture={gesture}>
			<Animated.View
				accessible={accessible}
				accessibilityRole={accessibilityRole}
				accessibilityLabel={accessibilityLabel}
				accessibilityHint={accessibilityHint}
				accessibilityState={{ disabled, ...accessibilityState }}
				accessibilityActions={onLongPress ? [{ name: "longpress", label: "Actions" }] : undefined}
				onAccessibilityAction={(e) => e.nativeEvent.actionName === "longpress" && longPress()}
				onAccessibilityTap={press}
				testID={testID}
				hitSlop={hitSlop}
				style={[style, scaleStyle]}
			>
				{feedback === "wash" && (
					<Animated.View
						pointerEvents="none"
						style={[StyleSheet.absoluteFill, { backgroundColor: colors[theme].press, borderRadius: radius }, washStyle]}
					/>
				)}
				{children}
				{showHitAreas && <HitAreaOutline hitSlop={hitSlop} theme={theme} />}
			</Animated.View>
		</GestureDetector>
	);
}

/** Dev menu "Show hit areas": a dashed outline of the hit rect (drawing plus hitSlop), as on the Reach board. */
function HitAreaOutline({ hitSlop, theme }: { hitSlop?: number | Insets | undefined; theme: ThemeName }) {
	const i =
		typeof hitSlop === "number" ? { top: hitSlop, bottom: hitSlop, left: hitSlop, right: hitSlop } : (hitSlop ?? {});
	return (
		<View
			pointerEvents="none"
			style={{
				position: "absolute",
				top: -(i.top ?? 0),
				bottom: -(i.bottom ?? 0),
				left: -(i.left ?? 0),
				right: -(i.right ?? 0),
				borderWidth: 1,
				borderStyle: "dashed",
				borderColor: colors[theme].accent,
				borderRadius: 4,
			}}
		/>
	);
}

// -------------------------------------------------------------------------------------------------
// 5. Stack push and modal transitions (React Navigation JS stack: same curve on iOS and Android)
// -------------------------------------------------------------------------------------------------

/** Push: the new screen slides in from the trailing edge; the covered one shifts 30% and dims with the scrim. */
export function forPush({
	current,
	next,
	inverted,
	layouts: { screen },
}: StackCardInterpolationProps): StackCardInterpolatedStyle {
	const translateFocused = RNAnimated.multiply(
		current.progress.interpolate({ inputRange: [0, 1], outputRange: [screen.width, 0], extrapolate: "clamp" }),
		inverted,
	);
	const translateCovered = next
		? RNAnimated.multiply(
				next.progress.interpolate({
					inputRange: [0, 1],
					outputRange: [0, -screen.width * motion.pushParallax],
					extrapolate: "clamp",
				}),
				inverted,
			)
		: 0;
	return {
		cardStyle: { transform: [{ translateX: translateFocused }, { translateX: translateCovered }] },
		overlayStyle: {
			opacity: current.progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: "clamp" }),
		},
	};
}

/** Full-screen modal (B16, S1, D4, J5, A4): rises from the bottom; the screen behind dims, does not move. */
export function forModal({ current, layouts: { screen } }: StackCardInterpolationProps): StackCardInterpolatedStyle {
	return {
		cardStyle: {
			transform: [
				{
					translateY: current.progress.interpolate({
						inputRange: [0, 1],
						outputRange: [screen.height, 0],
						extrapolate: "clamp",
					}),
				},
			],
		},
		overlayStyle: {
			opacity: current.progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: "clamp" }),
		},
	};
}

/** Shared-element destination (§6.2): fades in without sliding while the Hero overlay travels. */
export function forFade({ current }: StackCardInterpolationProps): StackCardInterpolatedStyle {
	return { cardStyle: { opacity: current.progress } };
}

/** Reduced motion: pushes and modals finish at once (a d1 crossfade keeps the change readable). */
export function forReducedMotion({ current }: StackCardInterpolationProps): StackCardInterpolatedStyle {
	return { cardStyle: { opacity: current.progress } };
}

type TransitionSpec = NonNullable<StackNavigationOptions["transitionSpec"]>["open"];

/** The duration is read when the transition starts (not while React renders the options), so timeScale is live. */
function timingSpec(ms: number, easing: (t: number) => number): TransitionSpec {
	return {
		animation: "timing",
		config: {
			get duration() {
				// At least one frame: a 0 ms stack transition (storyboard captures run at time scale 0) left the pushed
				// card's gestures dead for its first touch.
				return Math.max(16, Math.round(ms * timeScale.value));
			},
			easing,
		},
	};
}

/** Screen options for the app's stacks. Spread into screenOptions; per-screen `presentation` picks push or modal. */
export function stackOptions(
	theme: ThemeName,
	kind: "push" | "modal" | "fade",
	reduced: boolean,
): StackNavigationOptions {
	const scrim = colors[theme].scrim;
	const open = reduced ? motion.d1 : motion.d3;
	return {
		headerShown: false,
		cardStyle: { backgroundColor: colors[theme].bg },
		cardShadowEnabled: false,
		cardOverlayEnabled: true,
		cardOverlay: () => <View style={{ flex: 1, backgroundColor: scrim }} />,
		cardStyleInterpolator: reduced
			? forReducedMotion
			: kind === "push"
				? forPush
				: kind === "modal"
					? forModal
					: forFade,
		transitionSpec: {
			open: timingSpec(open, navCurve.ease),
			close: timingSpec(Math.round(open * motion.exitFactor), navCurve.ease),
		},
		// iOS: edge swipe pops; Android: system back (and predictive back) pops on release with the same close timing.
		gestureEnabled: Platform.OS === "ios" && kind !== "fade",
		gestureDirection: kind === "push" ? "horizontal" : "vertical",
	};
}

// -------------------------------------------------------------------------------------------------
// 6. Tab and mode fade-through (root dock, builder dock, letter dock)
// -------------------------------------------------------------------------------------------------

type FadeThroughApi = {
	progress: SharedValue<number>; // 1 = content visible, 0 = faded out
	/** The scene being shown, when scenes carry a `sceneKey` (null until the first switch). */
	target: SharedValue<string | null>;
	/**
	 * Called by the dock: fade the current content out (140 ms), then navigate, then the new content fades up. With
	 * `key` (and scenes that carry `sceneKey`), the new scene starts rising on the UI thread the frame the old one is
	 * gone, without waiting for the navigation to render.
	 */
	switchTo: (navigate: () => void, key?: string) => void;
	/** Called by a scene when it gains focus. */
	revealFocused: (key?: string) => void;
	/** Scenes report that they carry keys (FadeThroughScene with sceneKey). */
	keyed: { current: boolean };
	/** A scene with a key has mounted: switches can target it on the UI thread. */
	markKeyed: () => void;
};

const FadeThroughContext = createContext<FadeThroughApi | null>(null);

/**
 * Fade-through, never both at once: the old content fades out over 140 ms, then the new one fades up 6 px over d2.
 * The dock's selected state changes on tap, at once. Wrap the tab layout's scenes in <FadeThroughProvider> and each
 * tab screen's root in <FadeThroughScene focused sceneKey>. Re-tapping the selected tab scrolls to top instead.
 *
 * The state machine lives outside React so it can be tested: switchTo fades the content out over 140 ms and
 * navigates only when that finishes (a second call during the fade retargets); the new content fades up over d2.
 * Reduced motion navigates at once.
 */
export function createFadeThrough(
	progress: SharedValue<number>,
	reduced: boolean,
	target: SharedValue<string | null> = makeMutable<string | null>(null),
): FadeThroughApi {
	let pending: (() => void) | null = null;
	let handedOff: string | null = null;
	const keyed = { current: false };
	const flush = (key: string | null) => {
		handedOff = key;
		const go = pending;
		pending = null;
		go?.();
	};
	return {
		progress,
		target,
		keyed,
		markKeyed: () => {
			keyed.current = true;
		},
		switchTo: (navigate, key) => {
			const k = keyed.current ? (key ?? null) : null;
			if (reduced) {
				if (k !== null) target.value = k;
				navigate();
				return;
			}
			pending = navigate;
			cancelAnimation(progress);
			progress.value = withTiming(0, enter(motion.fadeThroughOut), (finished) => {
				"worklet";
				if (!finished) return;
				if (k !== null) {
					target.value = k;
					progress.value = withTiming(1, enter(motion.d2));
				}
				runOnJS(flush)(k);
			});
		},
		revealFocused: (key) => {
			if (key !== undefined && key === handedOff) {
				handedOff = null;
				return; // already rising since the old content left
			}
			if (key !== undefined) target.value = key;
			progress.value = withTiming(1, enter(motion.d2));
		},
	};
}

export function FadeThroughProvider({ children }: { children: React.ReactNode }) {
	const progress = useSharedValue(1);
	const target = useSharedValue<string | null>(null);
	const { reduced } = useMotionPolicy();
	const api = useMemo(() => createFadeThrough(progress, reduced, target), [progress, reduced, target]);
	return <FadeThroughContext.Provider value={api}>{children}</FadeThroughContext.Provider>;
}

export function useFadeThrough() {
	const api = useContext(FadeThroughContext);
	if (!api) throw new Error("useFadeThrough outside FadeThroughProvider");
	return api;
}

export function FadeThroughScene({
	focused,
	sceneKey,
	children,
}: {
	focused: boolean;
	/** The dock key of this scene: lets the incoming scene start on the UI thread (see createFadeThrough). */
	sceneKey?: string;
	children: React.ReactNode;
}) {
	const { progress, target, revealFocused, markKeyed } = useFadeThrough();
	const { distance } = useMotionPolicy();
	const rise = distance(motion.fadeUp);
	useEffect(() => {
		if (sceneKey !== undefined) markKeyed();
		if (focused) revealFocused(sceneKey);
	}, [focused, revealFocused, sceneKey, markKeyed]);
	const style = useAnimatedStyle(() => {
		const on = sceneKey !== undefined && target.value !== null ? target.value === sceneKey : focused;
		return {
			opacity: on ? progress.value : 0,
			transform: [{ translateY: on ? interpolate(progress.value, [0, 1], [rise, 0]) : 0 }],
		};
	});
	return <Animated.View style={[{ flex: 1 }, style]}>{children}</Animated.View>;
}

// -------------------------------------------------------------------------------------------------
// 7. Small recipes used across screens
// -------------------------------------------------------------------------------------------------

/** Fade up `px` over `ms` after `delay` (results, sections, first-run stagger). Reduced motion: appears at once. */
export function useFadeUp({
	px = motion.fadeUp as number,
	ms = motion.d2 as number,
	delay = 0,
	easing = curve.ease as Curve,
	start = true,
}: { px?: number; ms?: number; delay?: number; easing?: Curve; start?: boolean } = {}) {
	const v = useSharedValue(0);
	const { reduced } = useMotionPolicy();
	useEffect(() => {
		if (!start) return;
		v.set(reduced ? 1 : withDelay(dur(delay), withTiming(1, enter(ms, easing))));
	}, [start, reduced, delay, ms, easing, v]);
	return useAnimatedStyle(() => ({
		opacity: v.value,
		transform: [{ translateY: reduced ? 0 : interpolate(v.value, [0, 1], [px, 0]) }],
	}));
}

/** A2 and A3: shake 4 dp `cycles` times over d2 in total; no shake under reduced motion. Plays no haptic itself. */
export function shake(x: SharedValue<number>, cycles: number = motion.shake.cycles) {
	"worklet";
	const steps = cycles * 2 + 1;
	const step = {
		duration: dur(Math.round(motion.d2 / steps)),
		easing: curve.easeInOutStrong,
		reduceMotion: ReduceMotion.System,
	};
	const seq: number[] = [];
	for (let i = 0; i < cycles; i++) seq.push(-motion.shake.distance, motion.shake.distance);
	seq.push(0);
	x.value = withSequence(...seq.map((to) => withTiming(to, step)));
}

/**
 * Toast lifetime (ms): 5 s, 8 s with an action. Android's accessibility timeout ("Time to take action") can only
 * lengthen it. With a screen reader running, a toast with an action stays until used or dismissed: returns null.
 * Every Undo in a toast also exists where the item lives (the status line, the item's ··· or its screen).
 */
export async function toastLifetime(hasAction: boolean): Promise<number | null> {
	const base = hasAction ? motion.toastWithAction : motion.toastPlain;
	if (hasAction && (await AccessibilityInfo.isScreenReaderEnabled())) return null;
	if (Platform.OS === "android") return Math.max(base, await AccessibilityInfo.getRecommendedTimeoutMillis(base));
	return base;
}

/** Toast fuse: 1 → 0 linearly over the toast's lifetime; touching or focusing the toast pauses it (cancelAnimation), resuming continues. */
export function startFuse(fuse: SharedValue<number>, lifetime: number, onDone: () => void) {
	"worklet";
	fuse.value = withTiming(0, linear(lifetime * fuse.value), (finished) => {
		if (finished) runOnJS(onDone)();
	});
}

/** Sheet drag release: dismiss past 25% of the height or on a fast downward fling; otherwise settle back. */
export function sheetShouldDismiss(translateY: number, height: number, velocityY: number) {
	"worklet";
	return translateY > height * motion.sheetDismissFraction || velocityY > motion.sheetDismissVelocity;
}

/** Rubber band past a limit (sheet pulled up, pinch past 0.6× or 3×): resistance grows with distance. */
export function rubberBand(overshoot: number, dimension: number, coefficient = 0.55) {
	"worklet";
	const sign = Math.sign(overshoot);
	const d = Math.abs(overshoot);
	return sign * (1 - 1 / ((d * coefficient) / dimension + 1)) * dimension;
}

// -------------------------------------------------------------------------------------------------
// 8. Dev switches shared by the dev menu, overlays and stacks
// -------------------------------------------------------------------------------------------------

type MotionDebug = {
	/** "Slow animations": timeScale 5. */
	slow: boolean;
	showHitAreas: boolean;
	showHaptics: boolean;
	stressJs: boolean;
	set: (patch: Partial<Omit<MotionDebug, "set">>) => void;
};

/** Dev menu state. `slow` also drives `timeScale`, and `useStackOptions` re-renders stacks when it changes. */
export const useMotionDebug = create<MotionDebug>((set) => ({
	slow: false,
	showHitAreas: false,
	showHaptics: false,
	stressJs: false,
	set: (patch) => {
		if (patch.slow !== undefined) timeScale.value = patch.slow ? 5 : 1;
		set(patch);
	},
}));

/**
 * stackOptions for a layout, recomputed when the theme, reduced motion or "Slow animations" change (the JS stack
 * reads its transition durations from the options, not from the shared value).
 */
export function useStackOptions(theme: ThemeName, kind: "push" | "modal" | "fade" = "push"): StackNavigationOptions {
	const { reduced } = useMotionPolicy();
	useMotionDebug((d) => d.slow); // re-render when "Slow animations" changes timeScale
	return stackOptions(theme, kind, reduced);
}

/**
 * The same options with an instant open: the screen lands at once, while screens pushed over it (and its close) keep
 * their timing. For dev routes that are opened back to back by deep link (the motion lab).
 */
export function withInstantOpen(options: StackNavigationOptions): StackNavigationOptions {
	const close = options.transitionSpec?.close;
	return {
		...options,
		transitionSpec: {
			open: timingSpec(0, navCurve.ease),
			...(close ? { close } : { close: timingSpec(0, navCurve.ease) }),
		},
	};
}
