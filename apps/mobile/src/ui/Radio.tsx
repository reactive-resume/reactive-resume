// Radio (COMPONENTS.md §11, MOTION.md §5): 20 dp circle, `raised` with a 1 dp `control-border` ring; on: a 1 dp
// `accent` ring and a 10 dp `accent` dot that scales 0 → 1 in d1. `selection` when the person picks it (J7).
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Touch } from "./base";
import { enter, haptic, hitSlopFor } from "./motion";
import { useTheme } from "./theme";
import { motion, radius } from "./tokens";
import { useDesignTag } from "@/dev/storyboard/harness";

const SIZE = 20;
const DOT = 10;

export type RadioProps = {
	selected: boolean;
	onSelect?: () => void;
	/** False when a row owns the press (radio rows); the row then plays `selection` through `selectRadio`. */
	interactive?: boolean;
	disabled?: boolean;
	accessibilityLabel?: string;
	testID?: string;
};

/** What a radio row's press does: `selection`, then the change (no haptic when it is already selected). */
export function selectRadio(selected: boolean, onSelect: () => void) {
	if (selected) return;
	haptic("selection");
	onSelect();
}

export function Radio({
	selected,
	onSelect,
	interactive = true,
	disabled = false,
	accessibilityLabel,
	testID,
}: RadioProps) {
	const { colors } = useTheme();
	const ref = useDesignTag({ kind: "component", component: "Radio", radius: radius.full, bg: "raised" });
	const p = useSharedValue(selected ? 1 : 0);
	useEffect(() => {
		p.set(withTiming(selected ? 1 : 0, enter(motion.d1)));
	}, [selected, p]);
	const dot = useAnimatedStyle(() => ({ transform: [{ scale: p.value }] }));
	const onRing = useAnimatedStyle(() => ({ opacity: p.value }));

	const drawing = (
		<View
			ref={ref}
			collapsable={false}
			style={[
				styles.circle,
				{
					backgroundColor: colors.raised,
					boxShadow: `inset 0 0 0 1px ${colors.controlBorder}`,
					opacity: disabled ? 0.45 : 1,
				},
			]}
		>
			<Animated.View
				style={[styles.ring, { boxShadow: `inset 0 0 0 1px ${colors.accent}`, backgroundColor: colors.raised }, onRing]}
			/>
			<Animated.View style={[styles.dot, { backgroundColor: colors.accent }, dot]} />
		</View>
	);
	if (!interactive) return <View pointerEvents="none">{drawing}</View>;
	return (
		<Touch
			feedback="none"
			disabled={disabled}
			hitSlop={hitSlopFor(SIZE, SIZE)}
			accessibilityRole="radio"
			accessibilityLabel={accessibilityLabel}
			accessibilityState={{ checked: selected }}
			testID={testID}
			onPress={onSelect ? () => selectRadio(selected, onSelect) : undefined}
		>
			{drawing}
		</Touch>
	);
}

const styles = StyleSheet.create({
	circle: { width: SIZE, height: SIZE, borderRadius: radius.full, alignItems: "center", justifyContent: "center" },
	ring: { ...StyleSheet.absoluteFill, borderRadius: radius.full },
	dot: { width: DOT, height: DOT, borderRadius: radius.full },
});
