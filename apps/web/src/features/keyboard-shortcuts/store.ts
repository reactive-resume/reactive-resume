import type { HotkeyRegistrationView } from "@tanstack/react-hotkeys";
import { getHotkeyManager, toHotkeyRegistrationView } from "@tanstack/react-hotkeys";
import { useEffect } from "react";
import { create } from "zustand/react";

type ShortcutHelpState = {
	shortcuts: HotkeyRegistrationView[] | null;
	opener: HTMLElement | null;
	/** The page the list was opened on ("Applications"), when that page names itself. */
	page: string | null;
	/** A line about the page ("The resume editor."), for pages that describe themselves instead of naming. */
	description: string | null;
	close: () => void;
};

export const useShortcutHelp = create<ShortcutHelpState>((set) => ({
	shortcuts: null,
	opener: null,
	page: null,
	description: null,
	close: () => set({ shortcuts: null }),
}));

/**
 * While the page is mounted, names it in the list's title ("Shortcuts on Applications"), or, with `name` null,
 * describes it under the generic title ("The resume editor.").
 */
export function useShortcutsPage(name: string | null, description: string | null = null) {
	useEffect(() => {
		useShortcutHelp.setState({ page: name, description });
		return () => {
			const current = useShortcutHelp.getState();
			if (current.page === name && current.description === description)
				useShortcutHelp.setState({ page: null, description: null });
		};
	}, [name, description]);
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
