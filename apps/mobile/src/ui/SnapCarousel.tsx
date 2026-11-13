// Carousels and pagers (MOTION.md §7): B7 templates (180 dp cards, the next one peeks), J2 board columns (300 dp,
// 16 dp apart, from 24 dp), J3 weeks (full width), C6 columns. The row pans 1:1 with the finger; on release it snaps
// to the nearest item, or to the next one in the fling's direction when flung faster than 500 dp/s, in d3
// `ease-out-strong`, with `selection` when the snapped item changes. Not pagingEnabled/snapToInterval (platform
// physics). RTL: items run from the right and the swipe mirrors.
//   Visible alternatives (J3's week arrows, J2's stage button) call ref.scrollToIndex(i): same motion, same haptic.
//   Pass `accessibilityLabel` to make the pager one adjustable element (swipe up / down pages); without it the items
//   stay individually accessible and the screen's visible taps are the alternative.
import { t } from "@lingui/core/macro";
import { type ReactNode, type Ref, useEffect, useImperativeHandle, useState } from "react";
import { I18nManager, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
	cancelAnimation,
	runOnJS,
	useAnimatedStyle,
	useSharedValue,
	withTiming,
} from "react-native-reanimated";
import { curve, enter, haptic, rubberBand } from "./motion";
import { motion } from "./tokens";

/** Fling speed (dp/s) past which a release goes to the next item instead of the nearest. */
export const FLING_VELOCITY = 500;

/**
 * The item a release settles on. `offset` is the row's scroll offset (dp, toward later items positive), `velocity`
 * the finger's speed in the same direction (a finger moving toward earlier items scrolls toward later ones).
 */
export function snapTarget(offset: number, velocity: number, pitch: number, count: number) {
	"worklet";
	const last = Math.max(0, count - 1);
	const at = pitch > 0 ? offset / pitch : 0;
	let target = Math.round(at);
	if (velocity > FLING_VELOCITY) target = Math.max(target, Math.floor(at) + 1);
	else if (velocity < -FLING_VELOCITY) target = Math.min(target, Math.ceil(at) - 1);
	return Math.max(0, Math.min(last, target));
}

export type SnapCarouselHandle = {
	/** Page to item `i` (week arrows, the stage button, a dragged card held at an edge). Plays `selection` on a change. */
	scrollToIndex: (i: number) => void;
	/** The item the row rests on (or is heading to). */
	index: () => number;
	/** The item under `x` (dp from the carousel's leading edge, in layout direction). */
	indexAt: (x: number) => number;
	/** Where item `i` starts now (dp from the carousel's left edge, in screen coordinates). */
	itemX: (i: number) => number;
	/** What the pan does, for the motion lab and tests: move the row by dx (finger dp), then release with vx (dp/s). */
	panBy: (dx: number) => void;
	release: (vx: number) => void;
};

export type SnapCarouselProps<T> = {
	data: readonly T[];
	keyOf: (item: T) => string;
	itemWidth: number;
	/** Space between items (J2: 16). */
	gap?: number;
	/** Space before the first item and after the last (J2: 24). */
	inset?: number;
	renderItem: (item: T, ctx: { index: number; selected: boolean }) => ReactNode;
	/** The item to rest on. Changing it pages there silently (the person's own pages go through the ref). */
	index?: number;
	onIndexChange?: (index: number) => void;
	/** Makes the pager one adjustable accessibility element with this label. */
	accessibilityLabel?: string;
	/** The value read with it ("Week of 9 November"); defaults to "2 of 6". */
	accessibilityValueText?: (index: number) => string;
	style?: StyleProp<ViewStyle>;
	ref?: Ref<SnapCarouselHandle>;
};

