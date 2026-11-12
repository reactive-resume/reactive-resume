import { useColorScheme } from "react-native";
import { create } from "zustand";
import { colors, shadows, type ThemeName } from "./tokens";

export type ThemePreference = "system" | "light" | "dark";

type ThemeState = {
	preference: ThemePreference;
	/** Storyboard captures and the motion lab pin a theme regardless of the preference. */
	override: ThemeName | null;
	setPreference: (preference: ThemePreference) => void;
	setOverride: (override: ThemeName | null) => void;
};

export const useThemeStore = create<ThemeState>((set) => ({
	preference: "system",
	override: null,
	setPreference: (preference) => set({ preference }),
	setOverride: (override) => set({ override }),
}));

export function useThemeName(): ThemeName {
	const system = useColorScheme();
	const preference = useThemeStore((s) => s.preference);
	const override = useThemeStore((s) => s.override);
	if (override) return override;
	if (preference !== "system") return preference;
	return system === "dark" ? "dark" : "light";
}

export function useTheme() {
	const name = useThemeName();
	return { name, colors: colors[name], shadows: shadows[name] };
}
