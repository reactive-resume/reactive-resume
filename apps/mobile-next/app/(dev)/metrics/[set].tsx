import type { ColorToken, TypeToken } from "@/ui/tokens";
// Text-metrics probe (BUILD.md §6.1.3): draws known storyboard texts at their measured positions so their glyphs can
// be compared with the storyboard PNGs (scripts/text-metrics.py). Storyboard and development builds only.
import { useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";
import { Text } from "@/ui/Text";
import { useTheme, useThemeStore } from "@/ui/theme";

type Sample = {
	text: string;
	variant: TypeToken;
	color: ColorToken;
	x: number;
	y: number;
	w?: number;
	weight?: 400 | 500 | 600 | 700;
};

export const sets: Record<string, Sample[]> = {
	"T1-Today": [
		{ text: "Today", variant: "rootTitle", color: "ink", x: 24, y: 58 },
		{ text: "Saturday, 7 November", variant: "ui", color: "ink3", x: 24, y: 101 },
		{ text: "Tuesday 10 Nov · 10:00", variant: "keyLine", color: "ink3", x: 65, y: 166 },
		{ text: "Technical interview at Lumen", variant: "heading", color: "ink", x: 49, y: 196 },
		{
			text: "Your briefing is ready: likely questions, who you'll meet and three stories to tell.",
			variant: "body",
			color: "ink2",
			x: 49,
			y: 236,
			w: 292,
		},
		{ text: "Needs you", variant: "sheetTitle", color: "ink", x: 24, y: 405 },
	],
	"B1-Overview": [
		{ text: "Product designer", variant: "pageTitle", color: "ink", x: 24, y: 107 },
		{ text: "Saved · 1 page · Public", variant: "body", color: "ink3", x: 24, y: 147 },
		{ text: "Sections", variant: "sheetTitle", color: "ink", x: 24, y: 513 },
		{ text: "Basics", variant: "rowTitle", color: "ink", x: 24, y: 557 },
		{ text: "Alex Morgan · Senior product designer", variant: "ui", color: "ink3", x: 24, y: 583 },
		{ text: "Summary", variant: "rowTitle", color: "ink", x: 24, y: 628 },
		{ text: "Experience", variant: "rowTitle", color: "ink", x: 24, y: 699 },
		{ text: "Northwind Labs, Harbour Studio", variant: "ui", color: "ink3", x: 24, y: 725 },
	],
};

export default function Metrics() {
	const { set, theme } = useLocalSearchParams<{ set: string; theme?: string }>();
	const { colors } = useTheme();
	useEffect(() => {
		useThemeStore.getState().setOverride(theme === "dark" ? "dark" : "light");
	}, [theme]);
	return (
		<View style={{ flex: 1, backgroundColor: colors.bg }}>
			{(sets[set] ?? []).map((s) => (
				<Text
					key={s.text}
					variant={s.variant}
					color={s.color}
					{...(s.weight ? { weight: s.weight } : {})}
					style={{ position: "absolute", left: s.x, top: s.y, ...(s.w ? { width: s.w } : {}) }}
				>
					{s.text}
				</Text>
			))}
		</View>
	);
}
