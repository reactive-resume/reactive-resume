import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import Cookies from "js-cookie";
import z from "zod";

const themeSchema = z.union([z.literal("light"), z.literal("dark"), z.literal("system")]);

/** The appearance the person chose. "system" follows the operating system. */
export type Theme = z.infer<typeof themeSchema>;
/** The appearance actually on screen. */
export type ResolvedTheme = "light" | "dark";

const storageKey = "theme";
const defaultTheme: Theme = "system";

export const systemDarkQuery = "(prefers-color-scheme: dark)";

export const themeMap = {
	light: msg`Light`,
	dark: msg`Dark`,
	system: msg`System`,
} satisfies Record<Theme, MessageDescriptor>;

export function isTheme(theme: string): theme is Theme {
	return themeSchema.safeParse(theme).success;
}

export function resolveTheme(theme: Theme, systemPrefersDark: boolean): ResolvedTheme {
	if (theme === "system") return systemPrefersDark ? "dark" : "light";
	return theme;
}

export const getTheme = () => {
	const theme = Cookies.get(storageKey);
	if (!theme || !isTheme(theme)) return defaultTheme;
	return theme;
};

export const setThemeCookie = (theme: Theme) => {
	Cookies.set(storageKey, theme, { expires: 365, path: "/", sameSite: "lax" });
};
