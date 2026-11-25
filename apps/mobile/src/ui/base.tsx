import type { ColorToken } from "./tokens";
// Shared building blocks: the themed Touchable, rings, the screen root and the token box.
import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { StyleSheet, View } from "react-native";
import { Touchable, type TouchableProps } from "./motion";
import { useTheme, useThemeName } from "./theme";

/** `Touchable` with the theme filled in. Every tap in the app goes through this or a design-system control. */
export function Touch(props: Omit<TouchableProps, "theme">) {
	const theme = useThemeName();
	return <Touchable theme={theme} {...props} />;
}

/**
 * An inner ring drawn inside the shape without moving its content: an overlay with the same
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

/** A view with a background and corner radius from the tokens. */
export function Box({
	radius,
	bg,
	style,
	children,
	...rest
}: {
	radius?: number;
	bg?: ColorToken;
	style?: StyleProp<ViewStyle>;
	children?: ReactNode;
	pointerEvents?: "none" | "auto" | "box-none" | "box-only";
	testID?: string;
}) {
	const { colors } = useTheme();
	return (
		<View
			{...rest}
			style={[bg ? { backgroundColor: colors[bg] } : null, radius != null ? { borderRadius: radius } : null, style]}
		>
			{children}
		</View>
	);
}

/**
 * The root of every screen. It fills the frame with the background token; headers, docks and footers read the
 * safe-area insets themselves.
 */
export function Screen({
	bg = "bg",
	style,
	children,
}: {
	bg?: ColorToken | "transparent";
	style?: StyleProp<ViewStyle>;
	children?: ReactNode;
}) {
	const { colors } = useTheme();
	return (
		<View style={[{ flex: 1, backgroundColor: bg === "transparent" ? "transparent" : colors[bg] }, style]}>
			{children}
		</View>
	);
}
