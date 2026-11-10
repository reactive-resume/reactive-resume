// Motion lab (MOTION.md §10.4): one scene per lab in design/motion-probes.json, light theme, a magenta marker on the
// moving part (cyan for a second one) and nothing else in those colours. With ?run=1 it runs the animation once,
// 600 ms after it appears, through the same components and motion functions the app uses.
//   <scheme>://motion-lab/<lab>?run=1   (recorded by tools/rn_capture.mjs record, measured by tools/motion_probe.py)
// "push-b" and "modal-b" are the pushed and presented screens of the push, pop and modal labs.
import { i18n } from "@lingui/core";
import { router, useIsFocused, useLocalSearchParams } from "expo-router";
import { Stack } from "expo-router/js-stack";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { runOnUI, scrollTo, useAnimatedRef, useSharedValue } from "react-native-reanimated";
import { create } from "zustand";
import { BottomSheet, type BottomSheetHandle } from "@/ui/BottomSheet";
import { CollapsedBar, useTitleCollapse } from "@/ui/CollapsingHeader";
import { Dialog } from "@/ui/Dialog";
import { Dock, type DockItemSpec } from "@/ui/Dock";
import { foldOut, layoutShift } from "@/ui/Fold";
import { HapticOverlay } from "@/ui/HapticOverlay";
import { HeroOverlay, HeroSource, HeroTarget, prepareHero } from "@/ui/Hero";
import { Menu, MenuItem } from "@/ui/Menu";
import {
	FadeThroughProvider,
	FadeThroughScene,
	pressDown,
	pressUp,
	timeScale,
	Touchable,
	useFadeUp,
	useStackOptions,
	withInstantOpen,
} from "@/ui/motion";
import { ReorderList, type ReorderHandle } from "@/ui/ReorderList";
import { Segmented } from "@/ui/Segmented";
import { Switch, toggleValue } from "@/ui/Switch";
import { Text } from "@/ui/Text";
import { useTheme, useThemeStore } from "@/ui/theme";
import { ToastHost, showToast, useToastOffset } from "@/ui/Toast";
import { motion } from "@/ui/tokens";

// The two marker colours, allowed only in this file.
const MAGENTA = "#FF00FF";
const CYAN = "#00FFFF";
const RUN_DELAY = 600;
const MARK = 24;

// The lab runs before the app's i18n may be set up (a cold deep link).
if (!i18n.locale) i18n.loadAndActivate({ locale: "en", messages: {} });

/** Bumped when the lab restores timeScale, so pushed screens rebuild their stack options. */
const useEpoch = create<{ n: number; bump: () => void }>((set) => ({ n: 0, bump: () => set((s) => ({ n: s.n + 1 })) }));

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Land a setup at once (timeScale 0), then restore normal speed. */
async function instantly(setup: () => void) {
	timeScale.value = 0;
	setup();
	await frame();
	await frame();
	await sleep(100);
	timeScale.value = 1;
	useEpoch.getState().bump();
}

