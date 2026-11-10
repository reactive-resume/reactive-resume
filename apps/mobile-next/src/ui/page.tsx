import type { PaperText } from "@/dev/storyboard/paper-text.gen";
import type { ImageSourcePropType, StyleProp, ViewStyle } from "react-native";
// The page band, pages and thumbnails (COMPONENTS.md §16), and the small data pieces of §18.
import { type ReactNode, useEffect, useState } from "react";
import { Image, View } from "react-native";
import { runOnJS, useAnimatedReaction, useSharedValue, withTiming } from "react-native-reanimated";
import { Box, Ring, Touch } from "./base";
import { Icon } from "./Icon";
import { enter, hitSlopFor, timeScale, useMotionPolicy } from "./motion";
import { Text } from "./Text";
import { useTheme } from "./theme";
import { layout, motion, radius } from "./tokens";
import { STORYBOARD, trackImage, useDesignTag } from "@/dev/storyboard/harness";

/** One text of a page fixture, reported to the layout dump at the place the image shows it (storyboard captures only). */
function PaperTag({ item }: { item: PaperText }) {
	const ref = useDesignTag({ kind: "paper", text: item.text });
	return (
		<View
			ref={ref}
			collapsable={false}
			pointerEvents="none"
			style={{
				position: "absolute",
				left: `${item.x * 100}%`,
				top: `${item.y * 100}%`,
				width: `${item.w * 100}%`,
				height: `${item.h * 100}%`,
			}}
		/>
	);
}

/** White paper with the page render. Paper never inverts; corners stay square. */
export function Page({
	source,
	width,
	height,
	children,
	shadow = true,
	style,
	fixtureText,
}: {
	fixtureText?: PaperText[] | undefined;
	source?: ImageSourcePropType | undefined;
	width: number;
	height: number;
	children?: ReactNode | undefined;
	shadow?: boolean | undefined;
	style?: StyleProp<ViewStyle>;
}) {
	const { shadows } = useTheme();
	return (
		<Box
			component="Page"
			style={[{ width, height, backgroundColor: "#FFFFFF" }, shadow ? { boxShadow: shadows.shp } : null, style]}
		>
			{source ? (
				<Image
					source={source}
					{...trackImage()}
					resizeMode="cover"
					style={{ width, height }}
					accessibilityIgnoresInvertColors
				/>
			) : null}
			{STORYBOARD && fixtureText ? fixtureText.map((item, i) => <PaperTag key={i} item={item} />) : null}
			{children}
		</Box>
	);
}

/** The sunken band that holds the scaled page on B1, B6 and L2; tapping it opens the full-screen preview. */
export function PageBand({
	children,
	onPress,
	label = "Preview the page",
}: {
	children: ReactNode;
	onPress?: (() => void) | undefined;
	label?: string | undefined;
}) {
	const { colors } = useTheme();
	const band = (
		<Box
			component="PageBand"
			bg="sunken"
			style={{
				marginTop: 20,
				paddingVertical: 24,
				alignItems: "center",
				justifyContent: "center",
				borderTopWidth: 1,
				borderBottomWidth: 1,
				borderColor: colors.line,
			}}
		>
			{children}
		</Box>
	);
	if (!onPress) return band;
	return (
		<Touch
			onPress={onPress}
			feedback="none"
			accessibilityRole="imagebutton"
			accessibilityLabel={label}
			testID="page-band"
		>
			{band}
		</Touch>
	);
}

/** A page thumbnail (B11's hero, B7's templates): paper, 2 dp corners, sh1 plus a 1 dp line ring, A4 ratio. */
export function PageThumbnail({
	source,
	width,
	selected = false,
	children,
}: {
	source?: ImageSourcePropType | undefined;
	width: number;
	selected?: boolean | undefined;
	children?: ReactNode | undefined;
}) {
	const { colors, shadows } = useTheme();
	const height = Math.round(((width * 297) / 210) * 2) / 2;
	return (
		<Box
			component="PageThumbnail"
			radius={radius.paper}
			style={{
				width,
				height,
				backgroundColor: "#FFFFFF",
				boxShadow: selected ? `0px 0px 0px 2px ${colors.accent}` : `${shadows.sh1}, 0px 0px 0px 1px ${colors.line}`,
				overflow: "hidden",
			}}
		>
			{source ? (
				<Image
					source={source}
					{...trackImage()}
					resizeMode="cover"
					style={{ width, height }}
					accessibilityIgnoresInvertColors
				/>
			) : null}
			{children}
		</Box>
	);
}

/** Big serif number (score, count). */
export function BigNumber({ children, count = false }: { children: string; count?: boolean | undefined }) {
	const target = Number(children);
	const counts = count && Number.isFinite(target);
	const shown = useCountUp(counts ? target : 0, counts);
	return <Text variant="bigNumber">{counts ? String(shown) : children}</Text>;
}

/** Counts up to `target` over d3 when it appears or changes (B9's score); jumps under reduced motion. */
function useCountUp(target: number, active: boolean) {
	const { reduced } = useMotionPolicy();
	const instant = reduced || timeScale.value === 0;
	const [shown, setShown] = useState(instant ? target : 0);
	const value = useSharedValue(instant ? target : 0);
	useEffect(() => {
		if (!active) return;
		value.set(reduced ? target : withTiming(target, enter(motion.d3)));
	}, [active, reduced, target, value]);
	useAnimatedReaction(
		() => Math.round(value.value),
		(next, previous) => {
			if (next !== previous) runOnJS(setShown)(next);
		},
	);
	return shown;
}

