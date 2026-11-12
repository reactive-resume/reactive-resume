// Checkbox (COMPONENTS.md §11, MOTION.md §5): 20 × 20, 6 dp corners, `raised` with a 1 dp `control-border` ring;
// on: `accent` fill and a 14 dp `check`, fading in while scaling 0.6 → 1 in d1. `toggleOn` / `toggleOff` when the
// value saves at once (`saves`, the default).
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Touch } from "./base";
import { Icon } from "./Icon";
import { enter, haptic, hitSlopFor } from "./motion";
import { useTheme } from "./theme";
import { motion, radius } from "./tokens";
import { useDesignTag } from "@/dev/storyboard/harness";

const SIZE = 20;

export type CheckboxProps = {
	value: boolean;
	onValueChange?: (next: boolean) => void;
	/** False when the change is only staged (a form saved later): no toggle haptic. */
	saves?: boolean;
	disabled?: boolean;
	/** False when a row owns the press. */
	interactive?: boolean;
	accessibilityLabel?: string;
	testID?: string;
};

export function Checkbox({
	value,
	onValueChange,
	saves = true,
	disabled = false,
	interactive = true,
	accessibilityLabel,
	testID,
}: CheckboxProps) {
	const { colors } = useTheme();
	const ref = useDesignTag({
		kind: "component",
		component: "Checkbox",
		radius: radius.xs,
		bg: value ? "accent" : "raised",
	});
	const p = useSharedValue(value ? 1 : 0);
	useEffect(() => {
		p.set(withTiming(value ? 1 : 0, enter(motion.d1)));
	}, [value, p]);
	const fill = useAnimatedStyle(() => ({
		opacity: p.value,
		transform: [{ scale: interpolate(p.value, [0, 1], [0.6, 1]) }],
	}));

	const drawing = (
		<View
			ref={ref}
			collapsable={false}
			style={[
				styles.box,
				{
					backgroundColor: colors.raised,
					boxShadow: `inset 0 0 0 1px ${colors.controlBorder}`,
					opacity: disabled ? 0.45 : 1,
				},
			]}
		>
			<Animated.View style={[styles.fill, { backgroundColor: colors.accent }, fill]}>
				{/* S7, the only Checkbox in the dumps, lists no icon of its own. */}
				<Icon name="check" size={14} color="onAccent" tag={false} />
			</Animated.View>
		</View>
	);
	if (!interactive) return <View pointerEvents="none">{drawing}</View>;
	return (
		<Touch
			feedback="none"
			disabled={disabled}
			hitSlop={hitSlopFor(SIZE, SIZE)}
			accessibilityRole="checkbox"
			accessibilityLabel={accessibilityLabel}
			accessibilityState={{ checked: value }}
			testID={testID}
			onPress={
				onValueChange
					? () => {
							if (saves) haptic(value ? "toggleOff" : "toggleOn");
							onValueChange(!value);
						}
					: undefined
			}
		>
			{drawing}
		</Touch>
	);
}

const styles = StyleSheet.create({
	box: { width: SIZE, height: SIZE, borderRadius: radius.xs },
	fill: { ...StyleSheet.absoluteFill, borderRadius: radius.xs, alignItems: "center", justifyContent: "center" },
});
