import { create } from "zustand/react";

const storageKey = "character-shortcuts";
const readEnabled = () => {
	try {
		return localStorage.getItem(storageKey) !== "off";
	} catch {
		return true;
	}
};

type ShortcutSettings = { characterShortcuts: boolean; setCharacterShortcuts: (enabled: boolean) => void };

export const useShortcutSettings = create<ShortcutSettings>((set) => ({
	characterShortcuts: readEnabled(),
	setCharacterShortcuts: (enabled) => {
		set({ characterShortcuts: enabled });
		try {
			localStorage.setItem(storageKey, enabled ? "on" : "off");
		} catch {
			// Storage may be unavailable; the setting still applies for this session.
		}
	},
}));
