import type { HotkeyRegistrationView } from "@tanstack/react-hotkeys";
import { getHotkeyManager, toHotkeyRegistrationView } from "@tanstack/react-hotkeys";
import { useEffect } from "react";
import { create } from "zustand/react";

type ShortcutHelpState = {
	shortcuts: HotkeyRegistrationView[] | null;
	opener: HTMLElement | null;
	/** The page the list was opened on ("Applications"), when that page names itself. */
	page: string | null;
	close: () => void;
};

export const useShortcutHelp = create<ShortcutHelpState>((set) => ({
	shortcuts: null,
	opener: null,
	page: null,
	close: () => set({ shortcuts: null }),
}));

/** Names the page in the list's title ("Shortcuts on Applications") while the page is mounted. */
export function useShortcutsPage(name: string) {
	useEffect(() => {
		useShortcutHelp.setState({ page: name });
		return () => {
			if (useShortcutHelp.getState().page === name) useShortcutHelp.setState({ page: null });
		};
	}, [name]);
}

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
