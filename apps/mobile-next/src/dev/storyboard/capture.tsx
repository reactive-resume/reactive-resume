import type { ThemeName } from "@/ui/tokens";
// Runs one storyboard capture (BUILD.md §8.1): pin theme and clock, seed the fakes, replay the scenario's hrefs so
// the real stack, sheets and docks are on screen, settle, measure, and post the dump to tools/rn_capture.mjs.
// Mounted once in the root layout; inert unless EXPO_PUBLIC_STORYBOARD=1.
import { useQueryClient } from "@tanstack/react-query";
import { useNavigationContainerRef, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { LogBox, View } from "react-native";
import { create } from "zustand";
import { CAPTURE_SERVER, collectDump, resetImageTracking, STORYBOARD, STORYBOARD_NOW, settle } from "./harness";
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

/**
 * The capture script listens on 8799; with one capture per simulator each uses its own port (scripts/capture-port.mjs).
 * The dump goes to all of them: a capture only accepts the screen and theme it is waiting for.
 */
const servers = [0, 1, 2, 3].map((n) => CAPTURE_SERVER.replace(/:\d+$/, `:${8799 + n}`));
// A port held by something else may never answer; after 2 s the dump counts as sent, so motion always comes back.
const post = (path: string, body: string, json: boolean) =>
	Promise.race([
		Promise.allSettled(
			servers.map((server) =>
				fetch(`${server}${path}`, {
					method: "POST",
					...(json ? { headers: { "content-type": "application/json" } } : {}),
					body,
				}),
			),
		),
		new Promise<void>((resolve) => setTimeout(resolve, 2000)),
	]);

/** Thrown by a capture run that a newer request replaced; never reported. */
const SUPERSEDED = new Error("superseded");

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export function StoryboardController() {
	const router = useRouter();
	const navigation = useNavigationContainerRef();
	const request = useCaptureStore((s) => s.request);
	const queryClient = useQueryClient();
	// The request whose motion is back: Maestro flows wait for `storyboard-ready` before they touch anything.
	const [ready, setReady] = useState<number | null>(null);

	useEffect(() => {
		if (STORYBOARD) LogBox.ignoreAllLogs(true);
	}, []);

	useEffect(() => {
		if (!STORYBOARD || !request) return;
		const { id, theme, scroll } = request;
		// Busy while the fakes answer or any query or mutation is in flight (a page render, a scenario's refetch).
		const busy = () => deps.isBusy() || queryClient.isFetching() > 0 || queryClient.isMutating() > 0;
		// A newer request (the script gave up on this one, or moved on) stops this run at its next step, so a slow
		// capture never keeps navigating and measuring beside the next one.
		const superseded = () => useCaptureStore.getState().request?.nonce !== request.nonce;
		const step = async <T,>(work: Promise<T> | T) => {
			const value = await work;
			if (superseded()) throw SUPERSEDED;
			return value;
		};
		(async () => {
			const scenario = scenarios[id];
			if (!scenario) throw new Error(`No storyboard scenario for ${id}`);
			resetImageTracking();
			timeScale.value = 0;
			// The shared value reaches the UI thread a frame later: on a cold start the first screen's entrance would still
			// read 1 and run at full length. Wait for it to land before anything mounts.
			await step(frame());
			await step(frame());
			await step(new Promise<void>((resolve) => setTimeout(resolve, 60)));
			deps.setNow(STORYBOARD_NOW);
			useThemeStore.getState().setOverride(theme);
			await step(deps.seed(scenario.fixture ?? "storyboard"));
			const [first, ...rest] = scenario.hrefs;
			if (router.canDismiss()) router.dismissAll();
			router.replace((first ?? "/") as never);
			await step(frame());
			for (const href of rest) {
				router.push(href as never);
				await step(frame());
			}
			await step(scenario.prepare?.());
			await step(settle(busy));
			if (scroll === "end") {
				scrollToEnd?.();
				await step(settle(busy));
			}
			// Measure until two dumps in a row agree with nothing in flight: anything still moving (an entrance that began
			// before the time scale reached zero, a sheet settling) has then landed, and a query a screen started late
			// has answered.
			let dump = await step(collectDump(navigation.getRootState() as never));
			for (let attempt = 0; attempt < 20; attempt += 1) {
				await step(new Promise<void>((resolve) => setTimeout(resolve, 150)));
				if (busy()) {
					await step(settle(busy));
					dump = await step(collectDump(navigation.getRootState() as never));
					continue;
				}
				const next = await step(collectDump(navigation.getRootState() as never));
				const same = JSON.stringify(next.elements) === JSON.stringify(dump.elements);
				dump = next;
				if (same) break;
			}
			await post("/dump", JSON.stringify({ id, theme, scroll, ...dump }), true);
			// Give the capture script time to take its screenshot, then let motion run again for hand checks.
			setTimeout(() => {
				if (useCaptureStore.getState().request?.nonce !== request.nonce) return;
				timeScale.value = 1;
				setReady(request.nonce);
			}, 4000);
		})().catch((error) => {
			if (error === SUPERSEDED) return;
			void post("/error", JSON.stringify({ id, theme, error: String(error) }), false);
			timeScale.value = 1;
			setReady(request.nonce);
		});
	}, [request, router, navigation, queryClient]);

	if (!STORYBOARD || !request || ready !== request.nonce) return null;
	return (
		<View
			testID="storyboard-ready"
			accessible
			accessibilityLabel="Storyboard ready"
			pointerEvents="none"
			style={{ position: "absolute", top: 0, left: 0, width: 1, height: 1 }}
		/>
	);
}
