// Swipe actions on a row (MOTION.md §7). `start`: the row moves toward the start (Move to Trash, Delete, Done,
// Delete permanently); `end`: toward the end (Move to the next stage). The row follows the finger; the action shows
// underneath (`danger-fill` for removals, `accent` otherwise). At 40% of the width it arms: the action fills, d1,
// and `light` plays (again only after going back under). Release while armed commits: the row slides out d2 `ease`
// and onCommit runs (the list then folds it with `foldOut`); `slides: false` (D6) settles back and runs onCommit
// (it opens its dialog). Release before 40% settles back with `release()`. Every action is also an accessibility
// action, and the same actions live in the row's ··· and long-press sheet.
import { type ReactNode, useState } from "react";
import { I18nManager, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
	runOnJS,
	type SharedValue,
	useAnimatedReaction,
	useAnimatedStyle,
	useSharedValue,
	withTiming,
} from "react-native-reanimated";
import { Icon, type IconName } from "./Icon";
import { enter, haptic, hapticOnUI, release } from "./motion";
import { Text } from "./Text";
import { useTheme } from "./theme";
import { type ColorToken, motion } from "./tokens";

export type SwipeAction = {
	key: string;
	label: string;
	icon: IconName;
	tone: "danger" | "accent";
	onCommit: () => void;
	/** False when committing opens a dialog instead of removing the row (D6 Delete permanently). */
	slides?: boolean;
};

export type SwipeRowProps = {
	/** Revealed when the row moves toward the start. */
	start?: SwipeAction;
	/** Revealed when the row moves toward the end. */
	end?: SwipeAction;
	children: ReactNode;
};

/**
 * The threshold rule: arms at 40% of the width, `buzz` only when crossing outward; going back under disarms, so a
 * second crossing buzzes again.
 */
export function swipeArm(armed: boolean, x: number, width: number): { armed: boolean; buzz: boolean } {
	"worklet";
	const past = width > 0 && Math.abs(x) >= width * motion.swipeCommitFraction;
	return { armed: past, buzz: past && !armed };
}

const fills: Record<SwipeAction["tone"], { bg: ColorToken; on: ColorToken; idle: ColorToken }> = {
	danger: { bg: "dangerFill", on: "paper", idle: "dangerText" },
	accent: { bg: "accent", on: "onAccent", idle: "accentText" },
};

export function SwipeRow({ start, end, children }: SwipeRowProps) {
	const { colors } = useTheme();
	const [width, setWidth] = useState(0);
	const tx = useSharedValue(0); // physical px, + = right
	const armed = useSharedValue(0); // 0 | 1, for the action's look
	const rtl = I18nManager.isRTL;
	// "toward the start" is leftward in LTR.
	const startSign = rtl ? 1 : -1;
	const canStart = !!start;
	const canEnd = !!end;
	const startSlides = start?.slides !== false;
	const endSlides = end?.slides !== false;

	const commit = (which: "start" | "end") => {
		const a = which === "start" ? start : end;
		a?.onCommit();
	};

	const pan = Gesture.Pan()
		.activeOffsetX([-12, 12])
		.failOffsetY([-10, 10])
		.onUpdate((e) => {
			let x = e.translationX;
			const towardStart = x * startSign > 0;
			if ((towardStart && !canStart) || (!towardStart && !canEnd)) x = 0;
			tx.set(x);
			const next = swipeArm(armed.value === 1, x, width);
			armed.set(next.armed ? 1 : 0);
			if (next.buzz) hapticOnUI("light");
		})
		.onEnd(() => {
			const x = tx.value;
			if (armed.value === 1) {
				const which = x * startSign > 0 ? "start" : "end";
				const slides = which === "start" ? startSlides : endSlides;
				if (slides) {
					tx.set(
						withTiming(Math.sign(x) * width, enter(motion.d2), (done) => {
							if (done) runOnJS(commit)(which);
						}),
					);
				} else {
					armed.set(0);
					tx.set(withTiming(0, release(x, width)));
					runOnJS(commit)(which);
				}
				return;
			}
			tx.set(withTiming(0, release(x, width)));
		});

	const [side, setSide] = useState<"start" | "end" | null>(null);
	useAnimatedReaction(
		() => (tx.value === 0 ? null : tx.value * startSign > 0 ? "start" : "end"),
		(now, before) => {
			if (now !== before) runOnJS(setSide)(now);
		},
	);
	const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));
	const action = side === "start" ? start : side === "end" ? end : undefined;

	const actions = [start, end].filter((a): a is SwipeAction => !!a);
	return (
		<View
			onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
			accessibilityActions={actions.map((a) => ({ name: a.key, label: a.label }))}
			onAccessibilityAction={(e) => {
				const a = actions.find((x) => x.key === e.nativeEvent.actionName);
				if (!a) return;
				if (a.slides !== false) haptic("light");
				a.onCommit();
			}}
		>
			{action ? <Underlay action={action} armed={armed} towardStart={side === "start"} /> : null}
			<GestureDetector gesture={pan}>
				<Animated.View style={[{ backgroundColor: colors.bg }, rowStyle]}>{children}</Animated.View>
			</GestureDetector>
		</View>
	);
}

function Underlay({
	action,
	armed,
	towardStart,
}: {
	action: SwipeAction;
	armed: SharedValue<number>;
	towardStart: boolean;
}) {
	const { colors } = useTheme();
	const tone = fills[action.tone];
	const p = useSharedValue(0);
	useAnimatedReaction(
		() => armed.value,
		(v) => {
			p.set(withTiming(v, enter(motion.d1)));
		},
	);
	const fill = useAnimatedStyle(() => ({ opacity: p.value }));
	// The action sits on the side the row uncovers: the end side when the row moves toward the start.
	const align = towardStart ? "flex-end" : "flex-start";
	const content = (color: ColorToken) => (
		<View style={[styles.content, { justifyContent: align }]}>
			<Icon name={action.icon} size={24} color={color} />
			<Text variant="linkSmall" color={color}>
				{action.label}
			</Text>
		</View>
	);
	return (
		<View style={[StyleSheet.absoluteFill, { backgroundColor: colors.sunken }]} pointerEvents="none">
			{content(tone.idle)}
			<Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors[tone.bg] }, fill]}>
				{content(tone.on)}
			</Animated.View>
		</View>
	);
}

const styles = StyleSheet.create({
	content: { ...StyleSheet.absoluteFill, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 24 },
});
