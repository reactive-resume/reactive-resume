import type { ColorToken } from "./tokens";
// Shared building blocks: the themed Touchable, rings, the screen root and the design-tagged box.
import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { useRoute } from "expo-router";
import { StyleSheet, View } from "react-native";
import { Touchable, type TouchableProps } from "./motion";
import { useTheme, useThemeName } from "./theme";
import { DesignScreen, useDesignTag } from "@/dev/storyboard/harness";

/** `Touchable` with the theme filled in. Every tap in the app goes through this or a design-system control. */
export function Touch(props: Omit<TouchableProps, "theme">) {
	const theme = useThemeName();
	return <Touchable theme={theme} {...props} />;
}

/**
 * An inner ring drawn inside the shape without moving its content (COMPONENTS.md intro): an overlay with the same
 * radius, never a border on the box itself.
 */
export function Ring({
	color,
	width = 1,
	radius = 0,
	dashed = false,
}: {
	color: ColorToken;
	width?: number;
	radius?: number;
	dashed?: boolean;
}) {
	const { colors } = useTheme();
	return (
		<View
			pointerEvents="none"
			style={[
				StyleSheet.absoluteFill,
				{
					borderWidth: width,
					borderColor: colors[color],
					borderRadius: radius,
					borderStyle: dashed ? "dashed" : "solid",
				},
			]}
		/>
	);
}

/** A view that registers itself in the layout dump under a design-system component name. */
export function Box({
	component,
	radius,
	bg,
	hidden = false,
	style,
	children,
	...rest
}: {
	component: string;
	radius?: number;
	bg?: ColorToken;
	/**
	 * Left out of the layout dump, as the boards leave it out: it draws nothing of its own (a borderless last row), or
	 * the boards draw it without a component name (A3's code boxes are plain spans).
	 */
	hidden?: boolean;
	style?: StyleProp<ViewStyle>;
	children?: ReactNode;
	pointerEvents?: "none" | "auto" | "box-none" | "box-only";
	testID?: string;
}) {
	const { colors } = useTheme();
	const ref = useDesignTag(
		{
			kind: "component",
			component,
			...(radius != null ? { radius } : {}),
			...(bg ? { bg } : {}),
		},
		{ hidden },
	);
	return (
		<View
			ref={ref}
			collapsable={false}
			{...rest}
			style={[bg ? { backgroundColor: colors[bg] } : null, radius != null ? { borderRadius: radius } : null, style]}
		>
			{children}
		</View>
	);
}

/**
 * The root of every screen. It fills the frame with the background token and registers the route with the
 * storyboard harness; headers, docks and footers read the safe-area insets themselves.
 */
export function Screen({
	bg = "bg",
	presentation = "screen",
	style,
	children,
}: {
	bg?: ColorToken | "transparent";
	/** "sheet": the screen underneath stays visible (bottom sheets and dialogs presented as routes). */
	presentation?: "screen" | "sheet" | "modal";
	style?: StyleProp<ViewStyle>;
	children?: ReactNode;
}) {
	const { colors } = useTheme();
	const route = useRoute();
	return (
		<DesignScreen routeKey={route.key} presentation={presentation}>
			<View style={[{ flex: 1, backgroundColor: bg === "transparent" ? "transparent" : colors[bg] }, style]}>
				{children}
			</View>
		</DesignScreen>
	);
}
