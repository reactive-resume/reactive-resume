// Spinner (MOTION.md §2, §5, §8): 14 dp, one turn per second, linear, always beside words. With timeScale 0
// (storyboard captures) it stays on its first frame. Reduced motion keeps it turning.
// ponytail: the icon set has no Phosphor `circle-notch`, so the notch is drawn here; swap to <Icon> once it is added.
import { useEffect } from "react";
import Animated, {
	cancelAnimation,
	Easing,
	ReduceMotion,
	type SharedValue,
	useAnimatedStyle,
	useSharedValue,
	withRepeat,
	withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { dur } from "./motion";
import { useTheme } from "./theme";
import { type ColorToken, motion } from "./tokens";

// Phosphor circle-notch (regular), 256 × 256.
const NOTCH =
	"M232,128a104,104,0,0,1-208,0c0-41,23.81-78.36,60.66-95.27a8,8,0,0,1,6.68,14.54C60.15,61.59,40,93.27,40,128a88,88,0,0,0,176,0c0-34.73-20.15-66.41-51.34-80.73a8,8,0,0,1,6.68-14.54C208.19,49.64,232,87,232,128Z";

/** `turns`: drive the rotation yourself (pull to refresh turns with the pull distance) instead of spinning. */
export function Spinner({
	size = 14,
	color = "ink3",
	turns,
}: {
	size?: number;
	color?: ColorToken;
	turns?: SharedValue<number>;
}) {
	const { colors } = useTheme();
	const own = useSharedValue(0);
	const turn = turns ?? own;
	useEffect(() => {
		if (turns) return;
		const ms = dur(motion.spinnerRevolution);
		if (ms > 0)
			turn.set(
				withRepeat(withTiming(1, { duration: ms, easing: Easing.linear, reduceMotion: ReduceMotion.Never }), -1, false),
			);
		return () => cancelAnimation(turn);
	}, [turn, turns]);
	const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * 360}deg` }] }));
	return (
		<Animated.View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={[{ width: size, height: size }, style]}
		>
			<Svg width={size} height={size} viewBox="0 0 256 256">
				<Path d={NOTCH} fill={colors[color]} />
			</Svg>
		</Animated.View>
	);
}
