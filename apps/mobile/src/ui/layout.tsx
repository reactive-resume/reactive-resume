import type { IconName } from "./icon";
import type { ColorToken } from "./tokens";
import type { ReactElement, ReactNode } from "react";
import type { DimensionValue, LayoutChangeEvent, StyleProp, ViewStyle } from "react-native";
import { useLingui } from "@lingui/react/macro";
import { Image } from "expo-image";
import { Children, cloneElement, isValidElement, useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, {
	cancelAnimation,
	Easing,
	FadeIn,
	FadeInUp,
	FadeOut,
	FadeOutUp,
	useAnimatedStyle,
	useSharedValue,
	withRepeat,
	withTiming,
} from "react-native-reanimated";
import { Button, IconButton } from "./button";
import { Icon } from "./icon";
import { haptics, useReducedMotion } from "./motion";
import { FeedbackPressable } from "./pressable";
import { Text } from "./text";
import { useTheme } from "./theme";

const android = Platform.OS === "android";

export type ListRowProps = {
	title: string;
	subtitle?: string | undefined;
	/** An icon name, or any element (avatar, checkbox, thumbnail). */
	leading?: IconName | ReactNode;
	/** A value, switch or badge at the end. */
	trailing?: ReactNode;
	/** A short value at the end in `ink3`, for example the current choice of a setting. */
	value?: string | undefined;
	onPress?: (() => void) | undefined;
	onLongPress?: (() => void) | undefined;
	/** Shows a caret: the row opens another screen. */
	chevron?: boolean | undefined;
	/** Shows an "opens outside the app" glyph instead of the caret (web settings in the browser tab). */
	external?: boolean | undefined;
	destructive?: boolean | undefined;
	/** Accent title and icon, for an action row such as "Add server". */
	accent?: boolean | undefined;
	selected?: boolean | undefined;
	disabled?: boolean | undefined;
	accessibilityHint?: string | undefined;
	/** iOS: a hairline above the row. ListGroup sets it on every row after the first. */
	divider?: boolean | undefined;
};

export function ListRow({
	title,
	subtitle,
	leading,
	trailing,
	value,
	onPress,
	onLongPress,
	chevron,
	external,
	destructive,
	accent,
	selected,
	disabled,
	accessibilityHint,
	divider,
}: ListRowProps) {
	const { colors, size, space } = useTheme();
	const { fontScale } = useWindowDimensions();
	const stacked = fontScale > 1.3;
	const tone: ColorToken = destructive ? "dangerText" : accent ? "accentText" : "ink";
	// ink3 is too light on selectedFill (tokens.md §1); secondary text uses ink2 there.
	const quiet: ColorToken = selected ? "ink2" : "ink3";
	const pressable = !!onPress || !!onLongPress;
	const leadingGraphic =
		typeof leading === "string" ? (
			<Icon name={leading as IconName} size={size.icon.row} color={colors[tone === "ink" ? "ink2" : tone]} />
		) : (
			leading
		);
	const indicators = (
		<>
			{selected && !trailing && !chevron ? <Icon name="check" size={size.icon.row} color={colors.accentText} /> : null}
			{chevron ? <Icon name="caret-right" size={size.icon.meta} color={colors.ink3} /> : null}
			{external ? <Icon name="arrow-square-out" size={size.icon.meta} color={colors.ink3} /> : null}
		</>
	);
	const accessory = (
		<>
			{value ? (
				<Text
					color={quiet}
					numberOfLines={stacked ? undefined : 1}
					style={stacked ? undefined : { flexShrink: 1, maxWidth: "50%" }}
				>
					{value}
				</Text>
			) : null}
			{trailing}
		</>
	);

	return (
		<Pressable
			accessibilityRole={pressable ? "button" : undefined}
			accessibilityState={{ disabled: !!disabled, selected: !!selected }}
			accessibilityHint={accessibilityHint}
			disabled={disabled || !pressable}
			onPress={onPress}
			onLongPress={
				onLongPress
					? () => {
							haptics.light();
							onLongPress();
						}
					: undefined
			}
			android_ripple={pressable ? { color: colors.press } : undefined}
			style={({ pressed }) => ({
				minHeight: subtitle ? size.row + space.s3 : android ? size.row + space.s1 : size.row,
				flexDirection: stacked ? "column" : "row",
				alignItems: stacked ? "stretch" : "center",
				gap: stacked ? space.s2 : android ? space.s4 : space.s3,
				paddingVertical: space.s2,
				paddingStart: space.s4,
				paddingEnd: android ? space.s4 : space.s3,
				backgroundColor: pressed && !android ? colors.press : selected ? colors.selectedFill : "transparent",
				opacity: disabled ? 0.45 : 1,
			})}
		>
			{divider && !android ? (
				<View
					style={{
						position: "absolute",
						top: 0,
						end: 0,
						start: leading && !stacked ? space.s4 + size.icon.row + space.s3 : space.s4,
						height: StyleSheet.hairlineWidth,
						backgroundColor: colors.line,
					}}
				/>
			) : null}
			{stacked ? (
				leading || chevron || external || (selected && !trailing) ? (
					<View style={{ flexDirection: "row", alignItems: "center", gap: space.s2 }}>
						{leadingGraphic}
						<View style={{ flex: 1 }} />
						{indicators}
					</View>
				) : null
			) : (
				leadingGraphic
			)}
			<View style={{ flex: stacked ? undefined : 1, minWidth: 0, gap: 1 }}>
				<Text variant="bodyLarge" color={tone}>
					{title}
				</Text>
				{subtitle ? (
					<Text variant="callout" color={quiet}>
						{subtitle}
					</Text>
				) : null}
				{stacked && (value || trailing) ? (
					<View style={{ alignItems: "flex-start", gap: space.s1, paddingTop: space.s1 }}>{accessory}</View>
				) : null}
			</View>
			{!stacked && (
				<>
					{accessory}
					{indicators}
				</>
			)}
		</Pressable>
	);
}

export type ListGroupProps = {
	/** Group header: `ink3` caption on iOS, `accentText` on Android. */
	title?: string | undefined;
	/** Small print under the group. */
	footer?: string | undefined;
	children?: ReactNode;
};

/**
 * Rows grouped like the platform's settings lists (tokens.md §7): iOS inset grouped (`raised`, `rLg`, hairlines
 * between rows); Android full-width rows on `bg`, so the group bleeds through the screen's `s4` side padding.
 */
export function ListGroup({ title, footer, children }: ListGroupProps) {
	const { colors, fonts, radius, space } = useTheme();
	const rows = Children.toArray(children).filter(isValidElement) as ReactElement<ListRowProps>[];

	return (
		<View style={{ marginHorizontal: android ? -space.s4 : 0 }}>
			{title ? (
				<Text
					accessibilityRole="header"
					variant="callout"
					color={android ? "accentText" : "ink3"}
					style={[
						{ paddingHorizontal: space.s4, paddingBottom: space.s1 },
						android ? { fontFamily: fonts.ui[600], paddingTop: space.s2 } : null,
					]}
				>
					{title}
				</Text>
			) : null}
			<View style={android ? null : { backgroundColor: colors.raised, borderRadius: radius.rLg, overflow: "hidden" }}>
				{rows.map((row, index) => (row.type === ListRow && index > 0 ? cloneElement(row, { divider: true }) : row))}
			</View>
			{footer ? (
				<Text variant="callout" color="ink3" style={{ paddingHorizontal: space.s4, paddingTop: space.s1 }}>
					{footer}
				</Text>
			) : null}
		</View>
	);
}

export type CardProps = {
	children?: ReactNode;
	onPress?: (() => void) | undefined;
	onLongPress?: (() => void) | undefined;
	selected?: boolean | undefined;
	/** The accessible name when the card is pressable. */
	accessibilityLabel?: string | undefined;
	style?: StyleProp<ViewStyle>;
};

export function Card({ children, onPress, onLongPress, selected, accessibilityLabel, style }: CardProps) {
	const { colors, radius, shadows, space } = useTheme();
	const cardStyle = {
		padding: space.s3,
		borderRadius: radius.rLg,
		borderWidth: 1,
		borderColor: selected ? colors.accent : colors.line,
		backgroundColor: selected ? colors.selectedFill : colors.surface,
		boxShadow: shadows.e1.boxShadow,
	};

	// A card that is not pressable stays a plain container, so the controls inside it remain separate
	// accessibility elements.
	if (!onPress && !onLongPress) return <View style={[cardStyle, style]}>{children}</View>;

	return (
		<FeedbackPressable
			accessibilityRole="button"
			accessibilityLabel={accessibilityLabel}
			accessibilityState={{ selected: !!selected }}
			onPress={onPress}
			onLongPress={
				onLongPress
					? () => {
							haptics.light();
							onLongPress();
						}
					: undefined
			}
			android_ripple={{ color: colors.press }}
			style={({ pressed }) => [
				cardStyle,
				{ overflow: "hidden" },
				pressed && !android ? { backgroundColor: selected ? colors.accentSoft : colors.sunken } : null,
				style,
			]}
		>
			{children}
		</FeedbackPressable>
	);
}

type Action = { label: string; onPress: () => void };

export type EmptyStateProps = {
	icon?: IconName | undefined;
	title: string;
	message?: string | undefined;
	action?: Action | undefined;
	/** A second, quieter action under the first. */
	secondaryAction?: Action | undefined;
};

export function EmptyState({ icon, title, message, action, secondaryAction }: EmptyStateProps) {
	const { colors, radius, size, space } = useTheme();

	return (
		<View style={{ alignItems: "center", gap: space.s3, paddingVertical: space.s10, paddingHorizontal: space.s6 }}>
			{icon ? (
				<View
					style={{
						width: size.hit + space.s5,
						height: size.hit + space.s5,
						marginBottom: space.s1,
						borderRadius: radius.rLg,
						alignItems: "center",
						justifyContent: "center",
						backgroundColor: colors.sunken,
					}}
				>
					<Icon name={icon} size={size.icon.bar + space.s2} color={colors.ink2} />
				</View>
			) : null}
			<Text accessibilityRole="header" variant="heading" align="center" style={{ alignSelf: "stretch" }}>
				{title}
			</Text>
			{message ? (
				<Text color="ink2" align="center" style={{ maxWidth: size.panel - space.s12 * 2 }}>
					{message}
				</Text>
			) : null}
			{action ? (
				<View style={{ alignSelf: "center" }}>
					<Button label={action.label} onPress={action.onPress} />
				</View>
			) : null}
			{secondaryAction ? (
				<View style={{ alignSelf: "center" }}>
					<Button variant="ghost" label={secondaryAction.label} onPress={secondaryAction.onPress} />
				</View>
			) : null}
		</View>
	);
}

/** `accent` is the success banner (for example "Imported from LinkedIn"). */
export type BannerTone = "info" | "warn" | "danger" | "accent";

/** The app-wide banners from tokens.md §1: each sets its tone and icon. The screen still supplies the copy. */
export type BannerVariant = "offline" | "locked" | "guest" | "sessionExpired";

export type BannerProps = {
	/** `info`: offline and neutral guidance. `warn`: guest, session expired. `danger`: errors. Defaults from `variant`. */
	tone?: BannerTone | undefined;
	variant?: BannerVariant | undefined;
	message: string;
	title?: string | undefined;
	icon?: IconName | undefined;
	action?: Action | undefined;
	/** Several actions, for example Create account and Sign in on the guest banner. */
	actions?: Action[] | undefined;
	onDismiss?: (() => void) | undefined;
	/** A full-width status strip under the top bar (offline), instead of a rounded card in the content. */
	strip?: boolean | undefined;
};

const bannerColors = {
	info: { background: "infoSoft", text: "infoText" },
	warn: { background: "warnSoft", text: "warnText" },
	danger: { background: "dangerSoft", text: "dangerText" },
	accent: { background: "accentSoft", text: "accentText" },
} as const satisfies Record<BannerTone, { background: ColorToken; text: ColorToken }>;

const bannerVariants = {
	offline: { tone: "info", icon: "cloud-slash" },
	locked: { tone: "info", icon: "lock" },
	guest: { tone: "warn", icon: "warning-circle" },
	sessionExpired: { tone: "warn", icon: "clock" },
} as const satisfies Record<BannerVariant, { tone: BannerTone; icon: IconName }>;

export function Banner({ tone, variant, message, title, icon, action, actions, onDismiss, strip }: BannerProps) {
	const { t } = useLingui();
	const { colors, fonts, motion, radius, size, space } = useTheme();
	const reduced = useReducedMotion();
	const preset = variant ? bannerVariants[variant] : undefined;
	const palette = bannerColors[tone ?? preset?.tone ?? "info"];
	const glyph = icon ?? preset?.icon;
	const buttons = [...(action ? [action] : []), ...(actions ?? [])];

	return (
		<Animated.View
			entering={reduced ? FadeIn.duration(motion.d1) : FadeInUp.duration(motion.d2)}
			exiting={reduced ? FadeOut.duration(motion.d1) : FadeOutUp.duration(motion.d2)}
			accessibilityRole={palette.text === "dangerText" ? "alert" : undefined}
			accessibilityLiveRegion="polite"
			style={{
				flexDirection: "row",
				alignItems: strip ? "center" : "flex-start",
				gap: strip ? space.s2 : space.s3,
				minHeight: strip ? size.hit - space.s2 : undefined,
				paddingVertical: strip ? space.s1 + space.s0 : space.s3,
				paddingHorizontal: strip ? space.s4 : space.s3,
				borderRadius: strip ? 0 : radius.rLg,
				backgroundColor: colors[palette.background],
			}}
		>
			{glyph ? <Icon name={glyph} size={strip ? size.icon.meta : size.icon.row} color={colors[palette.text]} /> : null}
			<View style={{ flex: 1, gap: space.s0 }}>
				{title ? (
					<Text variant="callout" weight={600} color={palette.text}>
						{title}
					</Text>
				) : null}
				<Text variant={strip ? "caption" : "callout"} color={palette.text}>
					{message}
				</Text>
				{buttons.length > 0 ? (
					<View style={{ flexDirection: "row", flexWrap: "wrap", marginStart: -space.s2, marginBottom: -space.s2 }}>
						{buttons.map((button) => (
							<Pressable
								key={button.label}
								accessibilityRole="button"
								onPress={button.onPress}
								style={({ pressed }) => ({
									minHeight: size.hit,
									justifyContent: "center",
									paddingHorizontal: space.s2,
									opacity: pressed ? 0.6 : 1,
								})}
							>
								<Text
									variant="callout"
									color={palette.text}
									style={{ fontFamily: fonts.ui[600], textDecorationLine: "underline" }}
								>
									{button.label}
								</Text>
							</Pressable>
						))}
					</View>
				) : null}
			</View>
			{onDismiss ? (
				<View style={{ margin: -space.s3 }}>
					<IconButton icon="x" label={t`Dismiss`} size={size.icon.meta} color={palette.text} onPress={onDismiss} />
				</View>
			) : null}
		</Animated.View>
	);
}

export type AvatarProps = {
	name: string;
	uri?: string | null | undefined;
	/** Diameter in pt. Defaults to 40. */
	size?: number | undefined;
};

export function Avatar({ name, uri, size = 40 }: AvatarProps) {
	const { colors, fonts, motion, radius } = useTheme();
	// Array.from keeps surrogate pairs whole, so a name starting with an emoji or a supplementary-plane letter
	// does not show half a character.
	const initials = name
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => Array.from(part)[0]?.toLocaleUpperCase())
		.join("");
	const circle = { width: size, height: size, borderRadius: radius.rLg };

	if (uri)
		return (
			<Image
				source={{ uri }}
				transition={motion.d2}
				style={circle}
				accessible
				accessibilityRole="image"
				accessibilityLabel={name}
			/>
		);

	return (
		<View
			accessible
			accessibilityRole="image"
			accessibilityLabel={name}
			style={[circle, { alignItems: "center", justifyContent: "center", backgroundColor: colors.accentSoft }]}
		>
			{/* Initials scale with the circle (mockups: 14 at 36, 26 at 72), not with the font-size setting. */}
			<Text
				allowFontScaling={false}
				color="accentText"
				style={{ fontFamily: fonts.ui[700], fontSize: Math.round(size * 0.37), lineHeight: Math.round(size * 0.5) }}
			>
				{initials}
			</Text>
		</View>
	);
}

