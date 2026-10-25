import type { Style } from "../../forme/style-types";

export type TemplatePlacement = "main" | "sidebar";

export type StyleInput = Style | Style[] | null | undefined;

export const composeStyles = (...styles: StyleInput[]): Style[] => {
	return styles.flatMap((style) => {
		if (!style) return [];
		if (Array.isArray(style)) return style.filter(Boolean);

		return [style];
	});
};

export const mergeStyles = (...styles: StyleInput[]): Style => Object.assign({}, ...composeStyles(...styles));

export const headerNameLineHeight = 1.3;

type ResolvePlacementColorOptions = {
	placement: TemplatePlacement;
	defaultForeground: string;
	sidebarForeground?: string | undefined;
};

export const resolvePlacementColor = ({
	placement,
	defaultForeground,
	sidebarForeground,
}: ResolvePlacementColorOptions) => {
	if (placement === "sidebar" && sidebarForeground) return sidebarForeground;

	return defaultForeground;
};
