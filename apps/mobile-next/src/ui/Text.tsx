import type { ReactNode } from "react";
import type { TextProps as RNTextProps, TextStyle } from "react-native";
import { PixelRatio, Platform, StyleSheet, Text as RNText } from "react-native";
import { useTheme } from "./theme";
import { type ColorToken, fonts, textDefaults, type as typeScale, type TypeToken } from "./tokens";
import { useDesignTag } from "@/dev/storyboard/harness";

const uiFamily = { 400: fonts.ui400, 500: fonts.ui500, 600: fonts.ui600, 700: fonts.ui700 } as const;

/** Serif titles stop growing at 150% of the system text size; everything else follows it to 200% (Reach board). */
const maxScale = (family: string) => (family === fonts.display ? 1.5 : 2);

/**
 * Measured glyph offsets inside the line box, in dp per platform and text style, so glyphs sit where the storyboard's
 * CSS line boxes put them (BUILD.md §6.1.3). Applied as a vertical translate that leaves the layout box untouched.
 * Measured with scripts/text-metrics.py against the storyboard PNGs; the numbers are logged in FIDELITY-LOG.md.
 */
const glyphShift: Partial<Record<TypeToken, number>> =
	Platform.select<Partial<Record<TypeToken, number>>>({
		ios: { rootTitle: 0.5 },
		android: { rootTitle: -1, pageTitle: -1, sheetTitle: -1, keyLine: -1, ui: -0.5 },
		default: {},
	}) ?? {};

/**
 * iOS lays every Text out one device pixel taller than lines × line height (24.33 for a 24 pt line at 3x; measured,
 * FIDELITY-LOG.md). The extra pixel is taken back so stacked text never drifts from the storyboard's line boxes.
 */
const lineBoxFix = Platform.OS === "ios" ? { marginBottom: -1 / PixelRatio.get() } : null;

const flatten = (children: ReactNode): string => {
	if (children == null || typeof children === "boolean") return "";
	if (typeof children === "string" || typeof children === "number") return String(children);
	if (Array.isArray(children)) return children.map(flatten).join("");
	if (typeof children === "object" && "props" in children)
		return flatten((children.props as { children?: ReactNode }).children);
	return "";
};

export type TextProps = Omit<RNTextProps, "style"> & {
	variant?: TypeToken;
	color?: ColorToken;
	/** Figtree weight override (400, 500, 600, 700). Never for the serif or mono faces. */
	weight?: 400 | 500 | 600 | 700;
	align?: TextStyle["textAlign"];
	style?: RNTextProps["style"];
	/** False for text nested inside another Text (the outer one carries the tag). */
	tag?: boolean;
};

export function Text({
	variant = "ui",
	color = "ink",
	weight,
	align,
	style,
	tag = true,
	children,
	...rest
}: TextProps) {
	const { colors } = useTheme();
	const base = typeScale[variant];
	const fontFamily =
		weight && base.fontFamily !== fonts.display && base.fontFamily !== fonts.mono ? uiFamily[weight] : base.fontFamily;
	// The tag reports the style actually drawn, overrides included.
	const override = style ? StyleSheet.flatten(style) : undefined;
	const ref = useDesignTag(
		{
			kind: "text",
			text: flatten(children),
			style: {
				fontFamily: override?.fontFamily ?? fontFamily,
				fontSize: override?.fontSize ?? base.fontSize,
				lineHeight: override?.lineHeight ?? base.lineHeight,
				fontWeight: override?.fontWeight,
			},
			color,
		},
		{ hidden: !tag },
	);
	const shift = glyphShift[variant];
	return (
		<RNText
			ref={ref}
			maxFontSizeMultiplier={maxScale(fontFamily)}
			{...rest}
			style={[
				textDefaults,
				lineBoxFix,
				base,
				{ fontFamily, color: colors[color] },
				align ? { textAlign: align } : null,
				shift ? { transform: [{ translateY: shift }] } : null,
				style,
			]}
		>
			{children}
		</RNText>
	);
}
