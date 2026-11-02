import type { AdvancedId } from "./advanced";
import type { PickerSpec } from "./picker";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { I18nManager, Pressable, View, useWindowDimensions } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Animated, { FadeIn, LinearTransition, ReduceMotion, SlideInLeft, SlideInRight } from "react-native-reanimated";
import { AdvancedGroup, AdvancedPageScreen, ColoursScreen, StylesScreen, TypographyScreen } from "./advanced";
import {
	applyTemplate,
	designWrite,
	setPreviewTemplate,
	useClearPreviewOnLeave,
	useDesignDraft,
	usePreviewTemplate,
	usePreviewedDraft,
} from "./draft";
import { LayoutScreen } from "./layout-screen";
import { Picker } from "./picker";
import { TemplatePreviewCaption } from "./preview-caption";
import { ColorGroup, EntriesGroup, PageGroup, TypeGroup } from "./style-groups";
import { TemplateGroup, useSheetScroll } from "./template-group";
import { useSession } from "@/auth/session";
import { nativeEnvironment } from "@/draft/native";
import { setResumeLocked } from "@/features/share/revision";
import { ResumePage } from "@/preview/page";
import { useIsTablet } from "@/shell/use-is-tablet";
import { Banner, IconButton, Skeleton, Text, haptics, showToast, useReducedMotion, useTheme } from "@/ui";
import { useKeyboardScrollSpace } from "@/ui/keyboard";

type Tab = "template" | "entries" | "type" | "color" | "page";
type Entry = { kind: "advanced"; id: AdvancedId } | { kind: "picker"; spec: PickerSpec };

const SCROLL_STEP = 100;

/**
 * Design. Phone: the page in the top half and a sheet with Template · Entries · Type · Color · Page tabs; the
 * grabber raises it to full height. Advanced sits at the end of Page and pushes sub-screens inside the sheet. Tablet:
 * the same sheet content as the panel, beside the page the builder layout draws.
 */
