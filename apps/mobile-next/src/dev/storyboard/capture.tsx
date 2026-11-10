import type { ThemeName } from "@/ui/tokens";
// Runs one storyboard capture (BUILD.md §8.1): pin theme and clock, seed the fakes, replay the scenario's hrefs so
// the real stack, sheets and docks are on screen, settle, measure, and post the dump to tools/rn_capture.mjs.
// Mounted once in the root layout; inert unless EXPO_PUBLIC_STORYBOARD=1.
import { useNavigationContainerRef, useRouter } from "expo-router";
import { useEffect } from "react";
import { LogBox } from "react-native";
import { create } from "zustand";
import { CAPTURE_SERVER, collectDump, STORYBOARD, STORYBOARD_NOW, settle } from "./harness";
import { scenarios } from "./scenarios";
import { timeScale } from "@/ui/motion";
import { useThemeStore } from "@/ui/theme";

type Request = { id: string; theme: ThemeName; scroll: "top" | "end"; nonce: number };

export const useCaptureStore = create<{ request: Request | null; ask: (r: Omit<Request, "nonce">) => void }>((set) => ({
	request: null,
	ask: (r) => set({ request: { ...r, nonce: Date.now() } }),
}));

/** The data layer and screens register what the harness needs from them. */
export type StoryboardDeps = {
	seed: (fixture: string) => Promise<void> | void;
	setNow: (date: Date) => void;
	isBusy: () => boolean;
};
const deps: StoryboardDeps = { seed: () => {}, setNow: () => {}, isBusy: () => false };
export function registerStoryboardDeps(next: Partial<StoryboardDeps>) {
	Object.assign(deps, next);
}

/** The focused screen's main scroll view registers a way to jump to its end (for `--scroll end` captures). */
let scrollToEnd: (() => void) | null = null;
export function registerMainScroll(fn: (() => void) | null) {
	scrollToEnd = fn;
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export function StoryboardController() {
	const router = useRouter();
	const navigation = useNavigationContainerRef();
	const request = useCaptureStore((s) => s.request);

	useEffect(() => {
		if (STORYBOARD) LogBox.ignoreAllLogs(true);
	}, []);

	useEffect(() => {
		if (!STORYBOARD || !request) return;
		const { id, theme, scroll } = request;
		(async () => {
			const scenario = scenarios[id];
			if (!scenario) throw new Error(`No storyboard scenario for ${id}`);
			timeScale.value = 0;
			deps.setNow(STORYBOARD_NOW);
			useThemeStore.getState().setOverride(theme);
			await deps.seed(scenario.fixture ?? "storyboard");
			const [first, ...rest] = scenario.hrefs;
			if (router.canDismiss()) router.dismissAll();
			router.replace((first ?? "/") as never);
			await frame();
			for (const href of rest) {
				router.push(href as never);
				await frame();
			}
			await scenario.prepare?.();
			await settle(deps.isBusy);
			if (scroll === "end") {
				scrollToEnd?.();
				await settle(deps.isBusy);
			}
			const dump = await collectDump(navigation.getRootState() as never);
			await fetch(`${CAPTURE_SERVER}/dump`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ id, theme, scroll, ...dump }),
			});
		})().catch((error) => {
			fetch(`${CAPTURE_SERVER}/error`, {
				method: "POST",
				body: JSON.stringify({ id, theme, error: String(error) }),
			}).catch(() => {});
		});
	}, [request, router, navigation]);

	return null;
}
