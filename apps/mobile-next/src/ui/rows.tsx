import type { HapticToken } from "./tokens";
// Lists and rows (COMPONENTS.md §5) with their leading and trailing pieces.
import type { ReactNode } from "react";
import { View } from "react-native";
import { Box, Ring, Touch } from "./base";
import { Icon, type IconName } from "./Icon";
import { Text } from "./Text";
import { useTheme } from "./theme";
import { type ColorToken, layout, radius, type TypeToken } from "./tokens";

/**
 * 40 × 40 icon tile; `accent` uses accent-soft with an accent-text icon. A4's 56 dp tiles keep the 10 dp corners and
 * the 22 dp icon; `children` replaces the icon (A4's 32 dp logo).
 */
export function IconTile({
	icon,
	accent = false,
	color,
	size = 40,
	children,
}: {
	icon?: IconName | undefined;
	accent?: boolean | undefined;
	color?: ColorToken | undefined;
	size?: 40 | 56;
	children?: ReactNode | undefined;
}) {
	return (
		<Box
			component="IconTile"
			bg={accent ? "accentSoft" : "sunken"}
			radius={radius.md}
			style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
		>
			{children ?? (icon ? <Icon name={icon} size={22} color={color ?? (accent ? "accentText" : "ink2")} /> : null)}
		</Box>
	);
}

/** 40 × 40 company monogram. */
export function Monogram({ letters }: { letters: string }) {
	return (
		<Box
			component="Monogram"
			bg="sunken"
			radius={radius.md}
			style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}
		>
			<Text variant="ui" weight={600} color="ink2" style={{ lineHeight: 16 }} maxFontSizeMultiplier={1.3}>
				{letters}
			</Text>
		</Box>
	);
}

/** The 36 × 50 paper thumbnail of a document in a list. Paper never inverts. */
export function DocThumb({ letter = false }: { letter?: boolean | undefined }) {
	const bar = (width: `${number}%`) => (
		<View style={{ height: 2, width, backgroundColor: "#D3CFC7", borderRadius: 1 }} />
	);
	return (
		<Box
			component="DocThumb"
			radius={3}
			style={{
				width: layout.listThumbWidth,
				height: layout.listThumbHeight,
				backgroundColor: "#FFFFFF",
				paddingVertical: 7,
				paddingHorizontal: 6,
				gap: 3,
			}}
		>
			<Ring color="line2" radius={3} />
			<View
				style={{
					height: 4,
					width: letter ? "35%" : "55%",
					backgroundColor: letter ? "#5B5B5B" : "#2D3A4A",
					borderRadius: 1,
					marginBottom: 2,
				}}
			/>
			{bar("100%")}
			{bar("80%")}
			{bar("100%")}
			{bar("65%")}
		</Box>
	);
}

export type Stage = "saved" | "applied" | "screening" | "interview" | "offer" | "closed";
const stageColor: Record<Stage, ColorToken> = {
	saved: "stSaved",
	applied: "stApplied",
	screening: "stScreening",
	interview: "stInterview",
	offer: "stOffer",
	closed: "stClosed",
};

/** 8 dp stage dot; always next to the stage name. */
export function StageDot({ stage }: { stage: Stage }) {
	const { colors } = useTheme();
	return (
		<View style={{ width: 8, height: 8, borderRadius: radius.full, backgroundColor: colors[stageColor[stage]] }} />
	);
}

/** A warn-mark indicator dot in a list. */
export function WarnDot({ size = 8 }: { size?: number | undefined }) {
	const { colors } = useTheme();
	return <View style={{ width: size, height: size, borderRadius: radius.full, backgroundColor: colors.warnMark }} />;
}

/** A 60 dp mono time in a row's leading slot. */
export function RowTime({ children }: { children: string }) {
	return (
		<Text variant="monoUi" color="ink2" style={{ width: 60 }}>
			{children}
		</Text>
	);
}

/** A 40 dp date in a row's leading slot: day caption over a 22/26 serif number. */
export function RowDate({ day, date }: { day: string; date: string }) {
	return (
		<View style={{ width: 40, alignItems: "center" }}>
			<Text variant="caption" color="ink3">
				{day}
			</Text>
			<Text variant="sheetTitle" style={{ lineHeight: 26 }}>
				{date}
			</Text>
		</View>
	);
}

