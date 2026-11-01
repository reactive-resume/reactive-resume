import type { SaveStatus } from "@/draft/types";
import type { IconName } from "@/ui";
import type { Href } from "expo-router";
import type { ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import { useRouter, Stack, useNavigation, useSegments } from "expo-router";
import { createContext, use, useEffect, useState } from "react";
import { ActivityIndicator, I18nManager, Platform, Pressable, View } from "react-native";
import { SafeAreaInsetsContext, useSafeAreaInsets } from "react-native-safe-area-context";
import { AppStrip } from "./app-banner";
import { Bar, BarItem } from "./app-tabs";
import { useKeyCommands } from "./key-commands";
import { createSlot } from "./slot";
import { TopBar } from "./top-bar";
import { useIsTablet } from "./use-is-tablet";
import { routes } from "@/routes";
import { Button, Icon, IconButton, Segmented, Text, useReducedMotion, useTheme } from "@/ui";
import { KeyboardFrame, useKeyboardVisible } from "@/ui/keyboard";

export type SaveStatusSlot = {
	status: SaveStatus;
	/** Shows "Locked" instead of the save state. */
	locked?: boolean | undefined;
	/** "Not saved · Retry". */
	onRetry?: (() => void) | undefined;
};

/**
 * What screens put into the editor chrome with `useBuilderChrome`. Every key is optional; the latest mounted screen
 * wins per key, and a key disappears when the screen that set it unmounts.
 */
export type BuilderChromeSlots = {
	/** The document name in the top bar. Defaults to "Resume" or "Cover letter". */
	title?: string | undefined;
	/** The save status line under the name. Hidden until set. */
	save?: SaveStatusSlot | undefined;
	/** Opens the document menu (rename, duplicate, lock, notes, history, trash). Makes the name a button with a caret. */
	onMenu?: (() => void) | undefined;
	/** Replaces what the Download button does (resumes default to the Download & history route). */
	onExport?: (() => void) | undefined;
	/** Buttons before Download: Assistant on phone; History, Assistant and Download PDF on tablet. */
	actions?: ReactNode;
	/** Under the top bar, full width: the locked banner. The offline strip shows by itself when `save.status` is offline. */
	banner?: ReactNode;
	applicationId?: string | null | undefined;
	/** Counts on the pane tabs (`warn` badges), by pane, for example `{ check: 3 }` for open issues. */
	badges?: Partial<Record<string, number | string>> | undefined;
};

const slot = createSlot<BuilderChromeSlots>();

/**
 * Fills the editor chrome from a screen inside `app/builder/[id]` or `app/letter/[id]`.
 *
 * @example useBuilderChrome({ title: resume.name, save: { status, onRetry: retry } })
 */
export const useBuilderChrome = slot.useFill;

export type PaneTab<T extends string> = { pane: T; label: string; icon: IconName; href: Href };

type BuilderChromeProps<T extends string> = {
	/** The phone bottom tabs, in order. */
	panes: PaneTab<T>[];
	/** Panes in the tablet mode switch. The others are phone-only: on tablet the page sits beside the panel. */
	tabletPanes: T[];
	/** Tablet: shown beside the 400 pt panel. Without it the panel takes the full width. */
	page?: ReactNode;
	/** The top-bar name until a screen sets `title`. */
	title: string;
	/** What the Download button does unless a screen sets `onExport`. No Download button when neither is set. */
	onExport?: (() => void) | undefined;
	/** Child routes presented as modals (Download & history, the assistant). Every other child route pushes. */
	modals?: string[] | undefined /**
	 * Rendered inside the chrome, outside the Stack, so a layout can fill slots once for every pane, for example a
	 * component that reads the draft store and calls `useBuilderChrome({ title, save })`.
	 */;
	children?: ReactNode;
};

type FrameValue = {
	title: string;
	onExport: (() => void) | undefined;
	leave: () => void;
	/** The tablet Write / Design / Check switch. */
	modes: ReactNode;
};

const FrameContext = createContext<FrameValue | null>(null);

/**
 * The resume and letter editor shell (builder.html). It renders the editor's Stack itself.
 *
 * - Phone: the top bar (Back, name + save status, actions, Download) is the header of each pane screen, and the bottom
 *   pane tabs show under pane screens. Pushed screens (entry, history) have their own stack header and full height.
 * - Tablet: one top bar over everything with the Write / Design / Check switch in the middle, the Stack in a 400 pt
 *   panel and `page` beside it. Opening the Page pane on tablet switches to the first tablet pane.
 * - Keyboard: everything under the top bar ends at the top of the keyboard and the pane tabs hide, so screens put a
 *   toolbar last in their layout without their own keyboard handling.
 *
 * The Stack keeps one place in the tree in both layouts, so rotating or resizing never resets navigation.
 */
export function BuilderChrome<T extends string>(props: BuilderChromeProps<T>) {
	return (
		<slot.Provider>
			<Frame {...props} />
			{props.children}
		</slot.Provider>
	);
}

function Frame<T extends string>({ panes, tabletPanes, page, title, onExport, modals = [] }: BuilderChromeProps<T>) {
	const router = useRouter();
	const { t } = useLingui();
	const tablet = useIsTablet();
	const navigation = useNavigation();
	const insets = useSafeAreaInsets();
	const keyboardVisible = useKeyboardVisible();
	const { colors, size } = useTheme();
	const reduced = useReducedMotion();
	const current = useSegments().at(-1);
	const currentPane = panes.find(({ pane }) => pane === current);
	// The pane under a pushed screen or modal, so the switch and tabs keep showing it.
	const [lastPane, setLastPane] = useState(currentPane?.pane ?? panes[0]?.pane);
	if (currentPane && currentPane.pane !== lastPane) setLastPane(currentPane.pane);
	const activePane = currentPane ?? panes.find(({ pane }) => pane === lastPane);

	// The tablet has no Page pane: the page is always beside the panel.
	const firstTabletPane = panes.find(({ pane }) => tabletPanes.includes(pane));
	const redirect = tablet && currentPane && !tabletPanes.includes(currentPane.pane) ? firstTabletPane : undefined;
	useEffect(() => {
		if (redirect) router.replace(redirect.href);
	}, [redirect, router]);

	// Panes slide in from the side of the tab that was tapped, like a pager; set before each switch.
	const [paneAnimation, setPaneAnimation] = useState<"slide_from_right" | "slide_from_left">("slide_from_right");

	const switchPane = (next: PaneTab<T>) => {
		if (next.pane === currentPane?.pane) return;
		const after = panes.indexOf(next) > panes.findIndex(({ pane }) => pane === activePane?.pane);
		setPaneAnimation(after !== I18nManager.isRTL ? "slide_from_right" : "slide_from_left");
		if (!currentPane && activePane) router.dismissTo(activePane.href);
		router.replace(next.href);
	};

	// Hardware keyboard: ⌘1, ⌘2, ⌘3 (⌘4 on phone) switch to the panes in the order shown.
	const shownPanes = tablet ? panes.filter(({ pane }) => tabletPanes.includes(pane)) : panes;
	useKeyCommands(
		shownPanes.map((pane, index) => ({
			id: `pane-${pane.pane}`,
			input: String(index + 1),
			title: pane.label,
			run: () => switchPane(pane),
		})),
	);

	// On iOS a modal slides over the pane, so its tabs stay underneath. On Android it fills the screen like a push.
	const underModal = Platform.OS === "ios" && !!current && modals.includes(current);
	const barPane = currentPane ?? (underModal ? activePane : undefined);
	const paneNames = new Set<string>(panes.map(({ pane }) => pane));

	const frame: FrameValue = {
		title,
		onExport,
		// Back leaves the editor (the root stack), even with an entry open in the tablet panel.
		leave: () => (navigation.canGoBack() ? navigation.goBack() : router.replace(routes.documents())),
		modes: activePane ? (
			<Segmented
				compact
				label={t`Editor mode`}
				value={activePane.pane}
				options={shownPanes.map(({ pane, label, icon }) => ({ value: pane, label, icon }))}
				onChange={(value) => {
					const next = panes.find(({ pane }) => pane === value);
					if (next) switchPane(next);
				}}
			/>
		) : null,
	};

	return (
		<FrameContext value={frame}>
			<View style={{ flex: 1, backgroundColor: colors.bg }}>
				{tablet ? <ChromeTopBar /> : null}
				<KeyboardFrame
					behavior="padding"
					automaticOffset
					style={{ flex: 1, paddingLeft: insets.left, paddingRight: insets.right }}
				>
					{/* On tablet the top bar has cleared the status bar, so headers inside the panel must not pad it again. */}
					<SafeAreaInsetsContext value={{ ...insets, left: 0, right: 0, top: tablet ? 0 : insets.top }}>
						<View style={{ flex: 1, flexDirection: "row" }}>
							<View
								style={
									tablet && page
										? {
												width: size.panel,
												backgroundColor: colors.surface,
												borderEndWidth: 1,
												borderEndColor: colors.line,
											}
										: { flex: 1 }
								}
							>
								<Stack
									screenOptions={({ route }) => {
										if (!paneNames.has(route.name))
											return {
												headerTransparent: false,
												unstable_nativeProps: { headerConfig: { disableTopInsetApplication: tablet } },
											};
										const animation = reduced ? "fade" : paneAnimation;
										return tablet ? { headerShown: false, animation } : { header: () => <ChromeTopBar />, animation };
									}}
								>
									{modals.map((name) => (
										<Stack.Screen
											key={name}
											name={name}
											options={{ presentation: "modal", headerShown: name !== "assistant" }}
										/>
									))}
								</Stack>
							</View>
							{tablet && page ? (
								<View style={{ flex: 1, paddingBottom: keyboardVisible ? 0 : insets.bottom }}>{page}</View>
							) : null}
						</View>
						{!tablet && barPane ? <PaneBar panes={panes} active={barPane.pane} onSwitch={switchPane} /> : null}
					</SafeAreaInsetsContext>
				</KeyboardFrame>
			</View>
		</FrameContext>
	);
}

/** The top bar and the screen's banner. Reads the slots, so slot changes re-render only this, never the Stack. */
function ChromeTopBar() {
	const router = useRouter();
	const { t } = useLingui();
	const tablet = useIsTablet();
	const slots = slot.useSlot();
	const frame = use(FrameContext);
	if (!frame) return null;
	const exportDocument = slots.onExport ?? frame.onExport;
	const applicationId = slots.applicationId;

	return (
		<>
			<TopBar
				backLabel={slots.applicationId ? t`Back to application` : t`Back to Documents`}
				onBack={applicationId ? () => router.replace(routes.applicationDetails(applicationId)) : frame.leave}
				title={slots.title ?? frame.title}
				onTitlePress={slots.onMenu}
				titleLabel={t`Document menu`}
				subtitle={slots.save ? <SaveStatusLine {...slots.save} /> : null}
				center={frame.modes}
				actions={
					<>
						{slots.actions}
						{exportDocument ? <ExportButton tablet={tablet} onPress={exportDocument} /> : null}
					</>
				}
			/>
			{slots.save?.status === "offline" ? (
				<AppStrip
					tone="warn"
					icon="cloud-slash"
					message={t`You can keep editing. Changes sync when you're back online. PDF sharing works with cached fonts and images.`}
				/>
			) : null}
			{slots.banner}
		</>
	);
}

type PaneBarProps<T extends string> = {
	panes: PaneTab<T>[];
	active: T;
	onSwitch: (pane: PaneTab<T>) => void;
};

function PaneBar<T extends string>({ panes, active, onSwitch }: PaneBarProps<T>) {
	const slots = slot.useSlot();

	return (
		<Bar activeIndex={panes.findIndex(({ pane }) => pane === active)}>
			{panes.map((pane) => (
				<BarItem
					key={pane.pane}
					label={pane.label}
					icon={pane.icon}
					focused={pane.pane === active}
					badge={slots.badges?.[pane.pane]}
					badgeTone="warn"
					onPress={() => onSwitch(pane)}
				/>
			))}
		</Bar>
	);
}

type ExportButtonProps = {
	tablet: boolean;
	onPress: () => void;
};

/** Opens Download & history. Sharing has its own pane. */
function ExportButton({ tablet, onPress }: ExportButtonProps) {
	const { t } = useLingui();
	if (tablet)
		return (
			<View>
				<Button variant="secondary" size="sm" icon="download-simple" label={t`Download`} onPress={onPress} />
			</View>
		);
	return <IconButton icon="download-simple" label={t`Download & history`} onPress={onPress} />;
}

type SaveStatusLineProps = SaveStatusSlot;

const statusLook = {
	saving: { icon: null, color: "ink3" },
	saved: { icon: "cloud-check", color: "ink3" },
	idle: { icon: "cloud-check", color: "ink3" },
	offline: { icon: "cloud-slash", color: "warnText" },
	error: { icon: "cloud-warning", color: "dangerText" },
} as const satisfies Record<SaveStatus, { icon: IconName | null; color: string }>;

/** The line under the document name, worded like web's `save-status.tsx`. */
function SaveStatusLine({ status, locked, onRetry }: SaveStatusLineProps) {
	const { t } = useLingui();
	const { colors, size, space } = useTheme();
	const look = locked ? { icon: "lock" as const, color: "ink3" as const } : statusLook[status];
	const label = locked
		? t`Locked`
		: {
				saving: t`Saving…`,
				saved: t`Saved`,
				idle: t`Saved`,
				offline: t`Offline · saved on this device`,
				error: t`Not saved`,
			}[status];

	return (
		<View
			accessibilityLiveRegion="polite"
			style={{ flexDirection: "row", alignItems: "center", gap: space.s1, minWidth: 0 }}
		>
			<View style={{ width: size.icon.meta, height: size.icon.meta, alignItems: "center", justifyContent: "center" }}>
				{look.icon ? (
					<Icon name={look.icon} size={size.icon.meta} color={colors[look.color]} />
				) : (
					<ActivityIndicator size="small" color={colors.ink3} style={{ transform: [{ scale: 0.7 }] }} />
				)}
			</View>
			<Text variant="caption" color={look.color} numberOfLines={1} style={{ flexShrink: 1 }}>
				{label}
			</Text>
			{!locked && status === "error" && onRetry ? (
				<Pressable accessibilityRole="button" accessibilityLabel={t`Retry saving`} hitSlop={space.s3} onPress={onRetry}>
					<Text variant="caption" color="accentText" style={{ textDecorationLine: "underline" }}>
						{t`Retry`}
					</Text>
				</Pressable>
			) : null}
		</View>
	);
}
