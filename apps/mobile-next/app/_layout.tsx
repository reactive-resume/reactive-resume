import "@/polyfills";
import { I18nProvider } from "@lingui/react";
import { useFonts } from "expo-font";
import { Stack } from "expo-router/js-stack";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { restoreSession } from "@/auth/session";
import { DataProvider, isBusy, seed } from "@/data";
import { setNow } from "@/data/clock";
import { registerStoryboardDeps, StoryboardController } from "@/dev/storyboard/capture";
import { StoryboardInsets } from "@/dev/storyboard/harness";
import { i18n, initI18n } from "@/i18n";
import { DevHost } from "@/ui/DevMenu";
import { HeroOverlay } from "@/ui/Hero";
import { useScreenOptions } from "@/ui/navigation";
import { useTheme } from "@/ui/theme";
import { ToastHost } from "@/ui/Toast";
import { fonts } from "@/ui/tokens";

registerStoryboardDeps({ seed: (fixture) => seed(fixture as "storyboard" | "empty-account"), setNow, isBusy });

export default function RootLayout() {
	const [ready, setReady] = useState(false);
	useEffect(() => {
		void Promise.all([initI18n(), restoreSession()]).finally(() => setReady(true));
	}, []);
	const [loaded] = useFonts({
		[fonts.ui400]: require("../assets/fonts/Figtree-Regular.ttf"),
		[fonts.ui500]: require("../assets/fonts/Figtree-Medium.ttf"),
		[fonts.ui600]: require("../assets/fonts/Figtree-SemiBold.ttf"),
		[fonts.ui700]: require("../assets/fonts/Figtree-Bold.ttf"),
		[fonts.display]: require("../assets/fonts/InstrumentSerif-Regular.ttf"),
		[fonts.mono]: require("../assets/fonts/GeistMono-Regular.ttf"),
	});
	const { name, colors } = useTheme();
	const options = useScreenOptions();
	if (!loaded || !ready) return null;
	return (
		<GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
			<SafeAreaProvider>
				<StoryboardInsets>
					<KeyboardProvider>
						<StatusBar style={name === "dark" ? "light" : "dark"} />
						<I18nProvider i18n={i18n}>
							<DataProvider>
								<Stack screenOptions={options.push} />
								<ToastHost />
								<HeroOverlay />
								<DevHost />
								<StoryboardController />
							</DataProvider>
						</I18nProvider>
					</KeyboardProvider>
				</StoryboardInsets>
			</SafeAreaProvider>
		</GestureHandlerRootView>
	);
}
