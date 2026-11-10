// Pull to refresh (MOTION.md §6.7): Today, Documents, Applications, Career. The same custom indicator on both
// platforms: a 14 dp spinner with "Refreshing" under the header that turns with the pull, arms at 64 dp (`soft`),
// and holds the content 44 dp down while refreshing; when done the content returns in d2 `ease`. A Gesture Handler
// pan runs only while the list is at its top, simultaneously with the list's own scroll. Screen readers get a
// Refresh action. Pulling is a shortcut: lists also refresh on their own.
// Lists: pass `renderList` and spread the props it receives onto your own Animated.FlatList (or another animated
// list) instead of passing children; the pull then moves the whole list. Never nest a list in the ScrollView.
// ponytail: iOS top bounce is off inside this view (the pan owns the pull); bottom overscroll stays native on Android.
// The title collapse is unaffected: it reads offsets past 40 dp, and bounce only ever produced negative ones.
import { t } from "@lingui/core/macro";
import { type ReactElement, type ReactNode, type Ref, useEffect } from "react";
import { type AccessibilityActionEvent, Platform, type ScrollViewProps, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
	runOnJS,
	type SharedValue,
	useAnimatedScrollHandler,
	useAnimatedStyle,
	useDerivedValue,
	useSharedValue,
	withTiming,
} from "react-native-reanimated";
import { enter, hapticOnUI, release } from "./motion";
import { Spinner } from "./Spinner";
import { Text } from "./Text";
import { motion } from "./tokens";

const ARM = 64;
const HOLD = 44;
const RESIST = 0.5; // the pull moves half as far as the finger

/** What a list rendered through `renderList` must receive (spread them onto it). */
export type PullListProps = {
	onScroll: ReturnType<typeof useAnimatedScrollHandler>;
	scrollEventThrottle: number;
	bounces: boolean | undefined;
	style: ReturnType<typeof useAnimatedStyle>;
	accessibilityActions: { name: string; label: string }[];
	onAccessibilityAction: (e: AccessibilityActionEvent) => void;
};

export type PullToRefreshProps = Omit<ScrollViewProps, "onScroll" | "refreshControl" | "children"> & {
	refreshing: boolean;
	onRefresh: () => void;
	children?: ReactNode;
	/** A list instead of children: spread the given props onto your Animated.FlatList. */
	renderList?: (props: PullListProps) => ReactElement;
	/** Also feed this scroll offset (the title collapse reads it). */
	scrollOffset?: SharedValue<number> | undefined;
	scrollRef?: Ref<Animated.ScrollView> | undefined;
};

export function PullToRefresh({
	refreshing,
	onRefresh,
	children,
	scrollOffset,
	scrollRef,
	renderList,
	...scrollProps
}: PullToRefreshProps) {
	const scrollY = useSharedValue(0);
	const pull = useSharedValue(0);
	const armed = useSharedValue(false);
	const busy = useSharedValue(refreshing);
	const startAt = useSharedValue(0);

	useEffect(() => {
		busy.set(refreshing);
		if (refreshing) pull.set(withTiming(HOLD, enter(motion.d2)));
		else if (pull.value > 0) pull.set(withTiming(0, enter(motion.d2)));
	}, [refreshing, busy, pull]);

	const onScroll = useAnimatedScrollHandler((e) => {
		scrollY.set(e.contentOffset.y);
		if (scrollOffset) scrollOffset.set(e.contentOffset.y);
	});

	const native = Gesture.Native();
	const pan = Gesture.Pan()
		.simultaneousWithExternalGesture(native)
		.activeOffsetY(4)
		.failOffsetY(-4)
		.onStart((e) => {
			startAt.set(e.translationY);
		})
		.onUpdate((e) => {
			if (busy.value) return;
			if (scrollY.value > 0) {
				startAt.set(e.translationY);
				return;
			}
			const p = Math.max(0, (e.translationY - startAt.value) * RESIST);
			pull.set(p);
			if (p >= ARM && !armed.value) {
				armed.set(true);
				hapticOnUI("soft");
			} else if (p < ARM && armed.value) {
				armed.set(false);
			}
		})
		.onEnd(() => {
			if (busy.value) return;
			if (armed.value) {
				armed.set(false);
				busy.set(true);
				pull.set(withTiming(HOLD, release(pull.value - HOLD, ARM)));
				runOnJS(onRefresh)();
			} else if (pull.value > 0) {
				pull.set(withTiming(0, release(pull.value, ARM)));
			}
		});

	const turns = useDerivedValue(() => pull.value / ARM);
	const content = useAnimatedStyle(() => ({ transform: [{ translateY: pull.value }] }));
	const indicator = useAnimatedStyle(() => ({ opacity: Math.min(1, pull.value / HOLD) }));

	const shared = {
		onScroll,
		scrollEventThrottle: 16,
		bounces: Platform.OS === "ios" ? false : scrollProps.bounces,
		accessibilityActions: [{ name: "refresh", label: t`Refresh` }],
		onAccessibilityAction: (e: AccessibilityActionEvent) => {
			if (e.nativeEvent.actionName === "refresh") onRefresh();
		},
	};

	return (
		<View style={styles.root}>
			<Animated.View
				style={[styles.indicator, indicator]}
				pointerEvents="none"
				accessibilityElementsHidden={!refreshing}
			>
				{refreshing ? <Spinner /> : <Spinner turns={turns} />}
				<Text variant="ui" color="ink3" tag={refreshing}>
					{t`Refreshing`}
				</Text>
			</Animated.View>
			<GestureDetector gesture={pan}>
				<GestureDetector gesture={native}>
					{renderList ? (
						renderList({ ...shared, style: content })
					) : (
						<Animated.ScrollView {...scrollProps} {...shared} ref={scrollRef}>
							<Animated.View style={content}>{children}</Animated.View>
						</Animated.ScrollView>
					)}
				</GestureDetector>
			</GestureDetector>
		</View>
	);
}

const styles = StyleSheet.create({
	root: { flex: 1 },
	indicator: {
		position: "absolute",
		top: 0,
		left: 0,
		right: 0,
		height: HOLD,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		gap: 8,
	},
});
