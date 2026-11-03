// Reduced motion, haptics and the tablet check shared by the primitives (tokens.md §6).
import * as Haptics from "expo-haptics";
import Storage from "expo-sqlite/kv-store";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AccessibilityInfo, useWindowDimensions } from "react-native";
import { Easing, FadeIn, FadeInDown, FadeOut, LinearTransition, ReduceMotion } from "react-native-reanimated";
import { motion, size } from "./tokens";

let reduceMotion = false;
const listeners = new Set<() => void>();
const setReduceMotion = (value: boolean) => {
	reduceMotion = value;
	for (const listener of listeners) listener();
};

void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);

/**
 * iOS Reduce Motion or Android "Remove animations". App-owned content uses short opacity fades, without movement.
 * Spatial/layout animations and native sheets keep the platform's `ReduceMotion.System` behavior.
 */
export function useReducedMotion(): boolean {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		() => reduceMotion,
	);
}

const ignore = () => undefined;

// Settings → Preferences → Haptic feedback. On by default; only "off" is stored.
const hapticsKey = "haptics";
let hapticsEnabled = Storage.getItemSync(hapticsKey) !== "off";
const hapticsListeners = new Set<() => void>();

export function setHapticsEnabled(value: boolean) {
	hapticsEnabled = value;
	if (value) Storage.removeItemSync(hapticsKey);
	else Storage.setItemSync(hapticsKey, "off");
	for (const listener of hapticsListeners) listener();
}

export function useHapticsEnabled(): boolean {
	return useSyncExternalStore(
		(listener) => {
			hapticsListeners.add(listener);
			return () => hapticsListeners.delete(listener);
		},
		() => hapticsEnabled,
	);
}

const play = (feedback: () => Promise<void>) => {
	if (hapticsEnabled) void feedback().catch(ignore);
};

/** tokens.md §6 Haptics. Separate from motion: they play with reduced motion on too. Every haptic goes through here. */
export const haptics = {
	/** Segmented change, detent change, lifting a row to reorder. */
	selection: () => play(Haptics.selectionAsync),
	/** Long-press to select. */
	light: () => play(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
	/** Picking up a section to drag it. */
	medium: () => play(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
	/** Confirming a destructive action. */
	warning: () => play(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
	success: () => play(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
};

/**
 * Tablet layouts (form sheets, tablet toasts): the short side fits a form sheet. Phones in landscape stay phones,
 * and an iPad in a narrow split view falls back to the phone layout.
 */
export function useIsWide(): boolean {
	const { width, height } = useWindowDimensions();
	return Math.min(width, height) >= size.formSheet;
}

// Shared list motion. Reanimated needs its own (worklet) easing, so these repeat the `motion.ease` and `motion.easeMove` curves.
const listEase = Easing.bezier(0.2, 0.8, 0.2, 1);
/** `motion.easeMove` for Reanimated: React Native's `Easing` is not a worklet and crashes on the UI thread. */
export const workletEaseMove = Easing.bezier(0.77, 0, 0.175, 1);
const listStagger = 40;
const listStaggerCap = 8;

/** A row fading in from 8 pt below its place, staggered by its index (capped at 8). Reduced motion: no movement. */
const listEntering = (index: number) =>
	FadeInDown.duration(motion.d2)
		.easing(listEase)
		.withInitialValues({ opacity: 0, transform: [{ translateY: 8 }] })
		.delay(Math.min(index, listStaggerCap) * listStagger)
		.reduceMotion(ReduceMotion.System);

/** Opacity is safe under reduced motion; the system still controls spatial/layout animations. */
const reducedEntering = FadeIn.duration(motion.d1).reduceMotion(ReduceMotion.Never);
const listExiting = FadeOut.duration(motion.d2 * 0.7).reduceMotion(ReduceMotion.Never);

/** First-appearance entry; document lists enable exits only for confirmed remove/restore actions. */
export const listItemMotion = (
	index: number,
	first: boolean,
	{ reduced = false, exiting = true }: { reduced?: boolean; exiting?: boolean } = {},
) => ({
	...(first ? { entering: reduced ? reducedEntering : listEntering(index) } : {}),
	...(exiting ? { exiting: listExiting } : {}),
});

/** Rows sliding into the gap a removed or moved row leaves. */
export const listLayout = LinearTransition.duration(motion.d2)
	.easing(workletEaseMove)
	.reduceMotion(ReduceMotion.System);

/**
 * True until shortly after the list first shows data, so rows stagger in once when the screen opens and never again
 * on scroll, refresh or filter changes.
 */
export function useFirstAppearance(ready: boolean): boolean {
	const [first, setFirst] = useState(true);
	useEffect(() => {
		if (!ready || !first) return;
		const timer = setTimeout(() => setFirst(false), 400);
		return () => clearTimeout(timer);
	}, [ready, first]);
	return first;
}
