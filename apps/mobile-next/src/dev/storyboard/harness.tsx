// Reference for the fidelity loop (BUILD.md §8, design/MOTION.md §10). Adapt imports and names to the app.
// Everything here is inert unless the build sets EXPO_PUBLIC_STORYBOARD=1 (a "storyboard" build profile).
//
// How a capture works (tools/rn_capture.mjs drives it):
//   1. The script opens <scheme>://storyboard/<ID>?theme=light (or dark, optionally &scroll=end).
//   2. The route app/(dev)/storyboard/[id].tsx resets navigation, seeds the fakes with the storyboard data, pins the
//      clock, theme and insets, replays the scenario's hrefs (so the real stack, sheets and docks are on screen), and
//      sets timeScale to 0 so every transition lands at once.
//   3. When the screen has settled it measures every design-system text, icon and component registered below and
//      POSTs the layout dump to http://localhost:8799/dump. The script then takes the screenshot.

import React, { createContext, useContext, useEffect, useRef } from "react";
import { Dimensions, Platform, type HostInstance } from "react-native";
import { SafeAreaFrameContext, SafeAreaInsetsContext } from "react-native-safe-area-context";
import { timeScale } from "@/ui/motion";
import { cssName, fonts, type ThemeName } from "@/ui/tokens";

export const STORYBOARD = process.env.EXPO_PUBLIC_STORYBOARD === "1";

/** The storyboard's "now": Saturday 7 November 2026, 09:41. The app's clock module returns this in storyboard mode. */
export const STORYBOARD_NOW = new Date(2026, 10, 7, 9, 41, 0);
/** The storyboard person's home zone (J3 "Berlin time", J8 "Berlin time (CET)"). Pin it with the clock. */
export const STORYBOARD_TIME_ZONE = "Europe/Berlin";
export const STORYBOARD_INSETS = { top: 47, bottom: 34, left: 0, right: 0 };
export const STORYBOARD_FRAME = { x: 0, y: 0, width: 390, height: 844 };
export const CAPTURE_SERVER = "http://localhost:8799"; // Android: adb reverse tcp:8799 tcp:8799 (the script does it)

// -------------------------------------------------------------------------------------------------
// 1. Pinned safe areas. Every screen reads insets through react-native-safe-area-context (useSafeAreaInsets); in
//    storyboard mode these providers override the device's values with the storyboard frame's 47/34.
// -------------------------------------------------------------------------------------------------

export function StoryboardInsets({ children }: { children: React.ReactNode }) {
	if (!STORYBOARD) return <>{children}</>;
	return (
		<SafeAreaFrameContext.Provider value={STORYBOARD_FRAME}>
			<SafeAreaInsetsContext.Provider value={STORYBOARD_INSETS}>{children}</SafeAreaInsetsContext.Provider>
		</SafeAreaFrameContext.Provider>
	);
}

// -------------------------------------------------------------------------------------------------
// 2. Design tags: the design system's Text, Icon and container components register themselves here.
// -------------------------------------------------------------------------------------------------

type Measurable = { measureInWindow(cb: (x: number, y: number, w: number, h: number) => void): void };

export type DesignMeta =
	/** `style` is the RN text style actually applied (from reference/tokens.ts `type`); `color` the token key. */
	| { kind: "text"; text: string; style: { fontFamily: string; fontSize: number; lineHeight: number }; color: string }
	| { kind: "icon"; icon: string; size: number; color: string }
	/** Text inside a page fixture image (the page is a render, not app text): reported by position only. */
	| { kind: "paper"; text: string }
	| { kind: "component"; component: string; radius?: number; bg?: string };

type Entry = {
	ref: React.RefObject<Measurable | null>;
	meta: DesignMeta;
	screenKey: string | undefined;
	hidden: boolean;
};

const registry = new Map<number, Entry>();
let nextId = 1;

const ScreenKeyContext = createContext<string | undefined>(undefined);
const presentations = new Map<string, "screen" | "sheet" | "modal">();

/**
 * Wrap each screen's root (the design system's <Screen> primitive does this). routeKey is React Navigation's
 * route.key; presentation 'sheet' means the screen underneath stays visible and belongs in the dump.
 */
export function DesignScreen({
	routeKey,
	presentation = "screen",
	children,
}: {
	routeKey: string;
	presentation?: "screen" | "sheet" | "modal";
	children: React.ReactNode;
}) {
	useEffect(() => {
		if (!STORYBOARD) return;
		presentations.set(routeKey, presentation);
		return () => {
			presentations.delete(routeKey);
		};
	}, [routeKey, presentation]);
	return <ScreenKeyContext.Provider value={routeKey}>{children}</ScreenKeyContext.Provider>;
}

