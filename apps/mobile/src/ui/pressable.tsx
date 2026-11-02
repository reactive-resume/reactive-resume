import type { ComponentRef, Ref } from "react";
import type { PressableProps } from "react-native";
import { useState } from "react";
import { Pressable } from "react-native";
import Animated, { cubicBezier } from "react-native-reanimated";
import { useReducedMotion } from "./motion";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const easeOut = cubicBezier(0.23, 1, 0.32, 1);

type FeedbackPressableProps = PressableProps & { ref?: Ref<ComponentRef<typeof Pressable>> | undefined };

/** Press-in feedback without changing layout or delaying the action on release. */
export function FeedbackPressable({
	style,
	onPressIn,
	onPressOut,
	onHoverIn,
	onHoverOut,
	disabled,
	pressRetentionOffset = 16,
	...props
}: FeedbackPressableProps) {
	const [pressed, setPressed] = useState(false);
	const [hovered, setHovered] = useState(false);
	const reduced = useReducedMotion();
	return (
		<AnimatedPressable
			{...props}
			disabled={disabled}
			pressRetentionOffset={pressRetentionOffset}
			onPressIn={(event) => {
				setPressed(true);
				onPressIn?.(event);
			}}
			onPressOut={(event) => {
				setPressed(false);
				onPressOut?.(event);
			}}
			onHoverIn={(event) => {
				setHovered(true);
				onHoverIn?.(event);
			}}
			onHoverOut={(event) => {
				setHovered(false);
				onHoverOut?.(event);
			}}
			style={[
				typeof style === "function" ? style({ pressed: pressed && !disabled, hovered }) : style,
				{
					transform: [{ scale: pressed && !disabled && !reduced ? 0.97 : 1 }],
					transitionProperty: "transform",
					transitionDuration: reduced ? 0 : 120,
					transitionTimingFunction: easeOut,
				},
			]}
		/>
	);
}
