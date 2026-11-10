// Buttons and icon buttons (COMPONENTS.md §6).
import type { StyleProp, ViewStyle } from "react-native";
import { View } from "react-native";
import { Box, Ring, Touch } from "./base";
import { Icon, type IconName } from "./Icon";
import { hitSlopFor } from "./motion";
import { Text } from "./Text";
import { useTheme } from "./theme";
import { type ColorToken, radius, type TypeToken } from "./tokens";

export type ButtonTone = "primary" | "secondary" | "ghost" | "accentGhost" | "dangerGhost" | "danger" | "soft";
export type ButtonSize = "sm" | "md" | "lg";

const sizes: Record<ButtonSize, { height: number; pad: number; text: TypeToken; icon: number; radius: number }> = {
	sm: { height: 28, pad: 10, text: "buttonSm", icon: 16, radius: radius.sm },
	md: { height: 36, pad: 14, text: "buttonMd", icon: 20, radius: radius.md },
	lg: { height: 44, pad: 16, text: "buttonLg", icon: 20, radius: radius.lg },
};

const tones: Record<ButtonTone, { bg?: ColorToken | undefined; fg: ColorToken; ring?: ColorToken | undefined }> = {
	primary: { bg: "accent", fg: "onAccent" },
	secondary: { bg: "surface", fg: "ink", ring: "line2" },
	ghost: { fg: "ink2" },
	accentGhost: { fg: "accentText" },
	dangerGhost: { fg: "dangerText" },
	danger: { bg: "dangerFill", fg: "onAccent" },
	soft: { bg: "accentSoft", fg: "accentText" },
};

export type ButtonProps = {
	label: string;
	onPress?: (() => void) | undefined;
	tone?: ButtonTone;
	size?: ButtonSize;
	icon?: IconName | undefined;
	/** Replaces the leading icon with the spinner while work runs (MOTION.md §8). */
	leading?: React.ReactNode | undefined;
	/** Fill the available width (hero, footer and dialog buttons). */
	block?: boolean | undefined;
	/** Share a row equally with siblings (footer bar). */
	grow?: boolean | undefined;
	disabled?: boolean | undefined;
	accessibilityLabel?: string | undefined;
	accessibilityHint?: string | undefined;
	testID?: string | undefined;
	style?: StyleProp<ViewStyle>;
};

export function Button({
	label,
	onPress,
	tone = "secondary",
	size = "md",
	icon,
	leading,
	block,
	grow,
	disabled,
	accessibilityLabel,
	accessibilityHint,
	testID,
	style,
}: ButtonProps) {
	const s = sizes[size];
	const t = tones[tone];
	return (
		<Touch
			onPress={onPress}
			disabled={!!disabled}
			accessibilityLabel={accessibilityLabel ?? label}
			{...(accessibilityHint ? { accessibilityHint } : {})}
			{...(testID ? { testID } : {})}
			hitSlop={hitSlopFor(48, s.height)}
			style={[
				block ? { alignSelf: "stretch" } : grow ? { flex: 1 } : { alignSelf: "flex-start" },
				disabled ? { opacity: 0.45 } : null,
				style,
			]}
		>
			<Box
				component="Button"
				radius={s.radius}
				{...(t.bg ? { bg: t.bg } : {})}
				style={{
					height: s.height,
					paddingHorizontal: s.pad,
					flexDirection: "row",
					alignItems: "center",
					justifyContent: "center",
					gap: 8,
				}}
			>
				{t.ring ? <Ring color={t.ring} radius={s.radius} /> : null}
				{leading ??
					(icon ? (
						<Icon name={icon} size={s.icon} color={t.fg} {...(tone === "danger" ? { tint: "#FFFFFF" } : {})} />
					) : null)}
				<Text
					variant={s.text}
					color={t.fg}
					numberOfLines={1}
					{...(tone === "danger" ? { style: { color: "#FFFFFF" } } : {})}
				>
					{label}
				</Text>
			</Box>
		</Touch>
	);
}

export type IconButtonProps = {
	icon: IconName;
	/** Required: icon buttons have no visible label. */
	label: string;
	onPress?: (() => void) | undefined;
	onLongPress?: (() => void) | undefined;
	size?: 44 | 36;
	iconSize?: number | undefined;
	color?: ColorToken | undefined;
	/** The "on" state: accent-soft fill with an accent-text icon. */
	on?: boolean | undefined;
	/** An 8 dp warn-mark dot at the top end (an icon button's indicator). */
	dot?: boolean | undefined;
	disabled?: boolean | undefined;
	testID?: string | undefined;
	style?: StyleProp<ViewStyle>;
};

export function IconButton({
	icon,
	label,
	onPress,
	onLongPress,
	size = 44,
	iconSize,
	color,
	on,
	dot,
	disabled,
	testID,
	style,
}: IconButtonProps) {
	const { colors } = useTheme();
	const tint: ColorToken = color ?? (on || icon === "sparkle" ? "accentText" : "ink2");
	return (
		<Touch
			onPress={onPress}
			{...(onLongPress ? { onLongPress } : {})}
			disabled={!!disabled}
			accessibilityLabel={label}
			{...(testID ? { testID } : {})}
			hitSlop={hitSlopFor(size, size)}
			style={[disabled ? { opacity: 0.45 } : null, style]}
		>
			<Box
				component="IconButton"
				radius={radius.md}
				{...(on ? { bg: "accentSoft" as const } : {})}
				style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
			>
				<Icon name={icon} size={iconSize ?? (size === 36 ? 20 : 24)} color={tint} />
				{dot ? (
					<View
						style={{
							position: "absolute",
							top: 9,
							right: 9,
							width: 8,
							height: 8,
							borderRadius: radius.full,
							backgroundColor: colors.warnMark,
						}}
					/>
				) : null}
			</Box>
		</Touch>
	);
}

/** A text link with its own 48 dp tall hit area ("Other formats", "Add experience"). */
export function TextLink({
	label,
	onPress,
	icon,
	variant = "textLink",
	color = "accentText",
	testID,
}: {
	label: string;
	onPress?: (() => void) | undefined;
	icon?: IconName | undefined;
	variant?: TypeToken | undefined;
	color?: ColorToken | undefined;
	testID?: string | undefined;
}) {
	return (
		<Touch
			onPress={onPress}
			accessibilityRole="link"
			accessibilityLabel={label}
			{...(testID ? { testID } : {})}
			hitSlop={hitSlopFor(48, 20)}
			style={{ alignSelf: "flex-start" }}
		>
			<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
				{icon ? <Icon name={icon} size={20} color={color} /> : null}
				<Text variant={variant} color={color}>
					{label}
				</Text>
			</View>
		</Touch>
	);
}