export function DesignPane({ id }: { id: string }) {
	const { t } = useLingui();
	const { colors, fonts, radius, space, size, motion, shadows } = useTheme();
	const window = useWindowDimensions();
	const tablet = useIsTablet();
	const keyboardSpace = useKeyboardScrollSpace();
	const reduced = useReducedMotion();
	const draft = useDesignDraft(id);
	const session = useSession();
	const [tab, setTab] = useState<Tab>("template");
	const [expanded, setExpanded] = useState(false);
	const [advancedOpen, setAdvancedOpen] = useState(false);
	const [stack, setStack] = useState<Entry[]>([]);
	const preview = usePreviewTemplate();
	useClearPreviewOnLeave();
	const [scrollLocked, setScrollLocked] = useState(false);
	const [height, setHeight] = useState(window.height / 2);
	const [panelWidth, setPanelWidth] = useState(window.width);
	const { data, locked } = draft;
	const pageDraft = usePreviewedDraft(draft);
	const disabled = locked || !data;
	const full = tablet || expanded;
	const top = stack.at(-1);
	// A pushed or popped screen gets a new scroll view, which starts at the top.
	useEffect(() => useSheetScroll.setState({ offset: 0 }), [top]);

	const push = (entry: Entry) => {
		setExpanded(true);
		setStack((value) => [...value, entry]);
	};
	const pop = () => setStack((value) => value.slice(0, -1));
	const pick = (spec: PickerSpec) => push({ kind: "picker", spec });
	const unlock = () => setResumeLocked(id, false);

	const titles: Record<AdvancedId, string> = {
		typography: t`Typography`,
		colours: t`Design`,
		page: t`Page`,
		layout: t`Layout`,
		styles: t`Custom styles`,
	};
	const tabs: { id: Tab; label: string }[] = [
		{ id: "template", label: t`Template` },
		{ id: "entries", label: t`Entries` },
		{ id: "type", label: t`Type` },
		{ id: "color", label: t`Color` },
		{ id: "page", label: t`Page` },
	];

	const body = () => {
		if (!data) {
			return (
				<View style={{ gap: space.s3 }} accessibilityLabel={t`Loading`}>
					<Skeleton height={space.s8} width="60%" />
					<Skeleton height={space.s12 * 3} />
					<Skeleton height={space.s12} />
				</View>
			);
		}
		const props = { data, write: designWrite, disabled, pick };
		if (top?.kind === "advanced") {
			if (top.id === "typography") return <TypographyScreen {...props} />;
			if (top.id === "colours") return <ColoursScreen {...props} />;
			if (top.id === "page") return <AdvancedPageScreen {...props} />;
			if (top.id === "layout") return <LayoutScreen {...props} onDragChange={setScrollLocked} />;
			return <StylesScreen {...props} />;
		}
		if (tab === "template")
			return (
				<TemplateGroup
					{...props}
					layout={full ? "grid" : "strip"}
					columns={tablet ? 2 : 3}
					width={panelWidth - space.s4 * 2}
					preview={preview}
					onPreview={setPreviewTemplate}
					onApply={applyTemplate}
				/>
			);
		if (tab === "type")
			return (
				<TypeGroup
					{...props}
					onCustomFonts={() => {
						setTab("page");
						setAdvancedOpen(true);
						push({ kind: "advanced", id: "typography" });
					}}
				/>
			);
		if (tab === "entries") return <EntriesGroup {...props} />;
		if (tab === "color") return <ColorGroup {...props} />;
		return (
			<View style={{ gap: space.s6 }}>
				<PageGroup {...props} />
				<View style={{ height: 1, backgroundColor: colors.line }} />
				<AdvancedGroup
					{...props}
					open={advancedOpen}
					onOpenChange={setAdvancedOpen}
					onPush={(advanced) => push({ kind: "advanced", id: advanced })}
				/>
			</View>
		);
	};

	const banner =
		session.status === "signed-out" || session.status === "expired" ? (
			<Banner tone="warn" message={t`Sign in to view this resume.`} />
		) : draft.status === "error" && !draft.document ? (
			<Banner
				tone="danger"
				message={t`Couldn't load the resume.`}
				action={{ label: t`Retry`, onPress: () => void draft.open(id).catch(() => undefined) }}
			/>
		) : locked ? (
			<Banner
				tone="info"
				icon="lock"
				message={t`This resume is locked. Unlock it first to make changes.`}
				action={{
					label: t`Unlock`,
					onPress: () => void unlock().catch(() => showToast({ message: t`Couldn't unlock the resume. Try again.` })),
				}}
			/>
		) : null;

	const sheet = (
		<View style={{ flex: 1 }} onLayout={(event) => setPanelWidth(event.nativeEvent.layout.width)}>
			{tablet ? null : (
				<Pressable
					accessibilityRole="button"
					accessibilityLabel={expanded ? t`Lower the design sheet` : t`Raise the design sheet`}
					accessibilityState={{ expanded }}
					onPress={() => {
						setExpanded(!expanded);
						if (expanded) setStack([]);
					}}
					style={{ height: space.s5 + space.s0, alignItems: "center", justifyContent: "center" }}
				>
					<View
						style={{
							width: size.grabber.width,
							height: size.grabber.height,
							borderRadius: radius.rLg,
							backgroundColor: colors.line2,
						}}
					/>
				</Pressable>
			)}
			{top ? (
				<View style={{ flexDirection: "row", alignItems: "center", minHeight: size.hit, paddingEnd: space.s4 }}>
					<IconButton icon="caret-left" label={t`Back`} onPress={pop} />
					<Text variant="title" numberOfLines={1} style={{ flex: 1 }}>
						{top.kind === "advanced" ? titles[top.id] : top.spec.title}
					</Text>
				</View>
			) : (
				<View
					accessibilityRole="tablist"
					style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.line }}
				>
					{tabs.map((item) => {
						const active = item.id === tab;
						return (
							<Pressable
								key={item.id}
								accessibilityRole="tab"
								accessibilityState={{ selected: active }}
								onPress={() => {
									if (!active) haptics.selection();
									setTab(item.id);
								}}
								style={{
									flex: 1,
									minHeight: size.hit,
									alignItems: "center",
									justifyContent: "center",
									borderBottomWidth: 2,
									borderBottomColor: active ? colors.accent : "transparent",
								}}
							>
								<Text variant="callout" color={active ? "accentText" : "ink2"} style={{ fontFamily: fonts.ui[600] }}>
									{item.label}
								</Text>
							</Pressable>
						);
					})}
				</View>
			)}
			{banner}
			{top?.kind === "picker" ? (
				<Animated.View
					key={`picker-${stack.length}`}
					entering={
						reduced ? FadeIn.duration(motion.d1) : (I18nManager.isRTL ? SlideInLeft : SlideInRight).duration(motion.d2)
					}
					style={{ flex: 1, paddingTop: space.s2 }}
				>
					<Picker {...top.spec} onDone={pop} />
				</Animated.View>
			) : (
				<Animated.View
					key={top ? `advanced-${stack.length}` : "root"}
					{...(top
						? {
								entering: reduced
									? FadeIn.duration(motion.d1)
									: (I18nManager.isRTL ? SlideInLeft : SlideInRight).duration(motion.d2),
							}
						: {})}
					style={{ flex: 1 }}
				>
					<KeyboardAwareScrollView
						extraKeyboardSpace={keyboardSpace}
						scrollEnabled={!scrollLocked}
						keyboardShouldPersistTaps="handled"
						contentContainerStyle={{ padding: space.s4, paddingBottom: space.s12 }}
						// The template grid renders only rows near the screen. Steps of SCROLL_STEP keep its re-renders rare;
						// it renders a whole row beyond each edge, which covers the rounding.
						onLayout={(event) => useSheetScroll.setState({ height: event.nativeEvent.layout.height })}
						onScroll={(event) =>
							useSheetScroll.setState({
								offset: Math.floor(event.nativeEvent.contentOffset.y / SCROLL_STEP) * SCROLL_STEP,
							})
						}
					>
						{body()}
					</KeyboardAwareScrollView>
				</Animated.View>
			)}
		</View>
	);

	if (tablet) return <View style={{ flex: 1, backgroundColor: colors.surface }}>{sheet}</View>;

	return (
		<View
			style={{ flex: 1, backgroundColor: colors.sunken }}
			onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
		>
			<View style={{ height: height / 2 + space.s3 }}>
				<ResumePage id={id} draft={pageDraft} focused={nativeEnvironment.focused()} />
				<TemplatePreviewCaption />
			</View>
			{expanded ? (
				<Pressable
					accessibilityRole="button"
					accessibilityLabel={t`Lower the design sheet`}
					onPress={() => {
						setExpanded(false);
						setStack([]);
					}}
					style={{ position: "absolute", top: 0, start: 0, end: 0, bottom: 0, backgroundColor: colors.scrimSheet }}
				/>
			) : null}
			<Animated.View
				layout={LinearTransition.duration(motion.d2).reduceMotion(ReduceMotion.System)}
				accessibilityLabel={t`Design`}
				style={{
					position: "absolute",
					start: 0,
					end: 0,
					bottom: 0,
					height: expanded ? height - space.s3 : height / 2,
					backgroundColor: colors.surface,
					borderTopStartRadius: radius.rLg,
					borderTopEndRadius: radius.rLg,
					boxShadow: shadows.e3.boxShadow,
					overflow: "hidden",
				}}
			>
				{sheet}
			</Animated.View>
		</View>
	);
}
