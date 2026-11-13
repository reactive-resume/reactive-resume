// Screen options for the JS stacks (MOTION.md §6.1). Layouts use these; nothing else sets transition options.
import type { StackNavigationOptions } from "expo-router/js-stack";
import { useStackOptions } from "./motion";
import { useThemeName } from "./theme";

/**
 * push: slide from the trailing edge. modal: rise from the bottom. sheet: a transparent route whose design-system
 * BottomSheet or Dialog animates itself. hero: the destination fades in while the Hero overlay carries the element.
 */
export function useScreenOptions() {
	const theme = useThemeName();
	const push = useStackOptions(theme, "push");
	const modal = useStackOptions(theme, "modal");
	const fade = useStackOptions(theme, "fade");
	// Storyboard captures land every transition at once through `timeScale`; overriding `animation` to none for them
	// left the stack's cards inert for the first touch once motion came back.
	const sheet: StackNavigationOptions = {
		headerShown: false,
		presentation: "transparentModal",
		animation: "none",
		cardStyle: { backgroundColor: "transparent" },
		cardOverlayEnabled: false,
		gestureEnabled: false,
	};
	return {
		push,
		modal: { ...modal, presentation: "modal" as const },
		hero: fade,
		sheet,
	};
}
