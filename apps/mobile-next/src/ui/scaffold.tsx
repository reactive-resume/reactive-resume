// Screen scaffolds: the chrome every screen of a kind shares, so screens only supply content.
//   TabScreen    root tabs: serif title that collapses into a bar, pull to refresh, inside a dock scene
//   PushScreen   pushed screens and full-screen modals: bare 56 dp bar, 28/34 title, one line, optional footer
//   SheetScreen  a route presented as the design-system bottom sheet
import { t } from "@lingui/core/macro";
import { useFocusEffect, useIsFocused, useRouter } from "expo-router";
import { type ReactNode, useCallback, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Screen } from "./base";
import { BottomSheet, type BottomSheetProps } from "./BottomSheet";
import { IconButton } from "./buttons";
import { CollapsedBar, useTitleCollapse } from "./CollapsingHeader";
import { DockScene } from "./Dock";
import { PageSubtitle, PageTitle, RootHeader, StatusLine } from "./layout";
import { PullToRefresh } from "./PullToRefresh";
import { Text } from "./Text";
import { useTheme } from "./theme";
import { type ColorToken, layout } from "./tokens";
import { registerMainScroll } from "@/dev/storyboard/capture";
import { DesignClip, STORYBOARD } from "@/dev/storyboard/harness";

type ScrollHandle = { scrollToEnd: (o?: { animated?: boolean }) => void };

/** Registers the focused screen's main scroll view with the capture harness (`--scroll end`). */
function useMainScroll() {
	const ref = useRef<ScrollHandle | null>(null);
	useFocusEffect(
		useCallback(() => {
			registerMainScroll(() => ref.current?.scrollToEnd({ animated: false }));
			return () => registerMainScroll(null);
		}, []),
	);
	return ref;
}

export function TabScreen({
	title,
	subtitle,
	actions,
	avatar,
	refreshing = false,
	onRefresh,
	children,
	footer,
	overlay,
	bottomPadding = 24,
}: {
	title: string;
	subtitle?: string | undefined;
	/** At most two icon buttons. The same nodes appear in the collapsed bar. */
	actions?: ReactNode;
	avatar?: ReactNode;
	refreshing?: boolean;
	onRefresh?: (() => void) | undefined;
	children: ReactNode;
	/** Pinned under the content, above the dock: J1's Select bar. */
	footer?: ReactNode;
	/** Drawn over the whole screen, above the bar: sheets a tab opens in place (J1's Move…, J2's stages). */
	overlay?: ReactNode;
	bottomPadding?: number;
}) {
	const collapse = useTitleCollapse();
	const scroll = useMainScroll();
	return (
		<DockScene>
			<Screen>
				<PullToRefresh
					refreshing={refreshing}
					onRefresh={onRefresh ?? (() => {})}
					scrollOffset={collapse.scrollY}
					scrollRef={scroll as never}
					showsVerticalScrollIndicator={!STORYBOARD}
					contentContainerStyle={{ paddingBottom: bottomPadding }}
				>
					<RootHeader title={title} subtitle={subtitle} actions={actions} avatar={avatar} />
					{children}
				</PullToRefresh>
				{footer}
				<CollapsedBar
					collapse={collapse}
					title={title}
					end={
						collapse.collapsed ? (
							<>
								{actions}
								{avatar}
							</>
						) : null
					}
				/>
				{overlay}
			</Screen>
		</DockScene>
	);
}

export type PushScreenProps = {
	/** The 28/34 page title; also the bar title once it has scrolled away. Omit for screens without one. */
	title?: string | undefined;
	titleEditCue?: boolean;
	onTitlePress?: (() => void) | undefined;
	/** The title is the landing place of a shared-element flight (J1's company name → J6, MOTION.md §6.2). */
	titleHeroId?: string | undefined;
	/** One 15/24 line under the title. */
	subtitle?: ReactNode;
	/** The document status line with Undo · Redo instead of a subtitle. */
	status?:
		| {
				text: string;
				onUndo?: (() => void) | undefined;
				onRedo?: (() => void) | undefined;
				canUndo?: boolean;
				canRedo?: boolean;
		  }
		| undefined;
	back?: "back" | "close" | "none";
	/** The back button's label: "Back to <the screen under this one>" (the builder dumps). Default Back or Close. */
	backLabel?: string | undefined;
	onBack?: (() => void) | undefined;
	/** At most two icon buttons, one small ghost button or a quiet note. */
	barEnd?: ReactNode;
	/** Replaces the centred bar title (connection chip). */
	barCenter?: ReactNode;
	/** Pinned under the content: FooterBar, Composer, a dock. */
	footer?: ReactNode;
	/** Over the whole screen, bar and footer included, not scrolling (zoom bar, dialogs, menus). */
	overlay?: ReactNode;
	bg?: ColorToken;
	/** False for screens that manage their own scrolling (chat, pagers, page preview). */
	scroll?: boolean;
	/** Wrap in a dock scene (builder and letter modes). */
	docked?: boolean;
	presentation?: "screen" | "modal";
	bottomPadding?: number;
	/**
	 * Storyboard dump only: leave out elements laid out entirely below the scroll view (under the footer), for the
	 * boards that end their content there (W1, W3). Other boards list what sits behind the footer or dock (B1, D4, B17).
	 */
	clipDump?: boolean;
	/** Storyboard backdrops only: the boards draw the body (title down) of a screen under a sheet at 50% opacity. */
	bodyOpacity?: number;
	children: ReactNode;
};

