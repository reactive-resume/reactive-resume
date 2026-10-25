import type { IconName } from "@/ui";
import type { BottomTabBarProps } from "expo-router/tabs";
import type { ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import { useRouter, usePathname } from "expo-router";
import { Children, useEffect, useState } from "react";
import { I18nManager, Platform, Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";
import Animated, {
	useAnimatedStyle,
	useSharedValue,
	withSequence,
	withSpring,
	withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { routes } from "@/routes";
import { Button, Icon, IconButton, Text, haptics, useReducedMotion, useTheme } from "@/ui";

/** The tab routes of `app/(tabs)`, in tab-bar order. `create` is the raised "+" that opens New. */
const appTabIcons: Record<string, IconName> = {
	documents: "file-text",
	applications: "briefcase",
	career: "compass",
	settings: "gear-six",
};

// tokens.md §7: the active-tab marker on the bar's top rule; Android tab cells are 64 tall (app.html).
const railMarker = { width: 28, height: 3 };
// The edge moving toward the new tab arrives first; the other catches up with a little overshoot, so the marker stretches.
const leadingEdge = { duration: 260, dampingRatio: 0.8 };
const trailingEdge = { duration: 420, dampingRatio: 0.62 };
const androidTabHeight = 64;
const badgeMinWidth = 18;

/** Applications shows a quiet count of open applications; every other badge is a filled unread count. */
const quietBadges = new Set(["applications"]);

type TabRoute = BottomTabBarProps["state"]["routes"][number];

function useTabPress({ state, emitter, navigateToTab }: BottomTabBarProps) {
	return (route: TabRoute) => {
		const focused = state.routes[state.index]?.key === route.key;
		const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
		if (!focused && !event.defaultPrevented) navigateToTab(route.key);
	};
}

const tabLabel = ({ descriptors }: BottomTabBarProps, route: TabRoute) => {
	const { title, tabBarLabel } = descriptors[route.key]?.options ?? {};
	return typeof tabBarLabel === "string" ? tabBarLabel : (title ?? route.name);
};

/** A count of 0 shows nothing, like the web sidebar. */
const tabBadge = ({ descriptors }: BottomTabBarProps, route: TabRoute) => {
	const badge = descriptors[route.key]?.options.tabBarBadge;
	return badge === 0 || badge === "0" ? undefined : badge;
};

/** `quiet`: a grey count. `accent`: unread. `warn`: open issues on Check. */
type BadgeTone = "quiet" | "accent" | "warn";

const badgeColors = {
	quiet: { background: "sunken", text: "ink2" },
	accent: { background: "accent", text: "onAccent" },
	warn: { background: "warnSoft", text: "warnText" },
} as const;

type BadgeProps = {
	value: string | number;
	tone: BadgeTone;
};

function TabBadge({ value, tone }: BadgeProps) {
	const { colors, radius, size, space } = useTheme();
	return (
		<View
			style={{
				position: "absolute",
				top: -space.s1,
				// Just past the middle of the icon cell (app.html: left 50% + 6px).
				start: size.icon.bar / 2 + space.s1,
				minWidth: badgeMinWidth,
				paddingHorizontal: space.s1,
				borderRadius: radius.rLg,
				borderWidth: space.s0,
				borderColor: colors.surface,
				backgroundColor: colors[badgeColors[tone].background],
				alignItems: "center",
			}}
		>
			<Text variant="micro" color={badgeColors[tone].text}>
				{value}
			</Text>
		</View>
	);
}

type BarItemProps = {
	label: string;
	/** Omitted for the raised "+" pill. */
	icon?: IconName | undefined;
	focused: boolean;
	onPress: () => void;
	badge?: string | number | undefined;
	badgeTone?: BadgeTone | undefined;
};

/** One cell of a bottom bar: the app tab bar and the editor's Write / Page / Design / Check bar share it. */
export function BarItem({ label, icon, focused, onPress, badge, badgeTone = "accent" }: BarItemProps) {
	const { colors, radius, size, space } = useTheme();
	const android = Platform.OS === "android";

	return (
		<Pressable
			accessibilityRole={icon ? "tab" : "button"}
			accessibilityState={icon ? { selected: focused } : {}}
			accessibilityLabel={badge === undefined ? label : `${label}, ${badge}`}
			onPress={() => {
				if (icon && !focused) haptics.selection();
				onPress();
			}}
			android_ripple={{ color: colors.press, borderless: false }}
			style={({ pressed }) => ({
				flex: 1,
				minHeight: android ? androidTabHeight : size.tabBar,
				alignItems: "center",
				justifyContent: "center",
				gap: space.s0,
				paddingVertical: space.s1,
				paddingHorizontal: space.s0,
				backgroundColor: pressed && !android ? colors.press : "transparent",
			})}
		>
			{icon ? (
				<View style={{ alignItems: "center", justifyContent: "center" }}>
					<Icon name={icon} filled={focused} color={focused ? colors.ink : colors.ink2} size={size.icon.bar} />
					{badge === undefined ? null : <TabBadge value={badge} tone={badgeTone} />}
				</View>
			) : (
				<View
					style={{
						...size.newPill,
						borderRadius: radius.rLg,
						backgroundColor: colors.accent,
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					<Icon name="plus" color={colors.onAccent} size={size.icon.row} />
				</View>
			)}
			<Text variant="micro" color={focused ? "ink" : "ink2"} align="center" style={{ alignSelf: "stretch" }}>
				{label}
			</Text>
		</Pressable>
	);
}

type RailMarkerProps = {
	index: number;
	count: number;
	/** The width of the row of cells. */
	width: number;
};

/** The `accent` marker on the bar's top rule, over the focused cell. Its two edges spring separately, so it stretches. */
function RailMarker({ index, count, width }: RailMarkerProps) {
	const { colors, motion } = useTheme();
	const reduced = useReducedMotion();
	const cell = width / count;
	// Cells are equal `flex: 1`; in RTL the row runs right to left but translateX does not.
	const slot = I18nManager.isRTL ? count - 1 - index : index;
	const target = slot * cell + (cell - railMarker.width) / 2;
	const left = useSharedValue(target);
	const right = useSharedValue(target + railMarker.width);
	const opacity = useSharedValue(1);

	useEffect(() => {
		const end = target + railMarker.width;
		if (reduced) {
			// No stretch or travel: jump, then fade in.
			left.set(target);
			right.set(end);
			opacity.set(withSequence(withTiming(0, { duration: 0 }), withTiming(1, { duration: motion.d1 })));
			return;
		}
		// Springs start from where the marker is now, so a tap mid-flight retargets instead of restarting.
		const forward = target > left.get();
		left.set(withSpring(target, forward ? trailingEdge : leadingEdge));
		right.set(withSpring(end, forward ? leadingEdge : trailingEdge));
	}, [target, reduced, left, right, opacity, motion.d1]);

	const style = useAnimatedStyle(() => ({
		opacity: opacity.get(),
		// Absolute and childless, so animating width costs no sibling layout.
		width: Math.max(right.get() - left.get(), railMarker.height),
		transform: [{ translateX: left.get() }],
	}));

	return (
		<Animated.View
			pointerEvents="none"
			style={[
				{
					position: "absolute",
					// Sits on the bar's 1 pt top rule.
					top: -1,
					left: 0,
					height: railMarker.height,
					backgroundColor: colors.accent,
				},
				style,
			]}
		/>
	);
}

type BarProps = {
	children: ReactNode;
	/** The focused cell, marked on the top rule. Omit for no marker. */
	activeIndex?: number | undefined;
};

/** A bottom bar on `surface` with a top rule, padding the bottom and side safe areas. Hidden while the keyboard is up. */
export function Bar({ children, activeIndex }: BarProps) {
	const insets = useSafeAreaInsets();
	const { colors } = useTheme();
	const keyboardVisible = useKeyboardState((keyboard) => keyboard.isVisible);
	const [width, setWidth] = useState(0);
	const count = Children.count(children);

	if (keyboardVisible) return null;

	return (
		<View
			accessibilityRole="tablist"
			style={{
				flexDirection: "row",
				paddingBottom: insets.bottom,
				paddingLeft: insets.left,
				paddingRight: insets.right,
				backgroundColor: colors.surface,
				borderTopWidth: 1,
				borderTopColor: colors.line,
			}}
		>
			<View style={{ flex: 1, flexDirection: "row" }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
				{children}
				{activeIndex !== undefined && activeIndex >= 0 && width > 0 && count > 0 ? (
					<RailMarker index={activeIndex} count={count} width={width} />
				) : null}
			</View>
		</View>
	);
}

/**
 * The phone tab bar (app.html): five cells, the active tab with a filled icon and the `accent` 28×3 marker on the top
 * rule (both platforms), and the raised "+" pill in the middle. Labels stay under the icons at every text
 * size (`micro` caps its scale); the bar grows taller instead of truncating.
 */
export function PhoneTabBar(props: BottomTabBarProps) {
	const { t } = useLingui();
	const onPress = useTabPress(props);

	return (
		<Bar activeIndex={props.state.index}>
			{props.state.routes.map((route, index) => (
				<BarItem
					key={route.key}
					label={route.name === "create" ? t`New` : tabLabel(props, route)}
					icon={appTabIcons[route.name]}
					focused={index === props.state.index}
					badge={tabBadge(props, route)}
					badgeTone={quietBadges.has(route.name) ? "quiet" : "accent"}
					onPress={() => onPress(route)}
				/>
			))}
		</Bar>
	);
}

type SidebarItemProps = {
	icon: IconName;
	label: string;
	active: boolean;
	onPress: () => void;
	badge?: string | number | undefined;
	quiet?: boolean | undefined;
	compact?: boolean;
	role?: "tab" | "button";
};

function SidebarItem({
	icon,
	label,
	active,
	onPress,
	badge,
	quiet = true,
	compact = false,
	role = "tab",
}: SidebarItemProps) {
	const { colors, radius, size, space } = useTheme();

	return (
		<Pressable
			accessibilityRole={role}
			accessibilityState={{ selected: active }}
			accessibilityLabel={badge === undefined ? label : `${label}, ${badge}`}
			onPress={() => {
				if (!active) haptics.selection();
				onPress();
			}}
			style={({ pressed }) => ({
				flexDirection: compact ? "column" : "row",
				alignItems: "center",
				justifyContent: "center",
				gap: compact ? space.s0 : space.s3,
				minHeight: size.hit,
				paddingHorizontal: compact ? space.s1 : space.s3,
				paddingVertical: compact ? space.s2 : 0,
				borderRadius: radius.rLg,
				backgroundColor: active ? colors.selectedFill : pressed ? colors.press : "transparent",
			})}
		>
			<Icon name={icon} filled={active} size={size.icon.toolbar} color={active ? colors.accentText : colors.ink2} />
			<Text
				variant={compact ? "micro" : active ? "label" : "body"}
				align={compact ? "center" : undefined}
				color={active ? "accentText" : "ink2"}
				style={compact ? undefined : { flex: 1 }}
			>
				{label}
			</Text>
			{badge === undefined ? null : quiet ? (
				<Text variant="callout" color={active ? "ink2" : "ink3"}>
					{badge}
				</Text>
			) : (
				<View
					style={{
						minWidth: badgeMinWidth,
						paddingHorizontal: space.s1,
						borderRadius: radius.rLg,
						backgroundColor: colors.accent,
						alignItems: "center",
					}}
				>
					<Text variant="micro" color="onAccent">
						{badge}
					</Text>
				</View>
			)}
		</Pressable>
	);
}

/**
 * The tablet sidebar (app.html `side`, 240 pt): brand, Search or run…, the four sections, then Trash, New and the
 * account row at the bottom. Section counts come from each tab's `tabBarBadge` option.
 */
export function AppSidebar(props: BottomTabBarProps) {
	const router = useRouter();
	const { t } = useLingui();
	const { state, insets } = props;
	const pathname = usePathname();
	const { colors, radius, size, space, type } = useTheme();
	const { width, fontScale } = useWindowDimensions();
	const compact = width - insets.left - insets.right < 1000;
	const railWidth = (size.hit + space.s8 * 2) * Math.max(1, Math.min(fontScale, type.micro.maxFontSizeMultiplier));
	const leadingInset = I18nManager.isRTL ? insets.right : insets.left;
	const onPress = useTabPress(props);
	const inTrash = pathname.startsWith(routes.trash());

	return (
		<View
			accessibilityRole="tablist"
			style={{
				width: (compact ? railWidth : size.sidebar) + leadingInset,
				paddingTop: insets.top + space.s3,
				paddingBottom: insets.bottom + space.s3,
				paddingStart: leadingInset + space.s3,
				paddingEnd: space.s3,
				gap: space.s0,
				backgroundColor: colors.surface,
				borderEndWidth: 1,
				borderEndColor: colors.line,
			}}
		>
			<Text
				variant="heading"
				accessibilityLabel="Reactive Resume"
				align={compact ? "center" : undefined}
				numberOfLines={1}
				style={{ paddingHorizontal: compact ? 0 : space.s3, paddingBottom: space.s3 }}
			>
				{compact ? "Rx" : "Reactive Resume"}
			</Text>
			{compact ? (
				<View style={{ alignItems: "center" }}>
					<IconButton icon="magnifying-glass" label={t`Search or run…`} onPress={() => router.push(routes.search())} />
				</View>
			) : (
				<Pressable
					accessibilityRole="button"
					accessibilityLabel={t`Search or run…`}
					onPress={() => router.push(routes.search())}
					style={{
						flexDirection: "row",
						alignItems: "center",
						gap: space.s2,
						minHeight: size.hit,
						paddingHorizontal: space.s3,
						marginBottom: space.s2,
						borderRadius: radius.rLg,
						backgroundColor: colors.sunken,
					}}
				>
					<Icon name="magnifying-glass" size={size.icon.meta} color={colors.ink3} />
					<Text variant="callout" color="ink3" numberOfLines={1} style={{ flex: 1 }}>
						{t`Search or run…`}
					</Text>
					<Text variant="caption" color="ink3">
						⌘K
					</Text>
				</Pressable>
			)}
			<ScrollView contentContainerStyle={{ flexGrow: 1, gap: space.s0 }} showsVerticalScrollIndicator={false}>
				{state.routes.map((route, index) => {
					const icon = appTabIcons[route.name];
					if (!icon) return null;
					const badge = tabBadge(props, route);
					return (
						<SidebarItem
							key={route.key}
							icon={icon}
							label={tabLabel(props, route)}
							active={index === state.index && !inTrash}
							badge={badge}
							quiet={quietBadges.has(route.name)}
							compact={compact}
							onPress={() =>
								inTrash && route.name === "documents" ? router.navigate(routes.documents()) : onPress(route)
							}
						/>
					);
				})}
				<View style={{ flex: 1 }} />
				<SidebarItem
					icon="trash"
					label={t`Trash`}
					active={inTrash}
					compact={compact}
					onPress={() => router.navigate(routes.trash())}
				/>
				<View style={{ paddingVertical: space.s2 }}>
					{compact ? (
						<SidebarItem
							icon="plus"
							label={t`New`}
							active={false}
							compact
							role="button"
							onPress={() => router.push(routes.new())}
						/>
					) : (
						<Button icon="plus" label={t`New`} fullWidth onPress={() => router.push(routes.new())} />
					)}
				</View>
				{compact ? (
					<SidebarItem
						icon="user-circle"
						label={t`Account`}
						active={false}
						compact
						role="button"
						onPress={() => router.navigate(routes.settings("account"))}
					/>
				) : (
					<Pressable
						accessibilityRole="button"
						accessibilityLabel={t`Account`}
						onPress={() => router.navigate(routes.settings("account"))}
						style={{
							flexDirection: "row",
							alignItems: "center",
							gap: space.s3,
							minHeight: size.row,
							paddingHorizontal: space.s3,
							paddingTop: space.s2,
							borderTopWidth: 1,
							borderTopColor: colors.line,
						}}
					>
						<Icon name="user-circle" size={size.icon.bar} color={colors.ink2} />
						<Text variant="body" color="ink2">
							{t`Account`}
						</Text>
					</Pressable>
				)}
			</ScrollView>
		</View>
	);
}