export type ListRowProps = {
	title: string;
	secondary?: string | undefined;
	leading?: ReactNode | undefined;
	/** "caret": caret-right; "external": arrow-up-right; "up": caret-up; or any node (switch, badge, button). */
	trailing?: "caret" | "external" | "up" | ReactNode;
	/** A quiet value before the trailing caret ("Onyx"); a separate trailing node sits 16 dp after it. */
	value?: string | undefined;
	/** An 18 dp `ink-3` icon inside the value, 6 dp after it (B6's `caret-right`; `.li .v .i`). */
	valueIcon?: IconName | undefined;
	/** A small mark inside the value, 6 dp before it (B6's colour swatch). */
	valueLeading?: ReactNode | undefined;
	onPress?: (() => void) | undefined;
	onLongPress?: (() => void) | undefined;
	/** Haptic when the long-press fires; null for a silent long-press (D6). Default `light`. */
	longPressHaptic?: HapticToken | null | undefined;
	/** Dividers: a 1 dp line under every row except the last; `top` adds one above (lists under a title block). */
	last?: boolean | undefined;
	top?: boolean | undefined;
	danger?: boolean | undefined;
	disabled?: boolean | undefined;
	/** Let the title or the secondary line wrap (questions, facts). */
	wrapTitle?: boolean | undefined;
	wrapSecondary?: boolean | undefined;
	/** Title line limit, then an ellipsis (document names: 2). Overrides `wrapTitle`. */
	titleLines?: number | undefined;
	titleColor?: ColorToken | undefined;
	/** Title style; B11's link row uses Geist Mono 14/20 (`monoUi`, `.t-mono`). Default `rowTitle`. */
	titleVariant?: TypeToken | undefined;
	/** Secondary line colour (S5's failure line in `dangerText`). Default `ink3`. */
	secondaryColor?: ColorToken | undefined;
	accessibilityLabel?: string | undefined;
	accessibilityHint?: string | undefined;
	accessibilityRole?: "button" | "switch" | "link" | "radio" | "checkbox";
	accessibilityState?: { checked?: boolean | undefined; selected?: boolean | undefined };
	testID?: string | undefined;
	/** Inside a scroll view rows wait 50 ms before washing so a scroll never flashes them. */
	washDelay?: number | undefined;
	/** Extra content under the text block, inside the row. */
	children?: ReactNode | undefined;
};

export function ListRow({
	title,
	secondary,
	leading,
	trailing,
	value,
	valueIcon,
	valueLeading,
	onPress,
	onLongPress,
	longPressHaptic,
	last = false,
	top = false,
	danger = false,
	disabled = false,
	wrapTitle = false,
	wrapSecondary = false,
	titleLines,
	titleColor,
	titleVariant = "rowTitle",
	secondaryColor = "ink3",
	accessibilityLabel,
	accessibilityHint,
	accessibilityRole = "button",
	accessibilityState,
	testID,
	washDelay = 50,
	children,
}: ListRowProps) {
	const { colors } = useTheme();
	const trailingNode =
		trailing === "caret" ? (
			<Icon name="caret-right" size={24} color="ink2" />
		) : trailing === "external" ? (
			<Icon name="arrow-up-right" size={24} color="ink2" />
		) : trailing === "up" ? (
			<Icon name="caret-up" size={24} color="ink2" />
		) : (
			trailing
		);
	const body = (
		<Box
			component="ListRow"
			style={{
				minHeight: layout.listRowMin,
				paddingVertical: 12,
				flexDirection: "row",
				alignItems: "center",
				gap: 16,
				borderBottomWidth: last ? 0 : 1,
				borderBottomColor: colors.line,
				borderTopWidth: top ? 1 : 0,
				borderTopColor: colors.line,
				opacity: disabled ? 0.45 : 1,
			}}
		>
			{leading}
			<View style={{ flex: 1, minWidth: 0, gap: 2 }}>
				<Text
					variant={titleVariant}
					color={titleColor ?? (danger ? "dangerText" : "ink")}
					{...(titleLines ? { numberOfLines: titleLines } : wrapTitle ? {} : { numberOfLines: 1 })}
				>
					{title}
				</Text>
				{secondary ? (
					<Text variant="ui" color={secondaryColor} {...(wrapSecondary ? {} : { numberOfLines: 1 })}>
						{secondary}
					</Text>
				) : null}
				{children}
			</View>
			{value ? (
				valueIcon || valueLeading ? (
					<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
						{valueLeading}
						<Text variant="ui" color="ink3">
							{value}
						</Text>
						{valueIcon ? <Icon name={valueIcon} size={18} color="ink3" /> : null}
					</View>
				) : (
					<Text variant="ui" color="ink3">
						{value}
					</Text>
				)
			) : null}
			{trailingNode}
		</Box>
	);
	if (!onPress && !onLongPress) return <View style={{ paddingHorizontal: layout.screenMargin }}>{body}</View>;
	return (
		<Touch
			onPress={onPress}
			{...(onLongPress ? { onLongPress } : {})}
			{...(longPressHaptic !== undefined ? { longPressHaptic } : {})}
			disabled={disabled}
			feedback="wash"
			washDelay={washDelay}
			accessibilityRole={accessibilityRole}
			accessibilityLabel={accessibilityLabel ?? title}
			{...(accessibilityHint || secondary ? { accessibilityHint: accessibilityHint ?? secondary ?? "" } : {})}
			{...(accessibilityState ? { accessibilityState } : {})}
			{...(testID ? { testID } : {})}
			style={{ paddingHorizontal: layout.screenMargin }}
		>
			{body}
		</Touch>
	);
}

/** A text button in a row's trailing slot (`linkSmall`, 48 dp tall hit). */
export function RowLink({
	label,
	onPress,
	testID,
}: {
	label: string;
	onPress?: (() => void) | undefined;
	testID?: string | undefined;
}) {
	return (
		<Touch
			onPress={onPress}
			feedback="none"
			accessibilityLabel={label}
			hitSlop={{ top: 14, bottom: 14, left: 8, right: 8 }}
			{...(testID ? { testID } : {})}
		>
			<Text variant="linkSmall" color="accentText">
				{label}
			</Text>
		</Touch>
	);
}

/** A 20 dp evidence icon in a row's leading slot, tinted by meaning (always beside words). */
export function EvidenceIcon({ icon, tone = "quiet" }: { icon: IconName; tone?: "accent" | "warn" | "quiet" }) {
	return (
		<Icon name={icon} size={24} color={tone === "accent" ? "accentText" : tone === "warn" ? "warnText" : "ink3"} />
	);
}