export function PushScreen({
	title,
	titleEditCue = false,
	onTitlePress,
	titleHeroId,
	subtitle,
	status,
	back = "back",
	backLabel,
	onBack,
	barEnd,
	barCenter,
	footer,
	overlay,
	bg = "bg",
	scroll = true,
	docked = false,
	presentation = "screen",
	bottomPadding = 24,
	clipDump = false,
	bodyOpacity,
	children,
}: PushScreenProps) {
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const { colors } = useTheme();
	const collapse = useTitleCollapse();
	const ref = useMainScroll();
	const focused = useIsFocused();
	const goBack =
		onBack ??
		(() => (docked ? router.dismissTo("/documents") : router.canGoBack() ? router.back() : router.replace("/")));
	const { shown } = collapse;
	const barTitle = useAnimatedStyle(() => ({ opacity: shown.value }));
	const heading = (
		<>
			{title ? (
				<PageTitle editCue={titleEditCue} onPress={onTitlePress} heroId={titleHeroId}>
					{title}
				</PageTitle>
			) : null}
			{status ? (
				<StatusLine
					status={status.text}
					onUndo={status.onUndo}
					onRedo={status.onRedo}
					canUndo={!!status.canUndo}
					canRedo={!!status.canRedo}
				/>
			) : subtitle ? (
				typeof subtitle === "string" ? (
					<PageSubtitle>{subtitle}</PageSubtitle>
				) : (
					subtitle
				)
			) : null}
		</>
	);
	const body = (
		<Screen bg={bg} presentation={presentation}>
			<View style={{ paddingTop: insets.top, backgroundColor: colors[bg], zIndex: 1 }}>
				<View
					style={{ height: layout.topBar, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 4 }}
				>
					<View style={{ minWidth: 44, flexDirection: "row" }}>
						{back === "none" ? null : (
							<IconButton
								icon={back === "close" ? "x" : "caret-left"}
								label={backLabel ?? (back === "close" ? t`Close` : t`Back`)}
								onPress={goBack}
								testID="top-bar-back"
							/>
						)}
					</View>
					<View style={{ flex: 1, minWidth: 0, alignItems: "center", justifyContent: "center" }}>
						{barCenter ??
							(title ? (
								<Animated.View style={barTitle} accessibilityElementsHidden={!collapse.collapsed}>
									<Text variant="topBarTitle" numberOfLines={1} tag={collapse.collapsed}>
										{title}
									</Text>
								</Animated.View>
							) : null)}
					</View>
					<View
						style={{ minWidth: 44, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4 }}
					>
						{barEnd}
					</View>
				</View>
				<Animated.View
					pointerEvents="none"
					style={[
						{ position: "absolute", left: 0, right: 0, bottom: 0, height: 1, backgroundColor: colors.line },
						barTitle,
					]}
				/>
			</View>
			{scroll ? (
				<DesignClip
					enabled={clipDump}
					bottomInset={footer || docked ? 0 : insets.bottom}
					style={{ flex: 1, opacity: bodyOpacity }}
				>
					<KeyboardAwareScrollView
						ref={ref as never}
						onScroll={collapse.onScroll as never}
						scrollEventThrottle={16}
						// Only the screen on top follows the keyboard: a screen under it scrolling for its field moved its
						// rows under taps meant for the top screen.
						enabled={focused}
						bottomOffset={24}
						keyboardShouldPersistTaps="handled"
						// Dragging the form down puts the keyboard away, as system forms do.
						keyboardDismissMode="interactive"
						showsVerticalScrollIndicator={!STORYBOARD}
						contentContainerStyle={{ paddingBottom: bottomPadding + (footer ? 0 : insets.bottom) }}
						style={{ flex: 1 }}
					>
						{heading}
						{children}
					</KeyboardAwareScrollView>
				</DesignClip>
			) : (
				<View style={{ flex: 1, opacity: bodyOpacity }}>
					{heading}
					{children}
				</View>
			)}
			{footer}
			{overlay ? (
				// Above the bar (zIndex 1) and the footer: dialogs, menus and scrims cover the whole screen.
				<View style={[StyleSheet.absoluteFill, { zIndex: 2 }]} pointerEvents="box-none">
					{overlay}
				</View>
			) : null}
		</Screen>
	);
	return docked ? <DockScene>{body}</DockScene> : body;
}

/** A route presented as a bottom sheet. The route is transparent; closing pops it after the sheet has left. */
export function SheetScreen({
	children,
	onClose,
	...sheet
}: Omit<BottomSheetProps, "onClose"> & { onClose?: (() => void) | undefined }) {
	const router = useRouter();
	return (
		<Screen bg="transparent" presentation="sheet">
			<BottomSheet {...sheet} onClose={onClose ?? (() => (router.canGoBack() ? router.back() : router.replace("/")))}>
				{children}
			</BottomSheet>
		</Screen>
	);
}
