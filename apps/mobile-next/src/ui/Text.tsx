import type { HostInstance, TextProps as RNTextProps, TextStyle } from "react-native";
import { type ReactNode, useRef, useState } from "react";
import { Platform, StyleSheet, Text as RNText, View } from "react-native";
import { useTheme } from "./theme";
import { type ColorToken, fonts, textDefaults, type as typeScale, type TypeToken } from "./tokens";
import { runsBox, useDesignTag } from "@/dev/storyboard/harness";

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
	/**
	 * A run drawn right after this text on the same line and reported on its own, as the boards nest a span in a
	 * label (J3's "9–15 Nov · Berlin time"): this text's tag keeps its own words and takes the box of both.
	 */
	after?: ReactNode;
	/**
	 * With `numberOfLines`: a cut text ends at a whole word and "…" (a preview, as B3's description card), measured by
	 * a hidden copy. What is drawn is the shortened string, so the layout dump reports exactly that.
	 */
	wordEllipsis?: boolean;
};

export function Text({
	variant = "ui",
	color = "ink",
	weight,
	align,
	style,
	tag = true,
	after,
	wordEllipsis = false,
	children,
	...rest
}: TextProps) {
	const { colors } = useTheme();
	const full = flatten(children);
	const clamp = useWordClamp(full, wordEllipsis ? (rest.numberOfLines ?? 0) : 0);
	const base = typeScale[variant];
	// The tag reports the style actually drawn, overrides included.
	const own = StyleSheet.flatten(style) ?? {};
	const fontFamily =
		own.fontFamily ??
		(weight && base.fontFamily !== fonts.display && base.fontFamily !== fonts.mono
			? uiFamily[weight]
			: base.fontFamily);
	const ref = useDesignTag(
		{
			kind: "text",
			text: clamp.shown,
			style: {
				fontFamily,
				fontSize: own.fontSize ?? base.fontSize,
				lineHeight: own.lineHeight ?? base.lineHeight,
				fontWeight: own.fontWeight,
			},
			color,
		},
		{ hidden: !tag },
	);
	const shift = glyphShift[variant];
	const ink = inkOffset[variant];
	const textStyle = [
		textDefaults,
		base,
		{ fontFamily, color: colors[color] },
		align ? { textAlign: align } : null,
		shift ? { transform: [{ translateY: shift }] } : null,
		ink ? { paddingTop: ink, marginBottom: -ink } : null,
		style,
		iosLineBox(own.lineHeight ?? base.lineHeight),
	];
	const text = (
		<RNText
			ref={after ? undefined : ref}
			maxFontSizeMultiplier={maxScale(fontFamily)}
			{...rest}
			{...(clamp.active ? { accessibilityLabel: rest.accessibilityLabel ?? full } : {})}
			style={textStyle}
		>
			{clamp.active ? clamp.shown : children}
		</RNText>
	);
	if (clamp.measuring)
		return (
			<View onLayout={(e) => clamp.setWidth(e.nativeEvent.layout.width)}>
				{text}
				{clamp.width > 0 ? (
					<RNText
						maxFontSizeMultiplier={maxScale(fontFamily)}
						style={[textStyle, { position: "absolute", top: 0, start: 0, width: clamp.width, opacity: 0 }]}
						onTextLayout={(e) => clamp.result(e.nativeEvent.lines.length)}
						accessibilityElementsHidden
						importantForAccessibility="no-hide-descendants"
					>
						{clamp.candidate}
					</RNText>
				) : null}
			</View>
		);
	if (!after) return text;
	return (
		<View ref={ref} collapsable={false} style={styles.runs}>
			{text}
			{after}
		</View>
	);
}

/** The first `n` words of `full` and "…"; all of them is the whole text. */
export const wordCut = (words: readonly string[], n: number) =>
	n >= words.length
		? words.join(" ")
		: `${words
				.slice(0, n)
				.join(" ")
				.replace(/[\s,;:.–—-]+$/, "")}…`;

/**
 * Word-boundary ellipsis: a binary search over word counts, each candidate laid out once by a hidden copy at the
 * text's width, for the most words that fit in `max` lines. `max` 0 turns it off.
 */
function useWordClamp(full: string, max: number) {
	const words = full.split(/\s+/);
	const [width, setWidth] = useState(0);
	const [state, setState] = useState<{ key: string; lo: number; hi: number; test: number; done: boolean } | null>(null);
	const key = `${full}|${width}|${max}`;
	const current = state?.key === key ? state : { key, lo: 0, hi: words.length, test: words.length, done: false };
	const result = (lines: number) => {
		const fits = lines <= max;
		const lo = fits ? current.test : current.lo;
		const hi = fits ? current.hi : current.test - 1;
		setState(
			lo >= hi ? { key, lo, hi, test: lo, done: true } : { key, lo, hi, test: Math.ceil((lo + hi) / 2), done: false },
		);
	};
	const shown = max && current.done ? wordCut(words, current.lo) : full;
	return {
		active: max > 0 && current.done && current.lo < words.length,
		measuring: max > 0,
		shown,
		candidate: wordCut(words, current.test),
		width,
		setWidth,
		result,
	};
}

const styles = StyleSheet.create({ runs: { flexDirection: "row", flexWrap: "wrap" } });

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
