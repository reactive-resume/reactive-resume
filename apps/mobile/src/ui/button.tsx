import type { IconName } from "./icon";
import type { ColorToken } from "./tokens";
import { ActivityIndicator, Platform, View } from "react-native";
import { Icon } from "./icon";
import { FeedbackPressable } from "./pressable";
import { Text } from "./text";
import { useTheme } from "./theme";

/** `dangerOutline` is the quieter destructive button (an outline in `dangerText`), for example Delete account. */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "dangerOutline" | "link";

export type ButtonProps = {
	label: string;
	onPress: () => void;
	/** Same names as the web Button. Defaults to `primary`. */
	variant?: ButtonVariant | undefined;
	/** `default` is 44 pt tall, `lg` is the 48 pt full-width form button, `sm` is a compact inline button. */
	size?: "default" | "sm" | "lg" | undefined;
	icon?: IconName | undefined;
	disabled?: boolean | undefined;
	/** Shows a spinner and blocks presses while an action runs. */
	loading?: boolean | undefined;
	fullWidth?: boolean | undefined;
	expanded?: boolean | undefined;
	accessibilityHint?: string | undefined;
	testID?: string | undefined;
};

const foregrounds = {
	primary: "onAccent",
	danger: "onAccent",
	secondary: "ink",
	ghost: "accentText",
	dangerOutline: "dangerText",
	link: "accentText",
} as const satisfies Record<ButtonVariant, ColorToken>;

const android = Platform.OS === "android";

export function Button({
	label,
	onPress,
	variant = "primary",
	size = "default",
	icon,
	disabled,
	loading,
	fullWidth,
	expanded,
	accessibilityHint,
	testID,
}: ButtonProps) {
	const { colors, radius, size: sizes, space } = useTheme();
	const inactive = disabled || loading;
	const foreground = colors[foregrounds[variant]];
	const background = {
		primary: colors.accent,
		danger: colors.danger,
		secondary: colors.raised,
		ghost: "transparent",
		dangerOutline: "transparent",
		link: "transparent",
	}[variant];
	// iOS highlights in place; Android draws a ripple in `press` instead (tokens.md §7).
	const pressedBackground = {
		primary: colors.accentHover,
		danger: colors.dangerText,
		secondary: colors.sunken,
		ghost: colors.press,
		dangerOutline: colors.press,
		link: "transparent",
	}[variant];
	// `sm` is 36 pt to look compact; `hitSlop` brings its target to 44.
	const height = size === "lg" ? sizes.button : size === "sm" ? sizes.hit - space.s2 : sizes.hit;

	return (
		<FeedbackPressable
			accessibilityRole="button"
			accessibilityLabel={label}
			accessibilityHint={accessibilityHint}
			accessibilityState={{ disabled: !!inactive, busy: !!loading, expanded }}
			disabled={inactive}
			onPress={onPress}
			testID={testID}
			hitSlop={size === "sm" ? { top: space.s1, bottom: space.s1 } : undefined}
			android_ripple={variant === "link" ? undefined : { color: colors.press }}
			style={({ pressed }) => ({
				minHeight: height,
				paddingHorizontal: variant === "link" ? 0 : size === "sm" ? space.s3 : space.s4,
				borderRadius: size === "sm" ? radius.rSm : size === "lg" ? radius.rLg : radius.rMd,
				borderWidth: variant === "secondary" || variant === "dangerOutline" ? 1 : 0,
				borderColor: variant === "dangerOutline" ? colors.dangerText : colors.line2,
				backgroundColor: pressed && !android ? pressedBackground : background,
				alignSelf: fullWidth ? "stretch" : "flex-start",
				alignItems: "center",
				justifyContent: "center",
				overflow: "hidden",
				opacity: (pressed && variant === "link") || disabled ? 0.45 : 1,
			})}
		>
			<View style={{ flexDirection: "row", alignItems: "center", gap: space.s2 }}>
				{loading ? <ActivityIndicator color={foreground} /> : null}
				{icon && !loading ? <Icon name={icon} size={sizes.icon.row} color={foreground} /> : null}
				<Text variant="label" color={foregrounds[variant]} align="center" style={{ flexShrink: 1 }}>
					{label}
				</Text>
			</View>
		</FeedbackPressable>
	);
}

export type IconButtonProps = {
	icon: IconName;
	/** The accessible name; icons are decorative. */
	label: string;
	onPress: () => void;
	/** For example to lift a row in a SortableList (`drag`). */
	onLongPress?: (() => void) | undefined;
	variant?: "ghost" | "secondary" | "primary" | undefined;
	/** Glyph size. Defaults to 22 (toolbars). The hit area is always at least 44 pt. */
	size?: number | undefined;
	/** A colour token for the glyph of a ghost or secondary button, for example `dangerText`. Defaults to `ink`. */
	color?: ColorToken | undefined;
	selected?: boolean | undefined;
	disabled?: boolean | undefined;
	accessibilityHint?: string | undefined;
	testID?: string | undefined;
};

export function IconButton({
	icon,
	label,
	onPress,
	onLongPress,
	variant = "ghost",
	size,
	color = "ink",
	selected,
	disabled,
	accessibilityHint,
	testID,
}: IconButtonProps) {
	const { colors, radius, size: sizes } = useTheme();
	const primary = variant === "primary";
	const glyph = disabled ? colors.ink3 : primary ? colors.onAccent : selected ? colors.accentText : colors[color];
	const background = primary ? colors.accent : selected ? colors.selectedFill : "transparent";

	return (
		<FeedbackPressable
			accessibilityRole="button"
			accessibilityLabel={label}
			accessibilityHint={accessibilityHint}
			accessibilityState={{ disabled: !!disabled, selected: !!selected }}
			disabled={disabled}
			onPress={onPress}
			onLongPress={onLongPress}
			testID={testID}
			android_ripple={{ color: colors.press, borderless: variant === "ghost" && !selected }}
			style={({ pressed }) => ({
				width: sizes.hit,
				height: sizes.hit,
				borderRadius: radius.rMd,
				alignItems: "center",
				justifyContent: "center",
				borderWidth: variant === "secondary" ? 1 : 0,
				borderColor: colors.line2,
				backgroundColor: pressed && !android ? (primary ? colors.accentHover : colors.press) : background,
			})}
		>
			<Icon name={icon} filled={selected} size={size ?? sizes.icon.toolbar} color={glyph} />
		</FeedbackPressable>
	);
}
