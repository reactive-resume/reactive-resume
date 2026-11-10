import type { ReactNode } from "react";
import type { TextProps as RNTextProps, TextStyle } from "react-native";
import { Platform, Text as RNText, StyleSheet } from "react-native";
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
		ios: { rootTitle: 1 },
		default: {},
	}) ?? {};

/**
 * iOS rounds a text's measured height up to the next device pixel, and an exact line height measures a hair over, so
 * every text laid out 1/3 dp taller than lines × line height and rows drifted down the screen. A line height a
 * hundredth under the token keeps the box at exactly lines × line height; the glyphs don't move.
 */
const iosLineBox = (lineHeight: number) => (Platform.OS === "ios" ? { lineHeight: lineHeight - 0.01 } : null);

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
	const own = StyleSheet.flatten(style) ?? {};
	const fontFamily =
		own.fontFamily ??
		(weight && base.fontFamily !== fonts.display && base.fontFamily !== fonts.mono
			? uiFamily[weight]
			: base.fontFamily);
	const fontSize = own.fontSize ?? base.fontSize;
	const lineHeight = own.lineHeight ?? base.lineHeight;
	const ref = useDesignTag(
		{
			kind: "text",
			text: flatten(children),
			style: { fontFamily, fontSize, lineHeight },
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
				base,
				{ fontFamily, color: colors[color] },
				align ? { textAlign: align } : null,
				shift ? { transform: [{ translateY: shift }] } : null,
				style,
				iosLineBox(lineHeight),
			]}
		>
			{children}
		</RNText>
	);
}
