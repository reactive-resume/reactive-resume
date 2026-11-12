// Field focus and error rings (COMPONENTS.md §10, MOTION.md §5) as an overlay the TextField draws over its input:
// focus = 1 dp inner `accent` ring plus a 3 dp outer `accent-soft` ring; error = `danger` / `danger-soft`. Rings fade
// in d1; the error state swaps colour in d1. The resting 1 dp `control-border` ring is the field's own.
import { useEffect } from "react";
import { StyleSheet } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { enter, leave } from "./motion";
import { useTheme } from "./theme";
import { motion, radius as radii } from "./tokens";

export function FocusRing({
	focused,
	error = false,
	radius = radii.md,
}: {
	focused: boolean;
	error?: boolean;
	radius?: number;
}) {
	const { colors } = useTheme();
	const show = useSharedValue(focused || error ? 1 : 0);
	const danger = useSharedValue(error ? 1 : 0);
	useEffect(() => {
		show.set(withTiming(focused || error ? 1 : 0, focused || error ? enter(motion.d1) : leave(motion.d1)));
	}, [focused, error, show]);
	useEffect(() => {
		danger.set(withTiming(error ? 1 : 0, enter(motion.d1)));
	}, [error, danger]);
	const accentStyle = useAnimatedStyle(() => ({ opacity: show.value * (1 - danger.value) }));
	const dangerStyle = useAnimatedStyle(() => ({ opacity: show.value * danger.value }));
	const ring = (inner: string, outer: string) => ({
		borderRadius: radius,
		boxShadow: `inset 0 0 0 1px ${inner}, 0 0 0 3px ${outer}`,
	});
	return (
		<>
			<Animated.View
				pointerEvents="none"
				style={[StyleSheet.absoluteFill, ring(colors.accent, colors.accentSoft), accentStyle]}
			/>
			<Animated.View
				pointerEvents="none"
				style={[StyleSheet.absoluteFill, ring(colors.danger, colors.dangerSoft), dangerStyle]}
			/>
		</>
	);
}
