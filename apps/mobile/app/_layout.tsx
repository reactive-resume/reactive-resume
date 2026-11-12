import "@/polyfills";
import { I18nProvider } from "@lingui/react";
import { useFonts } from "expo-font";
import { DefaultTheme, ThemeProvider } from "expo-router";
import { Stack } from "expo-router/js-stack";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { restoreSession } from "@/auth/session";
import { DataProvider, isBusy, seed } from "@/data";
import { setNow } from "@/data/clock";
import { registerStoryboardDeps, StoryboardController } from "@/dev/storyboard/capture";
import { StoryboardInsets } from "@/dev/storyboard/harness";
import { registerFirstSend } from "@/features/settings/first-send";
import { TodayNotifications } from "@/features/system/notifications";
import { i18n, initI18n } from "@/i18n";
import { DevHost } from "@/ui/DevMenu";
import { HeroOverlay } from "@/ui/Hero";
import { useScreenOptions } from "@/ui/navigation";
import { useTheme } from "@/ui/theme";
import { ToastHost } from "@/ui/Toast";
import { fonts } from "@/ui/tokens";

registerStoryboardDeps({ seed: (fixture) => seed(fixture as "storyboard" | "empty-account"), setNow, isBusy });
// S7: the first time a kind of data goes to an AI connection, ask before sending.
registerFirstSend();

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
	// Navigators paint their own background behind screens (visible under transparent sheet routes): use the token.
	const navigationTheme = useMemo(
		() => ({
			...DefaultTheme,
			dark: name === "dark",
			colors: {
				...DefaultTheme.colors,
				background: colors.bg,
				card: colors.bg,
				text: colors.ink,
				border: colors.line,
				primary: colors.accent,
			},
		}),
		[name, colors],
	);
	if (!loaded || !ready) return null;
	return (
		<GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
			<SafeAreaProvider>
				<StoryboardInsets>
					<KeyboardProvider>
						<StatusBar style={name === "dark" ? "light" : "dark"} />
						<I18nProvider i18n={i18n}>
							<DataProvider>
								<ThemeProvider value={navigationTheme}>
									<Stack screenOptions={options.push}>
										{/* The storyboard link only hands its request to the capture controller, which replaces this route
										at once. Animating it in left the stack mid-transition when a link opened it in a running app, and
										every touch after that was ignored. */}
										<Stack.Screen name="(dev)/storyboard/[id]" options={{ animation: "none" }} />
									</Stack>
								</ThemeProvider>
								<ToastHost />
								<TodayNotifications />
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
