import type { ResolvedTheme, Theme } from "@/libs/theme";
import type { PropsWithChildren } from "react";
import { useRouter } from "@tanstack/react-router";
import { createContext, use, useEffect, useSyncExternalStore } from "react";
import { resolveTheme, setThemeCookie, systemDarkQuery } from "@/libs/theme";

type ThemeContextValue = {
	/** The chosen appearance, including "system". */
	theme: Theme;
	/** What's on screen right now. */
	resolvedTheme: ResolvedTheme;
	setTheme: (value: Theme, options?: { playSound?: boolean }) => void;
	toggleTheme: (options?: { playSound?: boolean }) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const subscribeToSystemTheme = (onChange: () => void) => {
	const query = window.matchMedia(systemDarkQuery);
	query.addEventListener("change", onChange);
	return () => query.removeEventListener("change", onChange);
};
const systemPrefersDark = () => window.matchMedia(systemDarkQuery).matches;

// Swap the theme class with transitions suppressed for one frame, so every color changes at once
// instead of each element easing between palettes on its own schedule.
function applyThemeClass(theme: ResolvedTheme) {
	const root = document.documentElement;
	const isDark = theme === "dark";
	if (root.classList.contains("dark") === isDark) return;

	const style = document.createElement("style");
	style.textContent = "*,*::before,*::after{transition:none!important}";
	document.head.append(style);

	root.classList.toggle("dark", isDark);
	void window.getComputedStyle(root).color; // force a style flush while transitions are off
	setTimeout(() => style.remove(), 1); // rAF would never fire in a hidden tab, leaving transitions off
}

type Props = PropsWithChildren<{ theme: Theme }>;

export function ThemeProvider({ children, theme }: Props) {
	const router = useRouter();
	const prefersDark = useSyncExternalStore(subscribeToSystemTheme, systemPrefersDark, () => false);
	const resolvedTheme = resolveTheme(theme, prefersDark);

	useEffect(() => {
		applyThemeClass(resolvedTheme);
	}, [resolvedTheme]);

	async function setTheme(value: Theme, options: { playSound?: boolean } = {}) {
		const { playSound = true } = options;
		const next = resolveTheme(value, systemPrefersDark());

		applyThemeClass(next);
		setThemeCookie(value);
		void router.invalidate();

		if (!playSound) return;

		const soundClip = next === "dark" ? "/sounds/switch-off.mp3" : "/sounds/switch-on.mp3";
		try {
			const audio = new Audio(soundClip);
			await audio.play();
		} catch {
			// ignore errors
		}
	}

	function toggleTheme(options: { playSound?: boolean } = {}) {
		void setTheme(resolvedTheme === "dark" ? "light" : "dark", options);
	}

	return <ThemeContext value={{ theme, resolvedTheme, setTheme, toggleTheme }}>{children}</ThemeContext>;
}

export function useTheme() {
	const value = use(ThemeContext);

	if (!value) throw new Error("useTheme must be used within a ThemeProvider");

	return value;
}