export type SkeletonProps = {
	width?: DimensionValue | undefined;
	height: number;
	radius?: number | undefined;
};

/** A loading placeholder: `sunken` with a `line` shimmer. Reduced motion shows the static block. */
export function Skeleton({ width = "100%", height, radius }: SkeletonProps) {
	const { colors, motion, radius: radii } = useTheme();
	const reduced = useReducedMotion();
	const [measured, setMeasured] = useState(0);
	const progress = useSharedValue(0);

	useEffect(() => {
		if (reduced || measured === 0) return;
		// One sweep is about the mockups' 1.4 s.
		progress.set(0);
		progress.set(withRepeat(withTiming(1, { duration: motion.d3 * 4, easing: Easing.linear }), -1));
		return () => cancelAnimation(progress);
	}, [reduced, measured, motion.d3, progress]);

	const sweep = useAnimatedStyle(() => ({ transform: [{ translateX: (progress.get() * 2 - 1) * measured }] }));

	return (
		<View
			accessible={false}
			importantForAccessibility="no-hide-descendants"
			onLayout={(event: LayoutChangeEvent) => setMeasured(event.nativeEvent.layout.width)}
			style={{ width, height, overflow: "hidden", borderRadius: radius ?? radii.rSm, backgroundColor: colors.sunken }}
		>
			{reduced || measured === 0 ? null : (
				<Animated.View
					style={[
						StyleSheet.absoluteFill,
						{ backgroundImage: `linear-gradient(90deg, ${colors.sunken}, ${colors.line}, ${colors.sunken})` },
						sweep,
					]}
				/>
			)}
		</View>
	);
}
