import type { ColorToken, type as typeScale } from "./tokens";
import type { ReactNode } from "react";
import type { TextProps as NativeTextProps, StyleProp, ViewProps, ViewStyle } from "react-native";
import { RefreshControl, ScrollView, Text as NativeText, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "./theme";
import { usePullRefresh } from "./use-pull-refresh";

export type TextVariant = keyof typeof typeScale;

/** Layout styles (`flex`, padding) may go in `style`; typography and colour come from the tokens. */
export type TextProps = NativeTextProps & {
	/** A type token from tokens.md §2. Defaults to `body`. */
	variant?: TextVariant | undefined;
	/** A colour token. Defaults to `ink`. */
	color?: ColorToken | undefined;
	/**
	 * Figtree weight for UI variants, where tokens.md names one (field labels 600, document names 600).
	 * Ignored for the Instrument Serif (single weight) and mono variants.
	 */
	weight?: 400 | 500 | 600 | 700 | undefined;
	align?: "auto" | "left" | "center" | "right" | undefined;
	children?: ReactNode;
};

const displayVariants = new Set<TextVariant>(["largeIOS", "largeAnd", "display", "heading", "mono"]);

export function Text({ variant = "body", color = "ink", weight, align, style, ...props }: TextProps) {
	const { colors, fonts, type } = useTheme();
	const { maxFontSizeMultiplier, ...font } = type[variant] as (typeof type)[TextVariant] & {
		maxFontSizeMultiplier?: number;
	};
	const fontFamily = weight && !displayVariants.has(variant) ? fonts.ui[weight] : font.fontFamily;

	return (
		<NativeText
			maxFontSizeMultiplier={maxFontSizeMultiplier}
			{...props}
			style={[font, { fontFamily, color: colors[color] }, align ? { textAlign: align } : null, style]}
		/>
	);
}

export type ScreenProps = {
	children?: ReactNode;
	/** Scrolls its content. Defaults to true; lists that scroll themselves pass false. */
	scroll?: boolean | undefined;
	/** Additional edges to pad. Horizontal safe areas are always protected; headers and tab bars handle vertical ones. */
	edges?: ("top" | "bottom" | "left" | "right")[] | undefined;
	contentStyle?: StyleProp<ViewStyle>;
	/** Measures the viewport after safe areas, before content padding. */
	onLayout?: ViewProps["onLayout"];
	onRefresh?: (() => Promise<unknown>) | undefined;
};

/** A screen on the `bg` desk with phone side padding (`s4`). */
export function Screen({ children, scroll = true, edges = [], contentStyle, onLayout, onRefresh }: ScreenProps) {
	const { colors, space } = useTheme();
	const insets = useSafeAreaInsets();
	const pull = usePullRefresh(...(onRefresh ? [onRefresh] : []));
	const padding = [{ padding: space.s4, gap: space.s4 }, contentStyle];

	return (
		<View
			style={{
				flex: 1,
				backgroundColor: colors.bg,
				paddingLeft: insets.left,
				paddingRight: insets.right,
				paddingTop: edges.includes("top") ? insets.top : 0,
				paddingBottom: edges.includes("bottom") ? insets.bottom : 0,
			}}
		>
			{scroll ? (
				<ScrollView
					onLayout={onLayout}
					contentInsetAdjustmentBehavior="automatic"
					contentContainerStyle={padding}
					alwaysBounceVertical
					refreshControl={
						onRefresh ? <RefreshControl {...pull} tintColor={colors.accent} colors={[colors.accent]} /> : undefined
					}
				>
					{children}
				</ScrollView>
			) : (
				<View onLayout={onLayout} style={[{ flex: 1 }, padding]}>
					{children}
				</View>
			)}
		</View>
	);
}
