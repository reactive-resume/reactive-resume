// Content swap crossfade (MOTION.md §2, §12): when `contentKey` changes, the new content fades in over `d2`
// (renders, lists, results, labels) or `d3` (hero cards) while the old content fades out on top of it. Opacity
// only, so the layout takes the new content's size at once (content never jumps). Reduced motion keeps a `d1` fade
// in place, like the overlays.
import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { useLayoutEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { enter, useMotionPolicy } from "./motion";
import { motion } from "./tokens";

type Layer = { key: string | number; node: ReactNode };

export function Crossfade({
	contentKey,
	speed = "d2",
	style,
	children,
}: {
	/** A new key swaps the content with a crossfade; the same key updates it in place. */
	contentKey: string | number;
	speed?: "d2" | "d3";
	style?: StyleProp<ViewStyle>;
	children: ReactNode;
}) {
	const { reduced } = useMotionPolicy();
	const progress = useSharedValue(1);
	const [leaving, setLeaving] = useState<Layer | null>(null);
	const last = useRef<Layer>({ key: contentKey, node: children });
	useLayoutEffect(() => {
		if (last.current.key !== contentKey) {
			const clear = () => setLeaving(null);
			setLeaving(last.current);
			progress.set(0);
			progress.set(
				withTiming(1, enter(reduced ? motion.d1 : motion[speed]), (finished) => {
					if (finished) runOnJS(clear)();
				}),
			);
		}
		last.current = { key: contentKey, node: children };
	}, [contentKey, children, progress, reduced, speed]);
	const incoming = useAnimatedStyle(() => ({ opacity: progress.value }));
	const outgoing = useAnimatedStyle(() => ({ opacity: 1 - progress.value }));
	return (
		<View style={style}>
			<Animated.View style={incoming}>{children}</Animated.View>
			{leaving ? (
				<Animated.View
					key={leaving.key}
					pointerEvents="none"
					accessibilityElementsHidden
					importantForAccessibility="no-hide-descendants"
					style={[StyleSheet.absoluteFill, outgoing]}
				>
					{leaving.node}
				</Animated.View>
			) : null}
		</View>
	);
}
