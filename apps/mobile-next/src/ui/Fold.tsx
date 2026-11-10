import type {
	EntryAnimationsValues,
	EntryExitAnimationFunction,
	ExitAnimationsValues,
	LayoutAnimationFunction,
	LayoutAnimationsValues,
} from "react-native-reanimated";
// Rows that leave and return (MOTION.md §7) as Reanimated layout-animation configs:
//   <Animated.View exiting={foldOut} entering={foldIn} layout={layoutShift} style={{ overflow: "hidden" }}>
// foldOut: height to 0 with a fade, d2 `ease`. foldIn (Undo re-inserts the row): the reverse. layoutShift: rows
// below close (or open) the gap, d2 `ease`. fadeUpIn: a new entry fades up 6 dp in d2 at the end of a list.
// Every duration goes through timeScale (read on the UI thread when the animation starts). Never use these on a
// document page: its reflow never animates.
import { useMemo } from "react";
import { withTiming } from "react-native-reanimated";
import { enter, leave, useMotionPolicy } from "./motion";
import { motion } from "./tokens";

export const foldOut = (v: ExitAnimationsValues) => {
	"worklet";
	return {
		initialValues: { height: v.currentHeight, opacity: 1 },
		animations: { height: withTiming(0, enter(motion.d2)), opacity: withTiming(0, enter(motion.d2)) },
	};
};

export const foldIn = (v: EntryAnimationsValues) => {
	"worklet";
	return {
		initialValues: { height: 0, opacity: 0 },
		animations: { height: withTiming(v.targetHeight, enter(motion.d2)), opacity: withTiming(1, enter(motion.d2)) },
	};
};

export const layoutShift: LayoutAnimationFunction = (v: LayoutAnimationsValues) => {
	"worklet";
	const t = enter(motion.d2);
	return {
		initialValues: {
			originX: v.currentOriginX,
			originY: v.currentOriginY,
			width: v.currentWidth,
			height: v.currentHeight,
		},
		animations: {
			originX: withTiming(v.targetOriginX, t),
			originY: withTiming(v.targetOriginY, t),
			width: withTiming(v.targetWidth, t),
			height: withTiming(v.targetHeight, t),
		},
	};
};

export const fadeUpIn = () => {
	"worklet";
	return {
		initialValues: { opacity: 0, transform: [{ translateY: motion.fadeUp }] },
		animations: {
			opacity: withTiming(1, enter(motion.d2)),
			transform: [{ translateY: withTiming(0, enter(motion.d2)) }],
		},
	};
};

const fadeOutReduced = () => {
	"worklet";
	return { initialValues: { opacity: 1 }, animations: { opacity: withTiming(0, leave(motion.d1)) } };
};
const fadeInReduced = () => {
	"worklet";
	return { initialValues: { opacity: 0 }, animations: { opacity: withTiming(1, enter(motion.d1)) } };
};

/**
 * The configs for the current reduced-motion setting: reduced motion keeps a d1 fade in place and drops the
 * height and position changes (rows below jump).
 */
export function useRowMotion(): {
	foldOut: EntryExitAnimationFunction;
	foldIn: EntryExitAnimationFunction;
	fadeUpIn: EntryExitAnimationFunction;
	layoutShift: LayoutAnimationFunction | undefined;
} {
	const { reduced } = useMotionPolicy();
	return useMemo(
		() =>
			reduced
				? { foldOut: fadeOutReduced, foldIn: fadeInReduced, fadeUpIn: fadeInReduced, layoutShift: undefined }
				: { foldOut, foldIn, fadeUpIn, layoutShift },
		[reduced],
	);
}
