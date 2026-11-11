// Screen options for the JS stacks (MOTION.md §6.1). Layouts use these; nothing else sets transition options.
import type { StackNavigationOptions } from "expo-router/js-stack";
import { useStackOptions } from "./motion";
import { useThemeName } from "./theme";
import { useCaptureStore } from "@/dev/storyboard/capture";
import { STORYBOARD } from "@/dev/storyboard/harness";

/**
 * push: slide from the trailing edge. modal: rise from the bottom. sheet: a transparent route whose design-system
 * BottomSheet or Dialog animates itself. hero: the destination fades in while the Hero overlay carries the element.
 */
export function useScreenOptions() {
	const theme = useThemeName();
	const push = useStackOptions(theme, "push");
	const modal = useStackOptions(theme, "modal");
	const fade = useStackOptions(theme, "fade");
	// Storyboard captures land every transition at once; once `storyboard-ready` shows, motion runs as shipped.
	const capturing = useCaptureStore((s) => STORYBOARD && s.request !== null && s.ready !== s.request.nonce);
	const still: StackNavigationOptions = capturing ? { animation: "none" } : {};
	const sheet: StackNavigationOptions = {
		headerShown: false,
		presentation: "transparentModal",
		animation: "none",
		cardStyle: { backgroundColor: "transparent" },
		cardOverlayEnabled: false,
		gestureEnabled: false,
	};
	return {
		push: { ...push, ...still },
		modal: { ...modal, presentation: "modal" as const, ...still },
		hero: { ...fade, ...still },
		sheet,
	};
}
