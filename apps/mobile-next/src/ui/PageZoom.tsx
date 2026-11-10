// Pinch zoom of a page (MOTION.md §7, B18 and P1). Follows both fingers around their focal point; past 0.6× and 3×
// it rubber-bands and returns to the limit on release with `release()`. Double-tap toggles fit and 2× about the tap
// point in d2; `selection` when zoom snaps to fit or 2×. At fit a downward swipe dismisses (25% or a fling, as a
// sheet). The ZoomBar (−, Fit, +) and the accessibility actions animate the same way, through the handle.
import { t } from "@lingui/core/macro";
import { type ReactNode, type Ref, useImperativeHandle, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { enter, hapticOnUI, release, rubberBand, sheetShouldDismiss } from "./motion";
import { motion } from "./tokens";

const { min: MIN, max: MAX, doubleTap: DOUBLE } = motion.pinch;
const STEP = 0.5;

export type PageZoomHandle = {
	zoomIn: () => void;
	zoomOut: () => void;
	fit: () => void;
	/** Double-tap at a point in the view (dp). */
	toggleAt: (x: number, y: number) => void;
};

export type PageZoomProps = {
	children: ReactNode;
	/** At fit zoom, a downward swipe past 25% of the height (or a fling) calls this. */
	onDismiss?: () => void;
	/** Reports the zoom level after each change settles (for "Fit" / percentage labels). */
	onZoom?: (scale: number) => void;
	ref?: Ref<PageZoomHandle>;
};

/** Clamp with a rubber band beyond the limits. */
export function bandedScale(s: number) {
	"worklet";
	if (s > MAX) return MAX + rubberBand(s - MAX, MAX - 1, 0.55);
	if (s < MIN) return MIN - rubberBand(MIN - s, MIN, 0.55);
	return s;
}

export function PageZoom({ children, onDismiss, onZoom, ref }: PageZoomProps) {
	const [size, setSize] = useState({ w: 0, h: 0 });
	const scale = useSharedValue(1);
	const x = useSharedValue(0);
	const y = useSharedValue(0);
	const start = useSharedValue({ scale: 1, x: 0, y: 0, fx: 0, fy: 0 });
	const dismissY = useSharedValue(0);
	const w = size.w;
	const h = size.h;

	const report = (s: number) => {
		"worklet";
		if (onZoom) runOnJS(onZoom)(s);
	};

	/** Animate to a zoom about a focal point (view coordinates), keeping that point still. */
	const zoomTo = (target: number, fx: number, fy: number) => {
		"worklet";
		const cx = fx - w / 2;
		const cy = fy - h / 2;
		const k = target / scale.value;
		const nx = target === 1 ? 0 : cx - (cx - x.value) * k;
		const ny = target === 1 ? 0 : cy - (cy - y.value) * k;
		const cfg = enter(motion.d2);
		scale.set(withTiming(target, cfg));
		x.set(withTiming(nx, cfg));
		y.set(withTiming(ny, cfg));
		if (target === 1 || target === DOUBLE) hapticOnUI("selection");
		report(target);
	};

	const settle = () => {
		"worklet";
		const s = scale.value;
		const target = Math.min(MAX, Math.max(MIN, s));
		if (target !== s) {
			const cfg = release(Math.abs(target - s), MAX - MIN);
			scale.set(withTiming(target, cfg));
			const k = target / s;
			x.set(withTiming(x.value * k, cfg));
			y.set(withTiming(y.value * k, cfg));
		}
		report(target);
	};

	/** The zoom bar's − and +: half steps from the current zoom, about the centre. */
	const stepBy = (dir: -1 | 1) =>
		zoomTo(Math.min(MAX, Math.max(MIN, Math.round(scale.value / STEP) * STEP + dir * STEP)), w / 2, h / 2);

	useImperativeHandle(ref, () => ({
		zoomIn: () => stepBy(1),
		zoomOut: () => stepBy(-1),
		fit: () => zoomTo(1, w / 2, h / 2),
		toggleAt: (px, py) => zoomTo(Math.abs(scale.value - 1) < 0.01 ? DOUBLE : 1, px, py),
	}));

	const pinch = Gesture.Pinch()
		.onStart((e) => {
			start.set({ scale: scale.value, x: x.value, y: y.value, fx: e.focalX - w / 2, fy: e.focalY - h / 2 });
		})
		.onUpdate((e) => {
			const s0 = start.value;
			const next = bandedScale(s0.scale * e.scale);
			const k = next / s0.scale;
			const fx = e.focalX - w / 2;
			const fy = e.focalY - h / 2;
			scale.set(next);
			x.set(fx - (s0.fx - s0.x) * k);
			y.set(fy - (s0.fy - s0.y) * k);
		})
		.onEnd(() => settle());

	const pan = Gesture.Pan()
		.averageTouches(true)
		.onStart(() => {
			start.set({ ...start.value, x: x.value, y: y.value });
		})
		.onUpdate((e) => {
			if (Math.abs(scale.value - 1) < 0.01 && onDismiss) {
				dismissY.set(Math.max(0, e.translationY));
				return;
			}
			x.set(start.value.x + e.translationX);
			y.set(start.value.y + e.translationY);
		})
		.onEnd((e) => {
			if (Math.abs(scale.value - 1) < 0.01 && onDismiss) {
				if (sheetShouldDismiss(dismissY.value, h, e.velocityY)) {
					runOnJS(onDismiss)();
					return;
				}
				dismissY.set(withTiming(0, release(dismissY.value, h)));
			}
		});

	const doubleTap = Gesture.Tap()
		.numberOfTaps(2)
		.onEnd((e, ok) => {
			if (ok) zoomTo(Math.abs(scale.value - 1) < 0.01 ? DOUBLE : 1, e.x, e.y);
		});

	const gesture = Gesture.Simultaneous(pinch, pan, doubleTap);
	const style = useAnimatedStyle(() => ({
		transform: [{ translateX: x.value }, { translateY: y.value + dismissY.value }, { scale: scale.value }],
	}));

	return (
		<GestureDetector gesture={gesture}>
			<View
				style={styles.frame}
				onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
				accessible
				accessibilityRole="image"
				accessibilityActions={[
					{ name: "zoomIn", label: t`Zoom in` },
					{ name: "zoomOut", label: t`Zoom out` },
					{ name: "fit", label: t`Fit` },
				]}
				onAccessibilityAction={(e) => {
					const a = e.nativeEvent.actionName;
					if (a === "zoomIn") stepBy(1);
					else if (a === "zoomOut") stepBy(-1);
					else zoomTo(1, w / 2, h / 2);
				}}
			>
				<Animated.View style={[styles.content, style]}>{children}</Animated.View>
			</View>
		</GestureDetector>
	);
}

const styles = StyleSheet.create({
	frame: { flex: 1, overflow: "hidden" },
	content: { flex: 1 },
});
