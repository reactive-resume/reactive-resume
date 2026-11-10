// Segmented control (COMPONENTS.md §9, MOTION.md §5): `sunken` 12 dp track, 40 dp items, the selected `raised`
// thumb with a 1 dp `control-border` inner ring and `sh1` slides d2 `ease-in-out-strong`; labels crossfade d2;
// `selection` when the person picks another option. At most three options.
import { type ReactNode, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { type SharedValue, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Touch } from "./base";
import { curve, enter, haptic, hitSlopFor } from "./motion";
import { Text } from "./Text";
import { useTheme } from "./theme";
import { motion, radius } from "./tokens";
import { useDesignTag } from "@/dev/storyboard/harness";

const PAD = 2;
const GAP = 2;
const ITEM_H = 40;

/** What tapping a segment does: `selection` and the change, nothing when it is already selected. */
export function selectSegment<K extends string>(current: K, next: K, onChange: (key: K) => void) {
	if (next === current) return;
	haptic("selection");
	onChange(next);
}

export type SegmentedOption<K extends string> = { key: K; label: string };

export type SegmentedProps<K extends string> = {
	options: readonly SegmentedOption<K>[];
	value: K;
	onChange: (key: K) => void;
	accessibilityLabel?: string;
	/** Motion lab only: a literal colour for the thumb. */
	labMarker?: string;
};

export function Segmented<K extends string>({
	options,
	value,
	onChange,
	accessibilityLabel,
	labMarker,
}: SegmentedProps<K>) {
	const { colors, shadows } = useTheme();
	const ref = useDesignTag({ kind: "component", component: "Segmented", radius: radius.lg, bg: "sunken" });
	const [width, setWidth] = useState(0);
	const n = options.length;
	const itemW = width > 0 ? (width - PAD * 2 - GAP * (n - 1)) / n : 0;
	const index = Math.max(
		0,
		options.findIndex((o) => o.key === value),
	);
	const x = useSharedValue(index);

	useEffect(() => {
		x.set(withTiming(index, enter(motion.d2, curve.easeInOutStrong)));
	}, [index, x]);

	const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * (itemW + GAP) }] }));

	return (
		<View
			ref={ref}
			collapsable={false}
			accessibilityRole="tablist"
			accessibilityLabel={accessibilityLabel}
			onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
			style={[styles.track, { backgroundColor: colors.sunken }]}
		>
			{itemW > 0 && (
				<Animated.View
					pointerEvents="none"
					style={[
						styles.thumb,
						{
							width: itemW,
							backgroundColor: labMarker ?? colors.raised,
							boxShadow: `inset 0 0 0 1px ${colors.controlBorder}, ${shadows.sh1}`,
						},
						thumb,
					]}
				/>
			)}
			{options.map((o) => (
				<Touch
					key={o.key}
					feedback="none"
					style={styles.item}
					hitSlop={hitSlopFor(itemW, ITEM_H)}
					accessibilityRole="tab"
					accessibilityLabel={o.label}
					accessibilityState={{ selected: o.key === value }}
					onPress={() => selectSegment(value, o.key, onChange)}
				>
					<Label label={o.label} selected={o.key === value} />
				</Touch>
			))}
		</View>
	);
}

function Label({ label, selected }: { label: string; selected: boolean }) {
	const s = useSharedValue(selected ? 1 : 0);
	useEffect(() => {
		s.set(withTiming(selected ? 1 : 0, enter(motion.d2)));
	}, [selected, s]);
	return (
		<>
			<Layer s={s} on={false}>
				<Text variant="segment" color="ink2" numberOfLines={1} tag={!selected}>
					{label}
				</Text>
			</Layer>
			<Layer s={s} on>
				<Text variant="segment" color="ink" weight={600} numberOfLines={1} tag={selected}>
					{label}
				</Text>
			</Layer>
		</>
	);
}

function Layer({ s, on, children }: { s: SharedValue<number>; on: boolean; children: ReactNode }) {
	const style = useAnimatedStyle(() => ({ opacity: on ? s.value : 1 - s.value }));
	return <Animated.View style={[styles.layer, style]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
	track: { flexDirection: "row", padding: PAD, gap: GAP, borderRadius: radius.lg },
	thumb: { position: "absolute", top: PAD, left: PAD, height: ITEM_H, borderRadius: radius.md },
	item: { flex: 1, height: ITEM_H, borderRadius: radius.md },
	layer: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
});
