// Screen chrome: root header, top bar, page title, section heading, footer bar (COMPONENTS.md §2–§4, §14).
import type { ReactNode } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Box, Touch } from "./base";
import { IconButton } from "./buttons";
import { Icon } from "./Icon";
import { Stacked, useLargeText } from "./large-text";
import { hitSlopFor } from "./motion";
import { Text } from "./Text";
import { useTheme } from "./theme";
import { type ColorToken, layout, radius } from "./tokens";

/** The 32 dp avatar in a 44 dp touch area; opens Settings from every root tab. */
export function AvatarButton({
	initials,
	onPress,
	label = "Settings",
}: {
	initials: string;
	onPress?: (() => void) | undefined;
	label?: string | undefined;
}) {
	return (
		<Touch
			onPress={onPress}
			accessibilityLabel={label}
			hitSlop={hitSlopFor(44, 44)}
			style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center", marginStart: 4 }}
		>
			<Avatar initials={initials} />
		</Touch>
	);
}

export function Avatar({ initials, size = 32 }: { initials: string; size?: 32 | 56 }) {
	return (
		<Box
			component="Avatar"
			bg="accentSoft"
			radius={size === 56 ? radius.xl : radius.sm}
			style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
		>
			<Text
				variant="caption"
				weight={600}
				color="accentText"
				style={size === 56 ? { fontSize: 18, lineHeight: 16 } : null}
				maxFontSizeMultiplier={1.3}
			>
				{initials}
			</Text>
		</Box>
	);
}

/** Root tabs: the 34/40 serif title on the background with at most two icons and the avatar, then one quiet line. */
export function RootHeader({
	title,
	subtitle,
	actions,
	avatar,
}: {
	title: string;
	subtitle?: string | undefined;
	actions?: ReactNode | undefined;
	avatar?: ReactNode | undefined;
}) {
	const insets = useSafeAreaInsets();
	return (
		<View style={{ paddingTop: insets.top }}>
			<View
				style={{
					paddingTop: 8,
					paddingHorizontal: layout.screenMargin,
					flexDirection: "row",
					alignItems: "center",
					justifyContent: "space-between",
					gap: 12,
					minHeight: 54,
				}}
			>
				<Text variant="rootTitle" accessibilityRole="header" numberOfLines={1} style={{ flexShrink: 1 }}>
					{title}
				</Text>
				<View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingBottom: 2 }}>
					{actions}
					{avatar}
				</View>
			</View>
			{subtitle ? (
				<View style={{ paddingHorizontal: layout.screenMargin }}>
					<Text variant="ui" color="ink3">
						{subtitle}
					</Text>
				</View>
			) : null}
		</View>
	);
}

