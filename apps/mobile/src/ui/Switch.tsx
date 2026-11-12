// Switch (COMPONENTS.md §11, MOTION.md §5): 40 × 24, thumb slides 16 dp in d1 `ease`, track crossfades
// control-border ↔ accent, `toggleOn` / `toggleOff` on a user change. A whole switch row toggles: give the row
// `useSwitchRow()` and draw the switch with `interactive={false}`.
import { useCallback, useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Touch } from "./base";
import { enter, haptic, hitSlopFor } from "./motion";
import { useTheme } from "./theme";
import { motion, radius } from "./tokens";
import { useDesignTag } from "@/dev/storyboard/harness";

const W = 40;
const H = 24;
const THUMB = 18;
const INSET = 3;
const TRAVEL = W - THUMB - INSET * 2; // 16

/** Flip a switch value the way a user does: the component's haptic, then the change. */
export function toggleValue(value: boolean, onValueChange: (next: boolean) => void) {
	const next = !value;
	haptic(next ? "toggleOn" : "toggleOff");
	onValueChange(next);
}

/** Props for a row that owns the switch's target (the whole 64 dp row toggles). Spread onto ListRow or Touch. */
export function useSwitchRow(value: boolean, onValueChange: (next: boolean) => void, disabled = false) {
	const onPress = useCallback(() => toggleValue(value, onValueChange), [value, onValueChange]);
	return {
		onPress: disabled ? undefined : onPress,
		accessibilityRole: "switch" as const,
		accessibilityState: { checked: value, disabled },
	};
}

export type SwitchProps = {
	value: boolean;
	onValueChange?: (next: boolean) => void;
	disabled?: boolean;
	/** False when a row owns the press (useSwitchRow); the switch then only draws. */
	interactive?: boolean;
	accessibilityLabel?: string;
	testID?: string;
	/** Motion lab only: a literal colour for the thumb. */
	labMarker?: string;
};

export function Switch({
	value,
	onValueChange,
	disabled = false,
	interactive = true,
	accessibilityLabel,
	testID,
	labMarker,
}: SwitchProps) {
	const { colors, shadows } = useTheme();
	const p = useSharedValue(value ? 1 : 0);
	const ref = useDesignTag({
		kind: "component",
		component: "Switch",
		radius: radius.full,
		bg: value ? "accent" : "sunken",
	});

	useEffect(() => {
		p.set(withTiming(value ? 1 : 0, enter(motion.d1)));
	}, [value, p]);

	const on = useAnimatedStyle(() => ({ opacity: p.value }));
	const ring = useAnimatedStyle(() => ({ opacity: 1 - p.value }));
	const thumb = useAnimatedStyle(() => ({
		transform: [{ translateX: INSET + TRAVEL * p.value }],
		backgroundColor: labMarker ?? interpolateColor(p.value, [0, 1], [colors.controlBorder, colors.onAccent]),
	}));
	const thumbShadow = useAnimatedStyle(() => ({
		opacity: p.value,
		transform: [{ translateX: INSET + TRAVEL * p.value }],
	}));

	const drawing = (
		<View
			ref={ref}
			collapsable={false}
			style={[styles.track, { backgroundColor: colors.sunken, opacity: disabled ? 0.45 : 1 }]}
		>
			<Animated.View
				style={[StyleSheet.absoluteFill, { backgroundColor: colors.accent, borderRadius: radius.full }, on]}
			/>
			<Animated.View
				style={[
					StyleSheet.absoluteFill,
					{ borderRadius: radius.full, borderWidth: 1, borderColor: colors.controlBorder },
					ring,
				]}
			/>
			<Animated.View
				style={[styles.thumb, { boxShadow: shadows.sh1, backgroundColor: colors.onAccent }, thumbShadow]}
			/>
			<Animated.View style={[styles.thumb, thumb]} />
		</View>
	);

	if (!interactive) return <View pointerEvents="none">{drawing}</View>;
	return (
		<Touch
			feedback="none"
			disabled={disabled}
			onPress={onValueChange ? () => toggleValue(value, onValueChange) : undefined}
			hitSlop={hitSlopFor(W, H)}
			accessibilityRole="switch"
			accessibilityLabel={accessibilityLabel}
			accessibilityState={{ checked: value }}
			testID={testID}
		>
			{drawing}
		</Touch>
	);
}

const styles = StyleSheet.create({
	track: { width: W, height: H, borderRadius: radius.full },
	thumb: { position: "absolute", top: INSET, left: 0, width: THUMB, height: THUMB, borderRadius: radius.full },
});
