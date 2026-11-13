// <scheme>://storyboard/<ID>?theme=light|dark[&scroll=end]: hands the request to the capture controller, which
// replaces this route with the scenario's screens. Inert without EXPO_PUBLIC_STORYBOARD=1.
import { useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";
import { useCaptureStore } from "@/dev/storyboard/capture";
import { STORYBOARD } from "@/dev/storyboard/harness";

export default function Storyboard() {
	const { id, theme, scroll } = useLocalSearchParams<{ id: string; theme?: string; scroll?: string }>();
	useEffect(() => {
		if (!STORYBOARD || !id) return;
		useCaptureStore
			.getState()
			.ask({ id, theme: theme === "dark" ? "dark" : "light", scroll: scroll === "end" ? "end" : "top" });
	}, [id, theme, scroll]);
	return <View style={{ flex: 1 }} />;
}