/**
 * Attach to the outer host view of a design-system element:
 *   const ref = useDesignTag<View>({ kind: 'component', component: 'HeroCard', radius: radius.xl, bg: 'surface' });
 *   return <View ref={ref} ...>
 * Pass hidden: true while the element is visually hidden (opacity 0, e.g. the collapsed bar title before scroll).
 */
export function useDesignTag(meta: DesignMeta, opts: { hidden?: boolean } = {}) {
	const ref = useRef<HostInstance | null>(null);
	const screenKey = useContext(ScreenKeyContext);
	const id = useRef(0);
	useEffect(() => {
		if (!STORYBOARD) return;
		if (!id.current) id.current = nextId++;
		registry.set(id.current, { ref, meta, screenKey, hidden: !!opts.hidden });
	});
	useEffect(
		() => () => {
			registry.delete(id.current);
		},
		[],
	);
	return ref;
}

// -------------------------------------------------------------------------------------------------
// 3. Which routes are on screen: the focused chain, plus whatever sits under a sheet.
// -------------------------------------------------------------------------------------------------

type NavState = { index?: number; routes: { key: string; state?: NavState }[] };

export function visibleRouteKeys(root: NavState | undefined): Set<string> {
	const keys = new Set<string>();
	const walk = (s: NavState | undefined) => {
		if (!s || !s.routes.length) return;
		let i = s.index ?? s.routes.length - 1;
		let route = s.routes[i];
		if (!route) return;
		walkRoute(route);
		// a sheet (or several stacked) shows the route beneath it
		while (i > 0 && route && presentations.get(route.key) === "sheet") {
			i -= 1;
			route = s.routes[i];
			if (route) walkRoute(route);
		}
	};
	const walkRoute = (r: { key: string; state?: NavState }) => {
		keys.add(r.key);
		walk(r.state);
	};
	walk(root);
	return keys;
}

// -------------------------------------------------------------------------------------------------
// 4. The dump, in the format tools/layout_compare.py reads.
// -------------------------------------------------------------------------------------------------

const familyOf = (fontFamily: string): { family: string; weight: number } => {
	switch (fontFamily) {
		case fonts.ui400:
			return { family: "Figtree", weight: 400 };
		case fonts.ui500:
			return { family: "Figtree", weight: 500 };
		case fonts.ui600:
			return { family: "Figtree", weight: 600 };
		case fonts.ui700:
			return { family: "Figtree", weight: 700 };
		case fonts.display:
			return { family: "Instrument Serif", weight: 400 };
		case fonts.mono:
			return { family: "Geist Mono", weight: 500 }; // the boards set mono at 500; the shipped face is Regular
		default:
			return { family: fontFamily, weight: 400 };
	}
};

const r1 = (v: number) => Math.round(v * 10) / 10;

export async function collectDump(navState: NavState | undefined) {
	const visible = visibleRouteKeys(navState);
	const entries = [...registry.values()].filter((e) => !e.hidden && (!e.screenKey || visible.has(e.screenKey)));
	const measured = await Promise.all(
		entries.map(
			(e) =>
				new Promise<Record<string, unknown> | null>((resolve) => {
					const node = e.ref.current;
					if (!node) return resolve(null);
					node.measureInWindow((x, y, w, h) => {
						if (!w && !h) return resolve(null); // detached or not laid out
						const box = { x: r1(x), y: r1(y), w: r1(w), h: r1(h) };
						const m = e.meta;
						if (m.kind === "text") {
							const f = familyOf(m.style.fontFamily);
							resolve({
								text: m.text,
								...box,
								style: {
									family: f.family,
									weight: f.weight,
									size: m.style.fontSize,
									lineHeight: m.style.lineHeight,
									color: cssName(m.color),
								},
							});
						} else if (m.kind === "paper") {
							resolve({ text: m.text, ...box });
						} else if (m.kind === "icon") {
							resolve({ icon: m.icon, ...box, style: { color: cssName(m.color) } });
						} else {
							const out: Record<string, unknown> = { component: m.component, ...box };
							if (m.radius != null) out.radius = Math.min(m.radius, w / 2, h / 2); // pills report their real radius
							if (m.bg) out.bg = cssName(m.bg);
							resolve(out);
						}
					});
				}),
		),
	);
	const elements = measured.filter((m): m is Record<string, unknown> => m !== null);
	// reading order, like the storyboard dumps
	elements.sort((a, b) => (a.y as number) - (b.y as number) || (a.x as number) - (b.x as number));
	return { elements, window: Dimensions.get("window"), platform: Platform.OS };
}

// -------------------------------------------------------------------------------------------------
// 5. Settling: wait until fonts, images, queries and layout are done, then two more frames.
// -------------------------------------------------------------------------------------------------