/** Runs `go` once, 600 ms after the scene appears, when ?run=1. */
function useRun(run: boolean, go: () => void | Promise<void>, before?: () => Promise<void>) {
	useEffect(() => {
		let live = true;
		if (!run) return;
		(async () => {
			await before?.();
			await sleep(RUN_DELAY);
			if (live) await go();
		})();
		return () => {
			live = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
}

export default function MotionLab() {
	const { lab = "", run } = useLocalSearchParams<{ lab: string; run?: string }>();
	const setOverride = useThemeStore((s) => s.setOverride);
	useEffect(() => {
		setOverride("light");
		timeScale.value = 1;
		return () => setOverride(null);
	}, [setOverride]);
	const go = run === "1";
	const focused = useIsFocused();
	const Scene = scenes[lab];
	return (
		// A deep link to another lab (or the same lab with ?run=1) re-uses this screen with new params: a new key
		// starts a new run over identical still content.
		<Frame key={`${lab}:${go}`} lab={lab}>
			{Scene ? <Scene run={go} /> : <Text variant="body">{`Unknown lab ${lab}`}</Text>}
			{/* Until the root layout mounts these hosts (lead); only the focused lab draws them. */}
			{focused && (
				<>
					<ToastHost />
					<HeroOverlay />
					<HapticOverlay />
				</>
			)}
		</Frame>
	);
}

/**
 * Recordings run back to back on a warm app. A lab arrives without a transition (its own open spec is 0 ms; screens
 * pushed over it keep their timing). Once its recording is over it draws the next lab's still scene, so the next
 * deep link remounts identical content and that recording starts still (the probes count a marker appearing as
 * motion).
 */
const useRuns = create<{ active: number; cleared: boolean }>(() => ({ active: 0, cleared: false }));
let runs = 0;
/** After its recording: rn_capture records 5 s from the deep link; the next recording starts about 1.2 s later. */
const CLEAR_AFTER = 4900;
/** The order rn_capture records the labs in (first appearance in design/motion-probes.json). */
const ORDER = [
	"press",
	"push",
	"pop",
	"modal",
	"sheet",
	"sheet-close",
	"sheet-release",
	"tab",
	"segment",
	"switch",
	"toast",
	"toast-fuse",
	"dialog",
	"menu",
	"row-fold",
	"reorder",
	"title",
	"page-hero",
];

function Frame({ lab, children }: { lab: string; children: ReactNode }) {
	const { colors } = useTheme();
	useEpoch((s) => s.n);
	const pushed = lab.endsWith("-b");
	const [run] = useState(() => (pushed ? useRuns.getState().active : ++runs));
	const visible = useRuns((s) => s.active === run && !s.cleared);
	const cleared = useRuns((s) => s.active === run && s.cleared);
	const nextLab = ORDER[ORDER.indexOf(lab) + 1];
	const Next = nextLab ? scenes[nextLab] : undefined;
	useEffect(() => {
		if (pushed) return;
		useRuns.setState({ active: run, cleared: false });
		const id = setTimeout(() => {
			if (useRuns.getState().active === run) useRuns.setState({ cleared: true });
		}, CLEAR_AFTER);
		return () => clearTimeout(id);
	}, [pushed, run]);
	const base = useStackOptions("light", lab === "modal-b" ? "modal" : "push");
	const options = pushed ? base : withInstantOpen(base);
	return (
		<View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}>
			<Stack.Screen options={options} />
			{visible ? children : cleared && Next ? <Next run={false} /> : null}
		</View>
	);
}

const Mark = ({ x, y, color = MAGENTA, size = MARK }: { x: number; y: number; color?: string; size?: number }) => (
	<View
		pointerEvents="none"
		style={{ position: "absolute", left: x, top: y, width: size, height: size, backgroundColor: color }}
	/>
);

type SceneProps = { run: boolean };

// ---------------------------------------------------------------------------------------------------------------

function Press({ run }: SceneProps) {
	const pressed = useSharedValue(0);
	useRun(run, async () => {
		pressDown(pressed);
		await sleep(RUN_DELAY);
		pressUp(pressed);
	});
	return (
		<View style={{ position: "absolute", left: 24, top: 372 }}>
			<Touchable
				theme="light"
				pressedValue={pressed}
				onPress={() => {}}
				radius={12}
				style={{ width: 342, height: 56, borderRadius: 12, backgroundColor: MAGENTA }}
			/>
		</View>
	);
}

function PushA({ run }: SceneProps) {
	useRun(run, () => router.push("/motion-lab/push-b"));
	return <Mark x={188} y={300} color={CYAN} />;
}

function PushB() {
	return <Mark x={12} y={300} />;
}

function Pop({ run }: SceneProps) {
	useRun(
		run,
		() => router.back(),
		() => instantly(() => router.push("/motion-lab/push-b")),
	);
	return <Mark x={188} y={300} color={CYAN} />;
}

function ModalA({ run }: SceneProps) {
	useRun(run, () => router.push("/motion-lab/modal-b"));
	return null;
}

function ModalB() {
	return <Mark x={183} y={120} />;
}

function SheetScene({ run, mode }: SceneProps & { mode: "rise" | "close" | "release" }) {
	// close and release start from an open sheet: it mounts with every duration at 0 (set before the sheet's own
	// effects run), then normal speed returns.
	const [open, setOpen] = useState(() => {
		if (mode !== "rise") timeScale.value = 0;
		return mode !== "rise";
	});
	const ref = useRef<BottomSheetHandle>(null);
	useEffect(() => {
		if (mode !== "rise") instantly(() => {});
	}, [mode]);
	useRun(run, () => {
		if (mode === "rise") setOpen(true);
		else if (mode === "close") ref.current?.close();
		else {
			ref.current?.drag(188);
			ref.current?.release(0);
		}
	});
	if (!open) return null;
	return (
		<BottomSheet
			ref={ref}
			title="New"
			height={470}
			onClose={() => setOpen(false)}
			labMarker={{ scrim: CYAN, top: MAGENTA }}
		>
			<View />
		</BottomSheet>
	);
}

const tabs: DockItemSpec[] = [
	{ key: "today", label: "Today", icon: "house-simple" },
	{ key: "documents", label: "Documents", icon: "files" },
	{ key: "applications", label: "Applications", icon: "briefcase" },
	{ key: "career", label: "Career", icon: "compass" },
];

function Tab({ run }: SceneProps) {
	return (
		<FadeThroughProvider>
			<TabInner run={run} />
		</FadeThroughProvider>
	);
}

function TabInner({ run }: SceneProps) {
	const [tab, setTab] = useState("today");
	const dock = useRef<{ select: (key: string) => void }>(null);
	useRun(run, () => dock.current?.select("documents"));
	return (
		<View style={StyleSheet.absoluteFill}>
			{tabs.map((t) => (
				<View key={t.key} style={StyleSheet.absoluteFill} pointerEvents={t.key === tab ? "auto" : "none"}>
					<FadeThroughScene focused={t.key === tab}>
						{t.key === "today" ? <Block color={MAGENTA} /> : t.key === "documents" ? <Block color={CYAN} /> : null}
					</FadeThroughScene>
				</View>
			))}
			<View style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
				<Dock ref={dock} variant="tabs" items={tabs} selected={tab} onNavigate={setTab} />
			</View>
		</View>
	);
}

const Block = ({ color }: { color: string }) => (
	<View style={{ position: "absolute", left: 24, top: 300, width: 342, height: 120, backgroundColor: color }} />
);

function Segment({ run }: SceneProps) {
	const [value, setValue] = useState<"list" | "board" | "calendar">("list");
	useRun(run, () => setValue("board"));
	return (
		<View style={{ position: "absolute", top: 200, left: 24, right: 24 }}>
			<Segmented
				labMarker={MAGENTA}
				value={value}
				onChange={setValue}
				options={[
					{ key: "list", label: "List" },
					{ key: "board", label: "Board" },
					{ key: "calendar", label: "Calendar" },
				]}
			/>
		</View>
	);
}

function SwitchScene({ run }: SceneProps) {
	const [on, setOn] = useState(false);
	useRun(run, () => toggleValue(false, setOn));
	return (
		<View style={{ position: "absolute", left: 175, top: 400 }}>
			<Switch value={on} onValueChange={setOn} labMarker={MAGENTA} accessibilityLabel="Publish" />
		</View>
	);
}

function ToastScene({ run, fuse }: SceneProps & { fuse: boolean }) {
	useToastOffset(44); // the scene's settled bottom edge: y 788
	useRun(run, () => {
		showToast(
			fuse
				? {
						message: "Moved to Trash",
						action: { label: "Undo", onPress: () => {} },
						lifetime: 1500,
						labMarker: { fuse: MAGENTA, fuseHeight: 8, height: 48 },
					}
				: {
						message: "Moved to Trash",
						action: { label: "Undo", onPress: () => {} },
						labMarker: { fill: MAGENTA, hideText: true, height: 48 },
					},
		);
	});
	return null;
}

function DialogScene({ run }: SceneProps) {
	const [open, setOpen] = useState(false);
	useRun(run, () => setOpen(true));
	return (
		<Dialog
			open={open}
			labMarker={MAGENTA}
			title="Sign out with unsynced work?"
			message="2 changes haven't reached the server yet. Signing out now discards them."
			actions={[
				{ label: "Keep working", tone: "primary", onPress: () => {} },
				{ label: "Export a copy first", tone: "secondary", onPress: () => {} },
				{ label: "Sign out and discard", tone: "ghostDanger", onPress: () => {} },
			]}
		/>
	);
}

function MenuScene({ run }: SceneProps) {
	const [open, setOpen] = useState(false);
	useRun(run, () => setOpen(true));
	const anchor = { x: 322, y: 156, width: 44, height: 44 };
	return (
		<>
			<View
				style={{
					position: "absolute",
					left: anchor.x,
					top: anchor.y,
					width: 44,
					height: 44,
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				<Text variant="rowTitle">···</Text>
			</View>
			<Menu open={open} onClose={() => setOpen(false)} anchor={anchor} height={160} width={200} labMarker={MAGENTA}>
				<MenuItem label="Rename" onPress={() => {}} />
				<MenuItem label="Duplicate" onPress={() => {}} />
				<MenuItem label="Move to Trash" onPress={() => {}} />
			</Menu>
		</>
	);
}

function RowFold({ run }: SceneProps) {
	const [rows, setRows] = useState(["a", "b", "c"]);
	useRun(run, () => setRows(["a", "c"]));
	return (
		<View style={{ position: "absolute", top: 300, left: 0, right: 0 }}>
			{rows.map((r) => (
				<Animated.View
					key={r}
					exiting={foldOut}
					layout={layoutShift}
					style={{ height: 64, overflow: "hidden", backgroundColor: r === "b" ? MAGENTA : undefined }}
				>
					<View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 24 }}>
						{r === "c" ? (
							<View style={{ width: MARK, height: MARK, backgroundColor: CYAN }} />
						) : (
							<Text variant="rowTitle">{`Row ${r}`}</Text>
						)}
					</View>
				</Animated.View>
			))}
		</View>
	);
}

const sections = ["Experience", "Education", "Skills", "Projects", "Languages"];

function Reorder({ run }: SceneProps) {
	const [order, setOrder] = useState(sections);
	const ref = useRef<ReorderHandle>(null);
	useRun(run, async () => {
		ref.current?.lift("Experience");
		await sleep(400);
		ref.current?.dragBy("Experience", 64);
		await sleep(600);
		ref.current?.drop("Experience");
	});
	return (
		<View style={{ position: "absolute", top: 200, left: 0, right: 0 }}>
			<ReorderList
				ref={ref}
				data={order}
				keyOf={(s) => s}
				itemHeight={64}
				label={(s) => s}
				onReorder={(from, to) =>
					setOrder((o) => {
						const next = [...o];
						const [m] = next.splice(from, 1);
						if (m) next.splice(to, 0, m);
						return next;
					})
				}
				renderItem={(s) => (
					<View
						style={{
							flex: 1,
							justifyContent: "center",
							paddingHorizontal: 24,
							backgroundColor: s === "Experience" ? MAGENTA : undefined,
						}}
					>
						{s === "Education" ? (
							<View style={{ width: MARK, height: MARK, backgroundColor: CYAN }} />
						) : (
							<Text variant="rowTitle">{s}</Text>
						)}
					</View>
				)}
			/>
		</View>
	);
}

function Title({ run }: SceneProps) {
	const collapse = useTitleCollapse();
	const scroll = useAnimatedRef<Animated.ScrollView>();
	useRun(run, () =>
		runOnUI(() => {
			"worklet";
			scrollTo(scroll, 0, 60, false);
		})(),
	);
	return (
		<>
			<Animated.ScrollView
				ref={scroll}
				onScroll={collapse.onScroll}
				scrollEventThrottle={16}
				contentContainerStyle={{ paddingTop: 47 + 8, paddingBottom: 1200 }}
			>
				<View style={{ paddingHorizontal: 24 }}>
					<Text variant="rootTitle">Today</Text>
					<Text variant="ui" color="ink3">
						Saturday, 7 November
					</Text>
				</View>
			</Animated.ScrollView>
			<CollapsedBar collapse={collapse} title="Today" labMarker={MAGENTA} />
		</>
	);
}

function PageHero({ run }: SceneProps) {
	const { colors } = useTheme();
	const [dest, setDest] = useState(false);
	useRun(run, async () => {
		if (await prepareHero("lab-page", (size) => <View style={{ ...size, backgroundColor: MAGENTA }} />)) setDest(true);
	});
	// The destination screen fades in without sliding, as stackOptions 'fade' does.
	const destStyle = useFadeUp({ px: 0, ms: motion.d3, start: dest });
	return (
		<>
			<View
				style={{
					position: "absolute",
					top: 160,
					left: 0,
					right: 0,
					paddingVertical: 24,
					alignItems: "center",
					backgroundColor: colors.sunken,
				}}
			>
				<HeroSource id="lab-page">
					<View style={{ width: 170, height: 240, backgroundColor: MAGENTA }} />
				</HeroSource>
			</View>
			{dest && (
				<Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.sunken }, destStyle]}>
					<View style={{ position: "absolute", top: 119, left: 16 }}>
						<HeroTarget id="lab-page">
							<View style={{ width: 358, height: 506, backgroundColor: MAGENTA }} />
						</HeroTarget>
					</View>
				</Animated.View>
			)}
		</>
	);
}

const scenes: Record<string, (p: SceneProps) => ReactNode> = {
	press: Press,
	push: PushA,
	"push-b": PushB,
	pop: Pop,
	modal: ModalA,
	"modal-b": ModalB,
	sheet: (p) => <SheetScene {...p} mode="rise" />,
	"sheet-close": (p) => <SheetScene {...p} mode="close" />,
	"sheet-release": (p) => <SheetScene {...p} mode="release" />,
	tab: Tab,
	segment: Segment,
	switch: SwitchScene,
	toast: (p) => <ToastScene {...p} fuse={false} />,
	"toast-fuse": (p) => <ToastScene {...p} fuse />,
	dialog: DialogScene,
	menu: MenuScene,
	"row-fold": RowFold,
	reorder: Reorder,
	title: Title,
	"page-hero": PageHero,
};