/** J4's three-up stats: a 36/40 serif number over a 13/18 label. */
export function ThreeUpStats({ items }: { items: { value: string; label: string }[] }) {
	return (
		<View style={{ flexDirection: "row", gap: 12, paddingTop: 20, paddingHorizontal: layout.screenMargin }}>
			{items.map((item) => (
				<View key={item.label} style={{ flex: 1 }} accessible accessibilityLabel={`${item.value} ${item.label}`}>
					<Text variant="statNumber">{item.value}</Text>
					<Text variant="small" color="ink3">
						{item.label}
					</Text>
				</View>
			))}
		</View>
	);
}

/**
 * J4's funnel: label (96 dp), an 8 dp accent bar, the count (28 dp, mono, end-aligned), 14 dp between rows. The bar
 * width is a fraction of the track; the growth animation belongs to the screen through the motion module.
 */
export function FunnelBars({
	rows,
	renderBar,
}: {
	rows: { label: string; count: number; fraction: number }[];
	renderBar?: (fraction: number, index: number) => ReactNode;
}) {
	const { colors } = useTheme();
	return (
		<View style={{ gap: 14, paddingHorizontal: layout.screenMargin }}>
			{rows.map((row, i) => (
				<View
					key={row.label}
					style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
					accessible
					accessibilityLabel={`${row.label}: ${row.count}`}
				>
					<Text variant="ui" color="ink2" style={{ width: 96 }} numberOfLines={1}>
						{row.label}
					</Text>
					<View style={{ flex: 1, height: 8 }}>
						{renderBar ? (
							renderBar(row.fraction, i)
						) : (
							<View
								style={{ width: `${row.fraction * 100}%`, height: 8, borderRadius: 2, backgroundColor: colors.accent }}
							/>
						)}
					</View>
					<Text variant="monoUi" color="ink2" align="right" style={{ width: 28 }}>
						{row.count}
					</Text>
				</View>
			))}
		</View>
	);
}

/** Waveform or day bars: accent bars 4 dp apart (W4 56 dp tall; B13 48 dp at 85% opacity, 3 dp apart). */
export function Waveform({
	levels,
	height = 56,
	gap = 4,
	opacity = 1,
}: {
	levels: number[];
	height?: number | undefined;
	gap?: number | undefined;
	opacity?: number | undefined;
}) {
	const { colors } = useTheme();
	return (
		<View
			style={{ height, flexDirection: "row", alignItems: "flex-end", gap }}
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
		>
			{levels.map((level, i) => (
				<View
					key={i}
					style={{
						flex: 1,
						height: Math.max(2, Math.round(level * height)),
						backgroundColor: colors.accent,
						opacity,
						borderTopLeftRadius: 1,
						borderTopRightRadius: 1,
					}}
				/>
			))}
		</View>
	);
}

/** W4's 72 × 72 record button: accent with a microphone; danger with a filled stop while recording. */
export function RecordButton({ recording, onPress }: { recording: boolean; onPress?: (() => void) | undefined }) {
	return (
		<Touch
			onPress={onPress}
			accessibilityLabel={recording ? "Stop recording" : "Start recording"}
			testID="record-button"
		>
			<Box
				component="RecordButton"
				bg={recording ? "danger" : "accent"}
				radius={radius.dialog}
				style={{ width: 72, height: 72, alignItems: "center", justifyContent: "center" }}
			>
				{recording ? (
					<Icon name="stop" size={32} color="onAccent" fill tint="#FFFFFF" />
				) : (
					<Icon name="microphone" size={32} color="onAccent" />
				)}
			</Box>
		</Touch>
	);
}

/** J2's stage button: "Interviewing · 4 of 6" with a caret; opens the list of stages (the visible way to change column). */
export function StageButton({
	stage,
	count,
	onPress,
}: {
	stage: string;
	count: string;
	onPress?: (() => void) | undefined;
}) {
	return (
		<Touch
			onPress={onPress}
			feedback="none"
			accessibilityLabel={`${stage}, ${count}`}
			accessibilityHint="Choose a stage"
			hitSlop={hitSlopFor(48, 44)}
			style={{ alignSelf: "flex-start" }}
			testID="stage-button"
		>
			<View style={{ height: 44, flexDirection: "row", alignItems: "center", gap: 8 }}>
				<Text variant="textLink" color="ink">
					{stage}
					<Text variant="textLink" weight={400} color="ink3" tag={false}>
						{` · ${count}`}
					</Text>
				</Text>
				<Icon name="caret-down" size={18} color="ink2" />
			</View>
		</Touch>
	);
}

/** B7's colour swatch: 40 × 40, 10 dp corners; selected: a 2 dp bg gap then a 2 dp accent ring and a white check. */
export function ColourSwatch({
	colour,
	selected = false,
	custom = false,
	label,
	onPress,
}: {
	colour?: string | undefined;
	selected?: boolean | undefined;
	custom?: boolean | undefined;
	label: string;
	onPress?: (() => void) | undefined;
}) {
	const { colors } = useTheme();
	return (
		<Touch onPress={onPress} accessibilityLabel={label} accessibilityState={{ selected }} hitSlop={hitSlopFor(40, 40)}>
			{/* Hidden from the dump: B7 draws swatches as plain boxes, without a component name. */}
			<Box
				component="ColourSwatch"
				hidden
				radius={radius.md}
				style={[
					{
						width: 40,
						height: 40,
						alignItems: "center",
						justifyContent: "center",
						backgroundColor: custom ? "transparent" : colour,
					},
					selected ? { boxShadow: `0px 0px 0px 2px ${colors.bg}, 0px 0px 0px 4px ${colors.accent}` } : null,
				]}
			>
				{custom ? <Ring color="controlBorder" radius={radius.md} /> : null}
				{custom ? (
					<Icon name="plus" size={20} color="ink2" />
				) : selected ? (
					<Icon name="check" size={16} color="onAccent" tint="#FFFFFF" />
				) : null}
			</Box>
		</Touch>
	);
}
