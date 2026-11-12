// Working label (MOTION.md §5, §8): AI work in progress. Steps every 2200 ms with a d2 crossfade and stays on the
// last step ("Still working"). The spinner sits beside the words; Stop belongs to the screen.
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from "react-native-reanimated";
import { dur, enter, leave } from "./motion";
import { Spinner } from "./Spinner";
import { Text } from "./Text";
import { motion } from "./tokens";

/** Index of the step shown after `elapsed` ms: one step per 2.2 s, holding on the last. */
export function workingStep(elapsed: number, steps: number) {
	return Math.min(steps - 1, Math.floor(elapsed / motion.workingLabelStep));
}

export function WorkingLabel({ steps }: { steps: readonly string[] }) {
	const [i, setI] = useState(0);
	const opacity = useSharedValue(1);
	useEffect(() => {
		if (i >= steps.length - 1) return;
		const ms = dur(motion.workingLabelStep);
		if (ms === 0) return; // storyboard captures hold the first step
		let swap: ReturnType<typeof setTimeout> | undefined;
		const id = setTimeout(() => {
			opacity.set(withSequence(withTiming(0, leave(motion.d2)), withTiming(1, enter(motion.d2))));
			swap = setTimeout(() => setI((n) => n + 1), dur(Math.round(motion.d2 * motion.exitFactor)));
		}, ms);
		return () => {
			clearTimeout(id);
			clearTimeout(swap);
		};
	}, [i, steps.length, opacity]);
	const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
	return (
		<View style={styles.row} accessibilityLiveRegion="polite">
			<Spinner />
			<Animated.View style={style}>
				<Text variant="ui" color="ink3">
					{steps[i]}
				</Text>
			</Animated.View>
		</View>
	);
}

const styles = StyleSheet.create({ row: { flexDirection: "row", alignItems: "center", gap: 8 } });
