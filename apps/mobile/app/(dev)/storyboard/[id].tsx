// <scheme>://storyboard/<ID>?theme=light|dark: hands the request to the storyboard controller, which replaces this
// route with the scenario's screens. Inert without EXPO_PUBLIC_STORYBOARD=1.
import { useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";
import { useScenarioStore } from "@/dev/storyboard/controller";
import { STORYBOARD } from "@/dev/storyboard/harness";

export default function Storyboard() {
	const { id, theme } = useLocalSearchParams<{ id: string; theme?: string }>();
	useEffect(() => {
		if (!STORYBOARD || !id) return;
		useScenarioStore.getState().ask({ id, theme: theme === "dark" ? "dark" : "light" });
	}, [id, theme]);
	return <View style={{ flex: 1 }} />;
}
