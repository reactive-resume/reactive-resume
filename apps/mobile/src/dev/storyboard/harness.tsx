// Storyboard mode: fake data, a pinned clock, theme and safe areas, and scenarios that open a screen in a known state
// for the Maestro flows (<scheme>://storyboard/<ID>?theme=light|dark, handled by StoryboardController in controller.tsx).
// Everything here is inert unless the build sets EXPO_PUBLIC_STORYBOARD=1 (the "storyboard" variant).

import type React from "react";
import { SafeAreaFrameContext, SafeAreaInsetsContext } from "react-native-safe-area-context";

export const STORYBOARD = process.env.EXPO_PUBLIC_STORYBOARD === "1";

/** The storyboard's "now": Saturday 7 November 2026, 09:41. The app's clock module returns this in storyboard mode. */
export const STORYBOARD_NOW = new Date(2026, 10, 7, 9, 41, 0);
/** The storyboard person's home zone (J3 "Berlin time", J8 "Berlin time (CET)"). Pin it with the clock. */
export const STORYBOARD_TIME_ZONE = "Europe/Berlin";
export const STORYBOARD_INSETS = { top: 47, bottom: 34, left: 0, right: 0 };
export const STORYBOARD_FRAME = { x: 0, y: 0, width: 390, height: 844 };

/**
 * Pinned safe areas. Every screen reads insets through react-native-safe-area-context (useSafeAreaInsets); in
 * storyboard mode these providers override the device's values with the storyboard frame's 47/34.
 */
export function StoryboardInsets({ children }: { children: React.ReactNode }) {
	if (!STORYBOARD) return <>{children}</>;
	return (
		<SafeAreaFrameContext.Provider value={STORYBOARD_FRAME}>
			<SafeAreaInsetsContext.Provider value={STORYBOARD_INSETS}>{children}</SafeAreaInsetsContext.Provider>
		</SafeAreaFrameContext.Provider>
	);
}

// -------------------------------------------------------------------------------------------------
// Settling: wait until images, queries and layout are done, then two more frames.
// -------------------------------------------------------------------------------------------------

let pendingImages = 0;
let imageGeneration = 0;
/**
 * Each scenario counts its own image loads. An image that unmounts mid-load (a screen replaced by the next scenario)
 * may never fire onLoadEnd; its count would stay above 0 for good and every later scenario would wait out settle's
 * timeout.
 */
export function resetImageTracking() {
	pendingImages = 0;
	imageGeneration += 1;
}
/** Spread onto storyboard-backed images: <Image {...trackImage()} />. */
export function trackImage() {
	const generation = imageGeneration;
	return {
		onLoadStart: () => {
			if (generation === imageGeneration) pendingImages += 1;
		},
		// No clamp at 0: iOS fires onLoadEnd before onLoadStart for cached images, and a clamp left the count at 1 for
		// good, so every later scenario waited out settle's timeout.
		onLoadEnd: () => {
			if (generation === imageGeneration) pendingImages -= 1;
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

/**
 * One entry per storyboard screen (src/dev/storyboard/scenarios.ts): the hrefs to replay (in order, so the real stack
 * is built), the fixture to seed, and anything to do before the screen counts as ready.
 */
export type Scenario = {
	hrefs: string[];
	fixture?: string;
	prepare?: () => void | Promise<void>;
};
