import type { HostInstance, TextProps as RNTextProps, TextStyle } from "react-native";
import { type ReactNode, useRef } from "react";
import { Platform, StyleSheet, Text as RNText, View } from "react-native";
import { useTheme } from "./theme";
import { type ColorToken, fonts, textDefaults, type as typeScale, type TypeToken } from "./tokens";
import { runsBox, untranslatedBox, useDesignTag } from "@/dev/storyboard/harness";

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
		ios: {},
		android: { rootTitle: -1, pageTitle: -1, sheetTitle: -1, keyLine: -1, ui: -0.5 },
		default: {},
	}) ?? {};

/**
 * iOS rounds a text's measured height up to the next device pixel, and an exact line height measures a hair over, so
 * every Text laid out one device pixel taller than lines × line height (24.33 at 3x) and stacked rows drifted. A line
 * height a hundredth under the token measures exactly lines × line height (onLayout, every style, one and two lines;
 * FIDELITY-LOG.md); the glyphs don't move.
 */
const iosLineBox = (lineHeight: number) => (Platform.OS === "ios" ? { lineHeight: lineHeight - 0.01 } : null);

/**
 * iOS rootTitle: Instrument Serif's ink sits higher in the line box than in the storyboard's CSS. The box is measured
 * with any transform, so a translate moves box and ink together; this moves the ink only (padding inside the box, the
 * same amount taken back below so the layout flow is unchanged). FIDELITY-LOG.md has the measurements.
 */
const inkOffset: Partial<Record<TypeToken, number>> = Platform.OS === "ios" ? { rootTitle: 2 / 3 } : {};

/**
 * A Text taller than its lines (stretched by a row, like C2's list markers) keeps its lines at the top, as CSS does.
 * `textDefaults` centres for text inputs; `textAlignVertical` only exists on Android.
 */
const topAligned = { textAlignVertical: "top" } as const;

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
	// The tag reports the style actually drawn, overrides included.
	const own = StyleSheet.flatten(style) ?? {};
	const fontFamily =
		own.fontFamily ??
		(weight && base.fontFamily !== fonts.display && base.fontFamily !== fonts.mono
			? uiFamily[weight]
			: base.fontFamily);
	const shift = glyphShift[variant];
	const ref = useDesignTag(
		{
			kind: "text",
			text: flatten(children),
			style: {
				fontFamily,
				fontSize: own.fontSize ?? base.fontSize,
				lineHeight: own.lineHeight ?? base.lineHeight,
				fontWeight: own.fontWeight,
			},
			color,
		},
		// The glyph shift moves ink only; the line box stays where layout put it (Android only: iOS has no shifts).
		{ hidden: !tag, box: shift ? () => untranslatedBox(ref, shift)() : undefined },
	);
	const ink = inkOffset[variant];
	return (
		<RNText
			ref={ref}
			maxFontSizeMultiplier={maxScale(fontFamily)}
			// Android balances paragraph lines by default ("highQuality"); CSS breaks greedily, as "simple" does (L1's
			// letter wrapped "grow" a line early). Android-only prop: iOS never reads it.
			textBreakStrategy="simple"
			{...rest}
			style={[
				textDefaults,
				topAligned,
				base,
				{ fontFamily, color: colors[color] },
				align ? { textAlign: align } : null,
				shift ? { transform: [{ translateY: shift }] } : null,
				ink ? { paddingTop: ink, marginBottom: -ink } : null,
				style,
				iosLineBox(own.lineHeight ?? base.lineHeight),
			]}
		>
			{children}
		</RNText>
	);
}

/**
 * One paragraph block whose own text is `before` and `after`, with other elements (a list) between them: the coach's
 * reply (C2). Reads as one accessible group and reports one text, the two runs joined, as the boards measure it.
 */
export function TextBlock({
	before,
	after,
	variant = "body",
	color = "ink",
	gap = 8,
	children,
}: {
	before: string;
	after: string;
	variant?: TypeToken;
	color?: ColorToken;
	gap?: number;
	children: ReactNode;
}) {
	const first = useRef<HostInstance>(null);
	const last = useRef<HostInstance>(null);
	const base = typeScale[variant];
	const ref = useDesignTag(
		{
			kind: "text",
			text: before + after,
			style: { fontFamily: base.fontFamily, fontSize: base.fontSize, lineHeight: base.lineHeight },
			color,
		},
		{ box: () => runsBox(ref, [first, last])() },
	);
	return (
		<View ref={ref} accessible style={{ gap }}>
			<View ref={first}>
				<Text variant={variant} color={color} tag={false}>
					{before}
				</Text>
			</View>
			{children}
			<View ref={last}>
				<Text variant={variant} color={color} tag={false}>
					{after}
				</Text>
			</View>
		</View>
	);
}
