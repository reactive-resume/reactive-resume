// J3's week strip that expands to a month grid (MOTION.md §7, J3 notes): its height grows d3 `ease-drawer` when
// Month is tapped (ref.expand / toggle, or the `expanded` prop), and follows a downward pull 1:1 (an upward pull
// on the open grid), releasing with release(): open past half way or on a downward fling faster than 500 dp/s,
// closed past half way up or on an upward one. No haptic (J3's `selection` belongs to day changes and week snaps).
// `children` gets the 0 → 1 progress to crossfade the week row into the month grid.
import { type ReactNode, type Ref, useEffect, useImperativeHandle } from "react";
import { StyleSheet } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
	cancelAnimation,
	runOnJS,
	type SharedValue,
	useAnimatedStyle,
	useDerivedValue,
	useSharedValue,
	withTiming,
} from "react-native-reanimated";
import { curve, enter, release, rubberBand } from "./motion";
import { motion } from "./tokens";

const FLING = 500;
const OVERPULL = 24; // how far past either end the strip gives

/** Where a released pull settles: open past half way or on a downward fling, closed on an upward one. */
export function stripShouldOpen(height: number, collapsed: number, expanded: number, velocityY: number) {
	"worklet";
	if (velocityY > FLING) return true;
	if (velocityY < -FLING) return false;
	return height - collapsed > (expanded - collapsed) / 2;
}

export type ExpandingStripHandle = {
	expand: () => void;
	collapse: () => void;
	toggle: () => void;
	/** What the pan does, for the motion lab and tests: pull by dy (down positive), then release with vy (dp/s). */
	pullBy: (dy: number) => void;
	release: (vy: number) => void;
};

export type ExpandingStripProps = {
	collapsedHeight: number;
	expandedHeight: number;
	/** Controlled state; the strip animates to it when it changes. */
	expanded?: boolean;
	onExpandedChange?: (expanded: boolean) => void;
	children: (progress: SharedValue<number>) => ReactNode;
	ref?: Ref<ExpandingStripHandle>;
};

export function ExpandingStrip({
	collapsedHeight,
	expandedHeight,
	expanded = false,
	onExpandedChange,
	children,
	ref,
}: ExpandingStripProps) {
	const h = useSharedValue(expanded ? expandedHeight : collapsedHeight);
	const start = useSharedValue(0);
	const open = useSharedValue(expanded);
	const span = expandedHeight - collapsedHeight;

	const changed = (to: boolean) => onExpandedChange?.(to);

	const animateTo = (to: boolean, fromGesture: boolean) => {
		"worklet";
		const target = to ? expandedHeight : collapsedHeight;
		const config = fromGesture ? release(target - h.value, span) : enter(motion.d3, curve.easeDrawer);
		h.set(withTiming(target, config));
		if (to !== open.value) {
			open.set(to);
			runOnJS(changed)(to);
		}
	};

	const pullTo = (dy: number) => {
		"worklet";
		const raw = start.value + dy;
		h.set(
			raw < collapsedHeight
				? collapsedHeight - rubberBand(collapsedHeight - raw, OVERPULL)
				: raw > expandedHeight
					? expandedHeight + rubberBand(raw - expandedHeight, OVERPULL)
					: raw,
		);
	};

	const releaseAt = (vy: number) => {
		"worklet";
		animateTo(stripShouldOpen(h.value, collapsedHeight, expandedHeight, vy), true);
	};

	useEffect(() => {
		if (expanded !== open.value) animateTo(expanded, false);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [expanded]);

	useImperativeHandle(ref, () => ({
		expand: () => animateTo(true, false),
		collapse: () => animateTo(false, false),
		toggle: () => animateTo(!open.value, false),
		pullBy: (dy) => {
			cancelAnimation(h);
			start.set(h.value);
			pullTo(dy);
		},
		release: (vy) => releaseAt(vy),
	}));

	const pan = Gesture.Pan()
		.activeOffsetY([-10, 10])
		.failOffsetX([-12, 12])
		.onBegin(() => {
			cancelAnimation(h);
			start.set(h.value);
		})
		.onUpdate((e) => pullTo(e.translationY))
		.onEnd((e) => releaseAt(e.velocityY));

	const progress = useDerivedValue(() => (span > 0 ? (h.value - collapsedHeight) / span : 0));
	const style = useAnimatedStyle(() => ({ height: h.value }));

	return (
		<GestureDetector gesture={pan}>
			<Animated.View style={[styles.clip, style]} accessibilityState={{ expanded }}>
				{children(progress)}
			</Animated.View>
		</GestureDetector>
	);
}

const styles = StyleSheet.create({ clip: { overflow: "hidden" } });
