import type { BottomTabBarProps } from "expo-router/js-tabs";
import { useIsFocused } from "expo-router";
// Dock (COMPONENTS.md §15, MOTION.md §5, §6.3): root tabs, builder modes, letter modes. 1 dp `line` on top, `bg`,
// 64 dp plus the bottom safe area, 8 dp sides, items share the width. The selection changes at once on tap (fill
// icon swap, ink-2 → accent-text crossfade d1); content switches by fade-through (FadeThroughProvider). Builder and
// letter docks play `selection`; root tabs play none. Re-tapping the selected item scrolls its list to the top.
// Large text (≥ 150%): 80 dp, 30 dp icons, 18 sp labels; past 150% the short labels, full names read out.
import { type ReactNode, type Ref, useEffect, useImperativeHandle, useState } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, { type SharedValue, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Touch } from "./base";
import { Icon, type IconName } from "./Icon";
import { enter, FadeThroughScene, haptic, useFadeThrough } from "./motion";
import { Text } from "./Text";
import { useTheme } from "./theme";
import { useToastOffset } from "./Toast";
import { layout, motion, radius } from "./tokens";
import { useDesignTag } from "@/dev/storyboard/harness";

export type DockVariant = "tabs" | "builder" | "letter";

export type DockItemSpec = {
	key: string;
	label: string;
	/** Past 150% text: "Docs", "Jobs". */
	shortLabel?: string;
	icon: IconName;
	/** Count badge (warn). */
	count?: number;
	/** Warn dot (Check). */
	warn?: boolean;
};

export type DockProps = {
	variant: DockVariant;
	items: readonly DockItemSpec[];
	selected: string;
	/** Runs after the old content has faded out. */
	onNavigate: (key: string) => void;
	/** The selected item tapped again (scroll its list to the top). */
	onReselect?: (key: string) => void;
	/** Return false to cancel the switch (a tabPress listener prevented it). */
	onWillSwitch?: (key: string) => boolean;
	/** `select(key)` does what tapping the item does (motion lab, tests). */
	ref?: Ref<{ select: (key: string) => void }>;
};

export function Dock({ variant, items, selected, onNavigate, onReselect, onWillSwitch, ref: handle }: DockProps) {
	const { colors } = useTheme();
	const insets = useSafeAreaInsets();
	const { fontScale } = useWindowDimensions();
	const { switchTo } = useFadeThrough();
	const large = fontScale >= 1.5;
	const short = fontScale > 1.5;
	const height = large ? layout.dockLargeText : layout.dock;
	const ref = useDesignTag({ kind: "component", component: "Dock", bg: "bg" });
	// The dock shows the tapped item at once, before the content has switched.
	const [shown, setShown] = useState(selected);
	const [lastSelected, setLastSelected] = useState(selected);
	if (selected !== lastSelected) {
		setLastSelected(selected);
		setShown(selected);
	}
	useToastOffset(height + 1 + insets.bottom);

	const press = (key: string) => {
		if (key === shown) {
			onReselect?.(key);
			return;
		}
		if (onWillSwitch && !onWillSwitch(key)) return;
		setShown(key);
		if (variant !== "tabs") haptic("selection");
		switchTo(() => onNavigate(key));
	};
	useImperativeHandle(handle, () => ({ select: press }));

	return (
		<View
			ref={ref}
			collapsable={false}
			accessibilityRole="tablist"
			style={[styles.dock, { backgroundColor: colors.bg, borderTopColor: colors.line, paddingBottom: insets.bottom }]}
		>
			{items.map((item) => (
				<DockItem
					key={item.key}
					item={item}
					selected={item.key === shown}
					height={height}
					large={large}
					short={short}
					onPress={() => press(item.key)}
				/>
			))}
		</View>
	);
}