let pendingImages = 0;
/** Spread onto storyboard-backed images: <Image {...trackImage()} />. */
export function trackImage() {
	return {
		onLoadStart: () => {
			pendingImages += 1;
		},
		onLoadEnd: () => {
			pendingImages = Math.max(0, pendingImages - 1);
		},
	};
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function settle(isBusy: () => boolean, timeoutMs = 15000) {
	const until = Date.now() + timeoutMs;
	while (Date.now() < until && (pendingImages > 0 || isBusy())) await sleep(50);
	// InteractionManager is deprecated in recent React Native; an idle callback does the same job here.
	await new Promise<void>((r) =>
		typeof requestIdleCallback === "function" ? requestIdleCallback(() => r(), { timeout: 1000 }) : setTimeout(r, 100),
	);
	await frame();
	await frame();
	await sleep(250); // native layout of the last commit; transitions are instant (timeScale 0)
}

// -------------------------------------------------------------------------------------------------
// 6. Scenarios and the capture route
// -------------------------------------------------------------------------------------------------

/**
 * One entry per storyboard screen: the hrefs to replay (in order, so the real stack is built), the fixture to seed,
 * and anything to do before measuring. Keep this table in the app (src/dev/storyboard/scenarios.ts) and fill it for all
 * 67 IDs in screens/manifest.json. Examples:
 */
export type Scenario = {
	hrefs: string[];
	fixture?: string;
	prepare?: () => void | Promise<void>;
};
export const exampleScenarios: Record<string, Scenario> = {
	"T1-Today": { hrefs: ["/"] },
	"T2-FirstRun": { hrefs: ["/"], fixture: "empty-account" },
	"D2-Actions": { hrefs: ["/documents", "/documents/res_product_designer/actions"] },
	"J2-Board": { hrefs: ["/applications?view=board"] },
	"B16-Assistant": {
		hrefs: ["/documents", "/builder/res_product_designer", "/assistant?context=resume:res_product_designer"],
	},
};

/**
 * The body of app/(dev)/storyboard/[id].tsx, as a hook. `deps` are the app's own pieces:
 *   reset(): navigation reset to an empty root;  push(href): router.push;  seed(fixture): fill the fakes;
 *   setTheme(theme): the app's theme override;  setNow(date): the app's clock;  navState(): root navigation state;
 *   isBusy(): queries or mutations in flight;  scrollToEnd(): the focused screen's main scroll view, unanimated.
 */
export function useStoryboardCapture(
	id: string,
	theme: ThemeName,
	scroll: "top" | "end",
	deps: {
		scenarios: Record<string, Scenario>;
		reset: () => void;
		push: (href: string) => void;
		seed: (fixture: string) => Promise<void> | void;
		setTheme: (t: ThemeName) => void;
		setNow: (d: Date) => void;
		navState: () => NavState | undefined;
		isBusy: () => boolean;
		scrollToEnd: () => void;
	},
) {
	useEffect(() => {
		if (!STORYBOARD) return;
		let cancelled = false;
		(async () => {
			const s = deps.scenarios[id];
			if (!s) throw new Error(`No storyboard scenario for ${id}`);
			timeScale.value = 0;
			deps.setNow(STORYBOARD_NOW);
			deps.setTheme(theme);
			await deps.seed(s.fixture ?? "storyboard");
			deps.reset();
			for (const href of s.hrefs) {
				deps.push(href);
				await frame();
			}
			await s.prepare?.();
			await settle(deps.isBusy);
			if (scroll === "end") {
				deps.scrollToEnd();
				await settle(deps.isBusy);
			}
			if (cancelled) return;
			const dump = await collectDump(deps.navState());
			await fetch(`${CAPTURE_SERVER}/dump`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ id, theme, scroll, ...dump }),
			});
		})().catch((err) => {
			fetch(`${CAPTURE_SERVER}/error`, {
				method: "POST",
				body: JSON.stringify({ id, theme, error: String(err) }),
			}).catch(() => {});
		});
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [id, theme, scroll]);
}

// Also in storyboard mode (wire these where the app owns them):
// - TextInput: caretHidden; ScrollView/FlatList: showsVerticalScrollIndicator={false} only while capturing.
// - LogBox.ignoreAllLogs(true) so warnings never cover the dock.
// - Spinners render their first frame and do not turn (timeScale 0 stops them).
// - The page renderer, template thumbnails and the B5 photo return design/fixtures/*.png (via require), tracked with
//   trackImage(). page-resume-full.png already contains B18's Check marker: don't draw the marker over it.
// - The status bar style still follows the theme (it is outside the comparison: --system-bars).