export function SnapCarousel<T>({
	data,
	keyOf,
	itemWidth,
	gap = 0,
	inset = 0,
	renderItem,
	index: indexProp = 0,
	onIndexChange,
	accessibilityLabel,
	accessibilityValueText,
	style,
	ref,
}: SnapCarouselProps<T>) {
	const count = data.length;
	const pitch = itemWidth + gap;
	const rtl = I18nManager.isRTL;
	const dir = rtl ? -1 : 1; // finger dx → offset change is -dir·dx
	const offset = useSharedValue(indexProp * pitch);
	const start = useSharedValue(0);
	const [current, setCurrent] = useState(indexProp);
	const [width, setWidth] = useState(0);
	const settled = useSharedValue(indexProp);

	const landed = (i: number, fromPerson: boolean) => {
		setCurrent(i);
		if (fromPerson) haptic("selection");
		onIndexChange?.(i);
	};

	const snapTo = (i: number, fromPerson: boolean) => {
		"worklet";
		const changed = i !== settled.value;
		settled.set(i);
		offset.set(withTiming(i * pitch, enter(motion.d3, curve.easeOutStrong)));
		if (changed) runOnJS(landed)(i, fromPerson);
	};

	const dragTo = (dx: number) => {
		"worklet";
		const raw = start.value - dir * dx;
		const max = Math.max(0, (count - 1) * pitch);
		offset.set(raw < 0 ? -rubberBand(-raw, itemWidth) : raw > max ? max + rubberBand(raw - max, itemWidth) : raw);
	};

	const releaseAt = (vx: number) => {
		"worklet";
		snapTo(snapTarget(offset.value, -dir * vx, pitch, count), true);
	};

	// The parent's index: page there without a haptic.
	useEffect(() => {
		if (indexProp !== settled.value) snapTo(Math.max(0, Math.min(count - 1, indexProp)), false);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [indexProp]);

	useImperativeHandle(ref, () => ({
		scrollToIndex: (i) => snapTo(Math.max(0, Math.min(count - 1, i)), true),
		index: () => settled.value,
		indexAt: (x) => Math.max(0, Math.min(count - 1, Math.floor((offset.value + x - inset + gap / 2) / pitch))),
		itemX: (i) => {
			const lead = inset + i * pitch - offset.value;
			return rtl ? width - lead - itemWidth : lead;
		},
		panBy: (dx) => {
			cancelAnimation(offset);
			start.set(offset.value);
			dragTo(dx);
		},
		release: (vx) => releaseAt(vx),
	}));

	const pan = Gesture.Pan()
		.activeOffsetX([-8, 8])
		.failOffsetY([-12, 12])
		.onBegin(() => {
			// Interruptible: a grab during a snap continues from where the row is.
			cancelAnimation(offset);
			start.set(offset.value);
		})
		.onUpdate((e) => dragTo(e.translationX))
		.onEnd((e) => releaseAt(e.velocityX));

	const row = useAnimatedStyle(() => ({ transform: [{ translateX: -dir * offset.value }] }));

	const step = (by: -1 | 1) => snapTo(Math.max(0, Math.min(count - 1, current + by)), true);
	const a11y = accessibilityLabel
		? {
				accessible: true,
				accessibilityRole: "adjustable" as const,
				accessibilityLabel,
				accessibilityValue: { text: accessibilityValueText?.(current) ?? t`${current + 1} of ${count}` },
				accessibilityActions: [{ name: "increment" as const }, { name: "decrement" as const }],
				onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) =>
					step(e.nativeEvent.actionName === "increment" ? 1 : -1),
			}
		: {};

	return (
		<GestureDetector gesture={pan}>
			<View {...a11y} style={[styles.clip, style]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
				<Animated.View style={[styles.row, { paddingStart: inset, paddingEnd: inset, gap }, row]}>
					{data.map((item, i) => (
						<View
							key={keyOf(item)}
							style={{ width: itemWidth }}
							importantForAccessibility={accessibilityLabel ? "no-hide-descendants" : "auto"}
						>
							{renderItem(item, { index: i, selected: i === current })}
						</View>
					))}
				</Animated.View>
			</View>
		</GestureDetector>
	);
}

const styles = StyleSheet.create({
	clip: { overflow: "hidden" },
	row: { flexDirection: "row", alignSelf: "flex-start" },
});
