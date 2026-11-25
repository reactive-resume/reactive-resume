import type { ThemeName } from "@/ui/tokens";
// Opens one storyboard scenario: pin theme and clock, seed the fakes, replay the scenario's hrefs so the real stack,
// sheets and docks are on screen, settle, then show the `storyboard-ready` marker the Maestro flows wait for.
// Mounted once in the root layout; inert unless EXPO_PUBLIC_STORYBOARD=1.
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { LogBox, Platform, View } from "react-native";
import { create } from "zustand";
import { resetImageTracking, STORYBOARD, STORYBOARD_NOW, settle } from "./harness";
import { scenarios } from "./scenarios";
import { timeScale } from "@/ui/motion";
import { useThemeStore } from "@/ui/theme";

type Request = { id: string; theme: ThemeName; nonce: number };

export const useScenarioStore = create<{
	request: Request | null;
	/** The request whose motion is back: Maestro flows wait for `storyboard-ready` before they touch anything. */
	ready: number | null;
	ask: (r: Omit<Request, "nonce">) => void;
}>((set) => ({
	request: null,
	ready: null,
	ask: (r) => set({ request: { ...r, nonce: Date.now() } }),
}));

const setReady = (nonce: number) => useScenarioStore.setState({ ready: nonce });

/** The data layer and screens register what the controller needs from them. */
export type StoryboardDeps = {
	seed: (fixture: string) => Promise<void> | void;
	setNow: (date: Date) => void;
	isBusy: () => boolean;
};
const deps: StoryboardDeps = { seed: () => {}, setNow: () => {}, isBusy: () => false };
export function registerStoryboardDeps(next: Partial<StoryboardDeps>) {
	Object.assign(deps, next);
}

/** Thrown by a scenario run that a newer request replaced; never reported. */
const SUPERSEDED = new Error("superseded");

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export function StoryboardController() {
	const router = useRouter();
	const request = useScenarioStore((s) => s.request);
	const queryClient = useQueryClient();
	const ready = useScenarioStore((s) => s.ready);

	useEffect(() => {
		if (STORYBOARD) LogBox.ignoreAllLogs(true);
	}, []);

	useEffect(() => {
		if (!STORYBOARD || !request) return;
		const { id, theme } = request;
		// Busy while the fakes answer or any query or mutation is in flight (a page render, a scenario's refetch).
		const busy = () => deps.isBusy() || queryClient.isFetching() > 0 || queryClient.isMutating() > 0;
		// A newer request stops this run at its next step, so a slow scenario never keeps navigating beside the next one.
		const superseded = () => useScenarioStore.getState().request?.nonce !== request.nonce;
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
			timeScale.value = 1;
			setReady(request.nonce);
		})().catch((error) => {
			if (error === SUPERSEDED) return;
			console.warn(`Storyboard scenario ${id} failed`, error);
			timeScale.value = 1;
			setReady(request.nonce);
		});
	}, [request, router, queryClient]);

	if (!STORYBOARD || !request || ready !== request.nonce) return null;
	return (
		<View
			testID="storyboard-ready"
			accessible
			accessibilityLabel="Storyboard ready"
			pointerEvents="none"
			// Maestro's Android driver drops elements under the status bar, so the marker sits below it there.
			style={{ position: "absolute", top: Platform.OS === "android" ? "50%" : 0, left: 0, width: 1, height: 1 }}
		/>
	);
}
