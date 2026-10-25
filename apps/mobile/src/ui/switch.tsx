import { useEffect } from "react";
import { I18nManager, Platform, Pressable } from "react-native";
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { haptics, useReducedMotion } from "./motion";
import { useTheme } from "./theme";

const android = Platform.OS === "android";

export type SwitchProps = {
	value: boolean;
	onValueChange: (value: boolean) => void;
	/** The accessible name when the switch has no visible label next to it. */
	label?: string | undefined;
	disabled?: boolean | undefined;
};

// tokens.md §7: iOS 51×31 track with a 27 pt thumb; Android Material 3 52×32 with a 16 pt thumb off, 24 pt on.
const track = android ? { width: 52, height: 32 } : { width: 51, height: 31 };

export function Switch({ value, onValueChange, label, disabled }: SwitchProps) {
	const { colors, motion, radius, shadows, size } = useTheme();
	const reduced = useReducedMotion();
	const progress = useSharedValue(value ? 1 : 0);

	useEffect(() => {
		progress.set(withTiming(value ? 1 : 0, { duration: reduced ? 0 : motion.d1 }));
	}, [value, progress, motion.d1, reduced]);

	const off = android ? colors.sunken : colors.lineStrong;
	const direction = I18nManager.isRTL ? -1 : 1;
	const trackStyle = useAnimatedStyle(() => ({
		backgroundColor: interpolateColor(progress.get(), [0, 1], [off, colors.accent]),
		borderColor: interpolateColor(progress.get(), [0, 1], [colors.lineStrong, colors.accent]),
	}));
	const thumbStyle = useAnimatedStyle(() => {
		if (!android) return { transform: [{ translateX: progress.get() * 20 * direction }] };
		return {
			transform: [{ translateX: (2 + progress.get() * 20) * direction }, { scale: (16 + progress.get() * 8) / 24 }],
			backgroundColor: interpolateColor(progress.get(), [0, 1], [colors.lineStrong, colors.onAccent]),
		};
	});
	const slop = (size.hit - track.height) / 2;

	return (
		<Pressable
			accessibilityRole="switch"
			accessibilityLabel={label}
			accessibilityState={{ checked: value, disabled: !!disabled }}
			disabled={disabled}
			hitSlop={{ top: slop, bottom: slop }}
			onPress={() => {
				haptics.selection();
				onValueChange(!value);
			}}
			style={{ opacity: disabled ? 0.45 : 1 }}
		>
			<Animated.View
				style={[
					{ ...track, borderRadius: radius.rLg, borderWidth: android ? 2 : 0, padding: android ? 0 : 2 },
					trackStyle,
				]}
			>
				<Animated.View
					style={[
						{
							width: android ? 24 : 27,
							height: android ? 24 : 27,
							borderRadius: radius.rSm,
							backgroundColor: colors.raised,
						},
						android ? { marginTop: 2 } : { boxShadow: shadows.e1.boxShadow },
						thumbStyle,
					]}
				/>
			</Animated.View>
		</Pressable>
	);
}
