import type { ApplicationTab } from "@/routes";
import type { ComponentRef, ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import { useRouter, useGlobalSearchParams, useLocalSearchParams, useNavigation } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { SafeAreaInsetsContext, useSafeAreaInsets } from "react-native-safe-area-context";
import { WORKSPACE_TABS } from "@reactive-resume/schema/career";
import { createSlot } from "./slot";
import { TopBar } from "./top-bar";
import { useIsTablet } from "./use-is-tablet";
import { workspaceTabLabel } from "./workspace-tab-label";
import { routes } from "@/routes";
import { IconButton, Text, useTheme } from "@/ui";
import { KeyboardFrame } from "@/ui/keyboard";

/** What workspace tabs put into the application chrome with `useWorkspaceChrome`. */
export type WorkspaceChromeSlots = {
	/** The company. Defaults to "Application". */
	title?: string | undefined;
	/** "Senior Game Developer · Interview". */
	subtitle?: string | undefined;
	/** Top-bar buttons: Application details, Ask coach. */
	actions?: ReactNode;
	/** Tablet: the 270 pt context column beside the tab (dates, links, people). */
	context?: ReactNode;
	/** Under the tab strip, full width: the read-only saved-version banner. */
	banner?: ReactNode;
	/** Badges after a tab's name, for example `{ messages: "2 unread" }`. */
	badges?: Partial<Record<ApplicationTab, ReactNode>> | undefined;
};

const slot = createSlot<WorkspaceChromeSlots>();

/** True for the workspace tabs; other `[tab]` values (`details`) get no workspace chrome. */
export const isWorkspaceTab = (tab: string | undefined): tab is ApplicationTab =>
	(WORKSPACE_TABS as readonly string[]).includes(tab ?? "");

/** Fills the application workspace chrome from a screen inside `app/applications/[id]`. */
export const useWorkspaceChrome = slot.useFill;

// career.html `.tablet .split`: the context column is 270 pt.
const contextWidth = 270;

/**
 * The application workspace shell (career.html): top bar with Back to applications, the company and role, then the
 * Fit … Saved tab strip, which scrolls sideways. On tablet the `context` column sits beside the tab.
 */
export function WorkspaceChrome({ children }: { children: ReactNode }) {
	return (
		<slot.Provider>
			<Frame>{children}</Frame>
		</slot.Provider>
	);
}

function Frame({ children }: { children: ReactNode }) {
	const router = useRouter();
	const { t } = useLingui();
	const tablet = useIsTablet();
	const insets = useSafeAreaInsets();
	const navigation = useNavigation();
	const slots = slot.useSlot();
	const { id } = useLocalSearchParams<{ id: string }>();
	// The tab is the child route's param, so the layout reads it globally.
	const { tab } = useGlobalSearchParams<{ tab?: string }>();
	const { colors, size, space } = useTheme();
	const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
	const tabLayouts = useRef<Partial<Record<ApplicationTab, { x: number; width: number }>>>({});
	const [viewport, setViewport] = useState(0);
	const [contentWidth, setContentWidth] = useState(0);
	const [offset, setOffset] = useState(0);
	const overflow = contentWidth > viewport + 1;
	const revealActive = () => {
		const layout = isWorkspaceTab(tab) ? tabLayouts.current[tab] : undefined;
		if (layout && viewport > 0)
			scroll.current?.scrollTo({
				x: Math.min(Math.max(0, contentWidth - viewport), Math.max(0, layout.x - (viewport - layout.width) / 2)),
				animated: false,
			});
	};

	useEffect(revealActive, [tab, viewport, contentWidth]);

	if (!isWorkspaceTab(tab)) return <View style={{ flex: 1 }}>{children}</View>;

	return (
		<View style={{ flex: 1, backgroundColor: colors.bg }}>
			<TopBar
				backLabel={t`Back to applications`}
				onBack={() => (navigation.canGoBack() ? navigation.goBack() : router.replace(routes.applications()))}
				title={slots.title ?? t`Application`}
				subtitle={
					slots.subtitle ? (
						<Text variant="caption" color="ink3" numberOfLines={1}>
							{slots.subtitle}
						</Text>
					) : null
				}
				actions={slots.actions}
			/>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					paddingLeft: insets.left,
					paddingRight: insets.right,
					backgroundColor: colors.surface,
					borderBottomWidth: 1,
					borderBottomColor: colors.line,
				}}
			>
				{overflow && (
					<IconButton
						icon="caret-left"
						label={t`Previous workspace tabs`}
						disabled={offset <= 1}
						onPress={() => scroll.current?.scrollTo({ x: Math.max(0, offset - viewport), animated: false })}
					/>
				)}
				<ScrollView
					ref={scroll}
					horizontal
					style={{ flex: 1 }}
					accessibilityRole="tablist"
					onLayout={(event) => setViewport(event.nativeEvent.layout.width)}
					onContentSizeChange={setContentWidth}
					onScroll={(event) => setOffset(event.nativeEvent.contentOffset.x)}
					scrollEventThrottle={32}
					contentContainerStyle={{ paddingHorizontal: space.s3, gap: space.s1 }}
				>
					{WORKSPACE_TABS.map((name) => {
						const active = name === tab;
						return (
							<Pressable
								key={name}
								accessibilityRole="tab"
								accessibilityState={{ selected: active }}
								onLayout={(event) => {
									tabLayouts.current[name] = event.nativeEvent.layout;
									if (active) revealActive();
								}}
								onPress={() => !active && router.replace(routes.application(id, name))}
								style={({ pressed }) => ({
									flexDirection: "row",
									alignItems: "center",
									gap: space.s1,
									minHeight: size.hit,
									paddingHorizontal: space.s3,
									borderBottomWidth: space.s0,
									borderBottomColor: active ? colors.accent : "transparent",
									backgroundColor: pressed ? colors.press : "transparent",
								})}
							>
								<Text variant={active ? "label" : "body"} color={active ? "accentText" : "ink2"}>
									{workspaceTabLabel(name)}
								</Text>
								{slots.badges?.[name]}
							</Pressable>
						);
					})}
				</ScrollView>
				{overflow && (
					<IconButton
						icon="caret-right"
						label={t`Next workspace tabs`}
						disabled={offset + viewport >= contentWidth - 1}
						onPress={() =>
							scroll.current?.scrollTo({ x: Math.min(contentWidth - viewport, offset + viewport), animated: false })
						}
					/>
				)}
			</View>
			{slots.banner}
			<KeyboardFrame
				behavior="padding"
				automaticOffset
				style={{ flex: 1, flexDirection: "row", paddingLeft: insets.left, paddingRight: insets.right }}
			>
				{tablet && slots.context ? (
					<View
						style={{
							width: contextWidth,
							padding: space.s6,
							borderEndWidth: 1,
							borderEndColor: colors.line,
						}}
					>
						{slots.context}
					</View>
				) : null}
				<SafeAreaInsetsContext value={{ ...insets, left: 0, right: 0, top: 0 }}>
					<View style={{ flex: 1 }}>{children}</View>
				</SafeAreaInsetsContext>
			</KeyboardFrame>
		</View>
	);
}
