import type { PropsWithChildren } from "react";
import type { Theme } from "@/libs/theme";
import { useRouter } from "@tanstack/react-router";
import { createContext, use, useEffect } from "react";
import { setThemeCookie } from "@/libs/theme";

type ThemeContextValue = {
	theme: Theme;
	setTheme: (value: Theme, options?: { playSound?: boolean }) => void;
	toggleTheme: (options?: { playSound?: boolean }) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

// Swap the theme class with transitions suppressed for one frame, so every color changes at once
// instead of each element easing between palettes on its own schedule.
function applyThemeClass(theme: Theme) {
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

	useEffect(() => {
		applyThemeClass(theme);
	}, [theme]);

	async function setTheme(value: Theme, options: { playSound?: boolean } = {}) {
		const { playSound = true } = options;

		applyThemeClass(value);
		setThemeCookie(value);
		void router.invalidate();

		if (!playSound) return;

		try {
			const soundClip = value === "dark" ? "/sounds/switch-off.mp3" : "/sounds/switch-on.mp3";
			const audio = new Audio(soundClip);
			await audio.play();
		} catch {
			// ignore errors
		}
	}

	function toggleTheme(options: { playSound?: boolean } = {}) {
		void setTheme(theme === "dark" ? "light" : "dark", options);
	}

	return <ThemeContext value={{ theme, setTheme, toggleTheme }}>{children}</ThemeContext>;
}

export function useTheme() {
	const value = use(ThemeContext);

	if (!value) throw new Error("useTheme must be used within a ThemeProvider");

	return value;
}
