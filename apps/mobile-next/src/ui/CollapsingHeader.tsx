// Title collapse (MOTION.md §6.7, COMPONENTS.md §2–3): the 28/34 or 34/40 title scrolls away with the content; once
// the scroll passes 40 dp a 56 dp bar fades in with its 15/20 600 title and a 1 dp `line` divider, d2 `ease`, and
// fades out when scrolled back. Triggered by crossing the threshold, not scrubbed.
//   const collapse = useTitleCollapse();
//   <Animated.ScrollView onScroll={collapse.onScroll} scrollEventThrottle={16}>…</Animated.ScrollView>
//   <CollapsedBar collapse={collapse} title="Today" end={actions} />
import { type ReactNode, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
	runOnJS,
	type SharedValue,
	useAnimatedReaction,
	useAnimatedScrollHandler,
	useAnimatedStyle,
	useSharedValue,
	withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { enter } from "./motion";
import { Text } from "./Text";
import { useTheme } from "./theme";
import { layout, motion } from "./tokens";
import { useDesignTag } from "@/dev/storyboard/harness";

export type TitleCollapse = {
	onScroll: ReturnType<typeof useAnimatedScrollHandler>;
	/** Live scroll offset (other effects can read it). */
	scrollY: SharedValue<number>;
	/** 0 → 1 as the bar fades in. */
	shown: SharedValue<number>;
	/** True once past the threshold (React state, for design tags and accessibility). */
	collapsed: boolean;
};

export function useTitleCollapse(threshold: number = layout.rootTitleCollapseAfter): TitleCollapse {
	const scrollY = useSharedValue(0);
	const shown = useSharedValue(0);
	const [collapsed, setCollapsed] = useState(false);
	const onScroll = useAnimatedScrollHandler((e) => {
		scrollY.set(e.contentOffset.y);
	});
	useAnimatedReaction(
		() => scrollY.value > threshold,
		(past, before) => {
			if (past === before) return;
			shown.set(withTiming(past ? 1 : 0, enter(motion.d2)));
			runOnJS(setCollapsed)(past);
		},
	);
	return { onScroll, scrollY, shown, collapsed };
}

/** The 56 dp bar under the status bar. `start` and `end` are the bar's slots (back button, actions). */
export function CollapsedBar({
	collapse,
	title,
	start,
	end,
	labMarker,
}: {
	collapse: TitleCollapse;
	title: string;
	start?: ReactNode;
	end?: ReactNode;
	/** Motion lab only: a literal colour for the whole bar. */
	labMarker?: string;
}) {
	const { colors } = useTheme();
	const insets = useSafeAreaInsets();
	const ref = useDesignTag({ kind: "component", component: "CollapsedBar", bg: "bg" }, { hidden: !collapse.collapsed });
	const { shown } = collapse;
	const style = useAnimatedStyle(() => ({ opacity: shown.value }));
	return (
		<Animated.View
			ref={ref as never}
			pointerEvents={collapse.collapsed ? "box-none" : "none"}
			accessibilityElementsHidden={!collapse.collapsed}
			style={[
				styles.bar,
				{ top: insets.top, backgroundColor: labMarker ?? colors.bg, borderBottomColor: colors.line },
				style,
			]}
		>
			<View style={styles.slot}>{start}</View>
			<View style={styles.title}>
				<Text variant="topBarTitle" numberOfLines={1} align="center" tag={collapse.collapsed}>
					{title}
				</Text>
			</View>
			<View style={[styles.slot, styles.end]}>{end}</View>
		</Animated.View>
	);
}

const styles = StyleSheet.create({
	bar: {
		position: "absolute",
		left: 0,
		right: 0,
		height: layout.topBar,
		flexDirection: "row",
		alignItems: "center",
		paddingHorizontal: 12,
		gap: 4,
		borderBottomWidth: 1,
	},
	slot: { minWidth: 44, flexDirection: "row", alignItems: "center" },
	end: { justifyContent: "flex-end" },
	title: { flex: 1 },
});