/** Pushed screens: a bare 56 dp bar with back or close, an optional centred title and at most two end actions. */
export function TopBar({
	onBack,
	back = "back",
	backLabel,
	title,
	center,
	end,
	bg = "bg",
	divider = false,
	inset = true,
}: {
	onBack?: (() => void) | undefined;
	back?: "back" | "close" | "none";
	backLabel?: string | undefined;
	title?: string | undefined;
	/** Replaces the centred title (the connection chip on B16 and C2). */
	center?: ReactNode | undefined;
	end?: ReactNode | undefined;
	bg?: ColorToken | "transparent";
	divider?: boolean | undefined;
	/** False inside modals and sheets that already sit below the status area. */
	inset?: boolean | undefined;
}) {
	const { colors } = useTheme();
	const insets = useSafeAreaInsets();
	return (
		<View
			style={{ paddingTop: inset ? insets.top : 0, backgroundColor: bg === "transparent" ? "transparent" : colors[bg] }}
		>
			<View
				style={{
					height: layout.topBar,
					paddingHorizontal: 12,
					flexDirection: "row",
					alignItems: "center",
					gap: 4,
					borderBottomWidth: divider ? 1 : 0,
					borderBottomColor: colors.line,
				}}
			>
				<View style={{ minWidth: 44, flexDirection: "row" }}>
					{back === "none" ? null : (
						<IconButton
							icon={back === "close" ? "x" : "caret-left"}
							label={backLabel ?? (back === "close" ? "Close" : "Back")}
							onPress={onBack}
							testID="top-bar-back"
						/>
					)}
				</View>
				<View style={{ flex: 1, minWidth: 0, alignItems: "center", justifyContent: "center" }}>
					{center ??
						(title ? (
							<Text variant="topBarTitle" numberOfLines={1} accessibilityRole="header">
								{title}
							</Text>
						) : null)}
				</View>
				<View style={{ minWidth: 44, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
					{end}
				</View>
			</View>
		</View>
	);
}

/** A quiet text in the top bar's end slot ("2 of 3 open"). */
export function TopBarNote({ children }: { children: string }) {
	return (
		<View style={{ paddingEnd: 12 }}>
			<Text variant="ui" color="ink3">
				{children}
			</Text>
		</View>
	);
}

/** The 28/34 serif page title, with the edit cue where the title opens a field (B3, C4). */
export function PageTitle({
	children,
	editCue = false,
	onPress,
	numberOfLines,
}: {
	children: string;
	editCue?: boolean | undefined;
	onPress?: (() => void) | undefined;
	numberOfLines?: number | undefined;
}) {
	const title = (
		<View style={{ paddingTop: 4, paddingHorizontal: layout.screenMargin, flexDirection: "row", alignItems: "center" }}>
			<Text
				variant="pageTitle"
				accessibilityRole="header"
				{...(numberOfLines ? { numberOfLines } : {})}
				style={{ flexShrink: 1 }}
			>
				{children}
			</Text>
			{editCue ? (
				<Icon name="pencil-simple" size={18} color="ink3" style={{ marginStart: 6, marginBottom: 2 }} />
			) : null}
		</View>
	);
	if (!onPress) return title;
	return (
		<Touch onPress={onPress} feedback="none" accessibilityLabel={children} accessibilityHint="Edit the name">
			{title}
		</Touch>
	);
}

/** One 15/24 line under the page title: `ink-2` for a description, `ink-3` for a status line. */
export function PageSubtitle({ children, status = false }: { children: ReactNode; status?: boolean | undefined }) {
	return (
		<View style={{ paddingTop: 6, paddingHorizontal: layout.screenMargin }}>
			<Text variant="body" color={status ? "ink3" : "ink2"}>
				{children}
			</Text>
		</View>
	);
}

/**
 * The document's status line with Undo · Redo (BUILD.md §3.3): "Saved · 1 page · Public" then the two text
 * buttons in `accent-text`, each with a 48 dp tall hit area.
 */
export function StatusLine({
	status,
	onUndo,
	onRedo,
	canUndo = false,
	canRedo = false,
}: {
	status: string;
	onUndo?: (() => void) | undefined;
	onRedo?: (() => void) | undefined;
	canUndo?: boolean | undefined;
	canRedo?: boolean | undefined;
}) {
	const action = (label: string, onPress: (() => void) | undefined, enabled: boolean) => (
		<Touch
			onPress={onPress}
			disabled={!enabled}
			feedback="none"
			accessibilityLabel={label}
			hitSlop={hitSlopFor(48, 24)}
			style={{ paddingHorizontal: 2, opacity: enabled ? 1 : 0.45 }}
			testID={`status-${label.toLowerCase()}`}
		>
			<Text variant="body" weight={500} color="accentText">
				{label}
			</Text>
		</Touch>
	);
	return (
		<View
			style={{
				paddingTop: 6,
				paddingHorizontal: layout.screenMargin,
				flexDirection: "row",
				flexWrap: "wrap",
				alignItems: "center",
			}}
		>
			<Text variant="body" color="ink3">
				{status}
			</Text>
			{onUndo || onRedo ? (
				<>
					<Text variant="body" color="ink3">
						{" · "}
					</Text>
					{action("Undo", onUndo, canUndo)}
					<Text variant="body" color="ink3">
						{" · "}
					</Text>
					{action("Redo", onRedo, canRedo)}
				</>
			) : null}
		</View>
	);
}

/**
 * A 22/28 serif section heading. `first`: directly under a title block (20 dp top instead of 32). A heading with an
 * action gets 12 dp under it and the link its own 48 dp slot, so it never overlaps the first row's hit area.
 */
export function SectionHeading({
	title,
	count,
	action,
	onAction,
	first = false,
}: {
	title: string;
	count?: string | undefined;
	action?: string | undefined;
	onAction?: (() => void) | undefined;
	first?: boolean | undefined;
}) {
	return (
		<View
			style={{
				paddingTop: first ? layout.sectionGapTopFirst : layout.sectionGapTop,
				paddingHorizontal: layout.screenMargin,
				paddingBottom: action ? 12 : 4,
				flexDirection: "row",
				alignItems: "baseline",
				justifyContent: "space-between",
				gap: 12,
			}}
		>
			<Text variant="sheetTitle" accessibilityRole="header">
				{title}
			</Text>
			{count ? (
				<View style={{ flex: 1, paddingStart: 2, alignItems: "flex-start" }}>
					<Text variant="ui" color="ink3">
						{count}
					</Text>
				</View>
			) : null}
			{action ? (
				<Touch
					onPress={onAction}
					feedback="none"
					accessibilityRole="link"
					accessibilityLabel={action}
					hitSlop={hitSlopFor(48, 20)}
				>
					<Text variant="linkSmall" color="accentText">
						{action}
					</Text>
				</Touch>
			) : null}
		</View>
	);
}

/**
 * One or two Large buttons in thumb reach. `stacked` puts the primary above the others (J5, dialogs); buttons also
 * stack above 130% system text (COMPONENTS.md §20).
 * Sits above the bottom safe area; `raised` inside sheets.
 */
export function FooterBar({
	children,
	bg = "bg",
	divider = true,
	stacked = false,
	gap,
	inset = true,
}: {
	children: ReactNode;
	bg?: ColorToken | undefined;
	divider?: boolean | undefined;
	stacked?: boolean | undefined;
	gap?: number | undefined;
	inset?: boolean | undefined;
}) {
	const { colors } = useTheme();
	const insets = useSafeAreaInsets();
	const column = useLargeText() || stacked;
	return (
		<View
			style={{
				backgroundColor: colors[bg],
				paddingBottom: inset ? insets.bottom : 0,
				borderTopWidth: divider ? 1 : 0,
				borderTopColor: colors.line,
			}}
		>
			<Stacked.Provider value={column}>
				<Box
					component="FooterBar"
					style={{
						paddingVertical: 12,
						paddingHorizontal: layout.screenMargin,
						flexDirection: column ? "column" : "row",
						gap: gap ?? (column ? 8 : 12),
					}}
				>
					{children}
				</Box>
			</Stacked.Provider>
		</View>
	);
}

/** A 24 dp-margin column for rows; rows carry their own dividers. */
export function List({ children }: { children: ReactNode }) {
	return <View>{children}</View>;
}

/** The offline strip under the header: a quiet line that says work is queued. */
export function OfflineStrip({ children }: { children: string }) {
	const { colors } = useTheme();
	return (
		<View
			accessibilityRole="alert"
			style={{
				flexDirection: "row",
				alignItems: "center",
				gap: 8,
				paddingVertical: 8,
				paddingHorizontal: layout.screenMargin,
				backgroundColor: colors.sunken,
				borderBottomWidth: 1,
				borderBottomColor: colors.line,
			}}
		>
			<Icon name="cloud-slash" size={16} color="ink3" />
			<Text variant="small" color="ink2" style={{ flex: 1 }}>
				{children}
			</Text>
		</View>
	);
}