function DockItem({
	item,
	selected,
	height,
	large,
	short,
	onPress,
}: {
	item: DockItemSpec;
	selected: boolean;
	height: number;
	large: boolean;
	short: boolean;
	onPress: () => void;
}) {
	const { colors } = useTheme();
	const ref = useDesignTag({ kind: "component", component: "DockItem" });
	const s = useSharedValue(selected ? 1 : 0);
	useEffect(() => {
		s.set(withTiming(selected ? 1 : 0, enter(motion.d1)));
	}, [selected, s]);
	const iconSize = large ? 30 : 24;
	const label = short && item.shortLabel ? item.shortLabel : item.label;
	const labelStyle = large ? { fontSize: 18, lineHeight: 24 } : undefined;
	return (
		<Touch
			feedback="none"
			onPress={onPress}
			accessibilityRole="tab"
			accessibilityLabel={item.count ? `${item.label}, ${item.count}` : item.label}
			accessibilityState={{ selected }}
			style={[styles.item, { height }]}
		>
			<View ref={ref} collapsable={false} style={StyleSheet.absoluteFill} pointerEvents="none" />
			<View style={{ width: iconSize, height: iconSize }}>
				{/* Regular → fill swaps at once; the colour crossfades d1. */}
				<Fade s={s} on={false} absolute>
					<Icon name={item.icon} size={iconSize} color={selected ? "accentText" : "ink2"} />
				</Fade>
				<Fade s={s} on absolute>
					<Icon name={item.icon} size={iconSize} color="accentText" fill />
				</Fade>
			</View>
			<View>
				<Fade s={s} on={false}>
					<Text
						variant="dockLabel"
						color="ink2"
						maxFontSizeMultiplier={1}
						style={labelStyle}
						numberOfLines={1}
						tag={!selected}
					>
						{label}
					</Text>
				</Fade>
				<Fade s={s} on absolute>
					<Text
						variant="dockLabel"
						color="accentText"
						maxFontSizeMultiplier={1}
						style={labelStyle}
						numberOfLines={1}
						tag={selected}
					>
						{label}
					</Text>
				</Fade>
			</View>
			{item.count ? (
				<View style={[styles.count, { backgroundColor: colors.warn }]} pointerEvents="none">
					<Text variant="mono" color="warnInk" weight={600} style={styles.countText} maxFontSizeMultiplier={1}>
						{String(item.count)}
					</Text>
				</View>
			) : null}
			{item.warn ? <View style={[styles.warn, { backgroundColor: colors.warnMark }]} pointerEvents="none" /> : null}
		</Touch>
	);
}

/** One of an item's two looks; `on` is the selected one. */
function Fade({
	s,
	on,
	absolute = false,
	children,
}: {
	s: SharedValue<number>;
	on: boolean;
	absolute?: boolean;
	children: ReactNode;
}) {
	const style = useAnimatedStyle(() => ({ opacity: on ? s.value : 1 - s.value }));
	return <Animated.View style={[absolute ? StyleSheet.absoluteFill : null, style]}>{children}</Animated.View>;
}

/**
 * The `tabBar` for `Tabs` from expo-router/js-tabs: <Tabs tabBar={(p) => <DockTabBar {...p} variant="tabs" items={…} />}>.
 * Item keys are route names. Wrap the Tabs in <FadeThroughProvider> and each screen in <DockScene>.
 */
export function DockTabBar({
	state,
	emitter,
	navigateToTab,
	variant,
	items,
}: BottomTabBarProps & { variant: DockVariant; items: readonly DockItemSpec[] }) {
	const routeOf = (key: string) => state.routes.find((r) => r.name === key);
	const emitPress = (key: string) => {
		const route = routeOf(key);
		if (!route) return false;
		const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
		return !event.defaultPrevented;
	};
	return (
		<Dock
			variant={variant}
			items={items}
			selected={state.routes[state.index]?.name ?? ""}
			onWillSwitch={emitPress}
			onReselect={(key) => emitPress(key)} // the focused screen's useScrollToTop scrolls to the top
			onNavigate={(key) => {
				const route = routeOf(key);
				if (route) navigateToTab(route.key);
			}}
		/>
	);
}

/** A dock screen's root: fades out and up through the provider. */
export function DockScene({ children }: { children: ReactNode }) {
	const focused = useIsFocused();
	return <FadeThroughScene focused={focused}>{children}</FadeThroughScene>;
}

const styles = StyleSheet.create({
	dock: { flexDirection: "row", borderTopWidth: 1, paddingHorizontal: 8 },
	item: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4 },
	count: {
		position: "absolute",
		top: 8,
		start: "50%",
		marginStart: 6,
		height: 16,
		minWidth: 16,
		paddingHorizontal: 4,
		borderRadius: radius.full,
		alignItems: "center",
		justifyContent: "center",
	},
	countText: { fontSize: 11, lineHeight: 16 },
	warn: {
		position: "absolute",
		top: 10,
		start: "50%",
		marginStart: 10,
		width: 7,
		height: 7,
		borderRadius: radius.full,
	},
});
