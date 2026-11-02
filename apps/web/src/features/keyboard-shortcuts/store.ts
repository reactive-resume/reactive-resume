import type { HotkeyRegistrationView } from "@tanstack/react-hotkeys";
import { getHotkeyManager, toHotkeyRegistrationView } from "@tanstack/react-hotkeys";
import { create } from "zustand/react";

type ShortcutHelpState = {
	shortcuts: HotkeyRegistrationView[] | null;
	opener: HTMLElement | null;
	close: () => void;
};

export const useShortcutHelp = create<ShortcutHelpState>((set) => ({
	shortcuts: null,
	opener: null,
	close: () => set({ shortcuts: null }),
}));

/** Capture the command owner's current context before the help dialog suspends it. */
export function showKeyboardShortcuts(opener?: HTMLElement | null) {
	const manager = getHotkeyManager();
	useShortcutHelp.setState({
		shortcuts: [...manager.registrations.state.values()]
			.map(toHotkeyRegistrationView)
			.filter((registration) => registration.status === "active" && registration.options.meta?.name),
		opener: opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null),
	});
}
