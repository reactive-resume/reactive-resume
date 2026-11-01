import type { DefaultTheme } from "expo-router";
import { I18nProvider } from "@lingui/react";
import { useLingui } from "@lingui/react/macro";
import { TrueSheetProvider } from "@lodev09/react-native-true-sheet";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { Observe, ObserveErrorBoundary, ObserveRoot } from "expo-observe";
import { Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { followStageWrites } from "@reactive-resume/schema/applications/stage-baselines";
import { restoreSession } from "@/auth/session";
import { SessionGate } from "@/auth/session-gate";
import { IncomingPosting } from "@/features/applications/incoming-posting";
import { stageScope } from "@/features/applications/queries";
import { listedApplication } from "@/features/applications/stage-actions";
import { useOpenReminder } from "@/features/reminders/open";
import { useReviewPrompt } from "@/features/reviews/use-review-prompt";
import { i18n, initI18n } from "@/i18n";
import { EmptyState, Screen, Toaster, WindowSafeAreaProvider, useReducedMotion, useTheme } from "@/ui";
import { fontAssets } from "@/ui/fonts";
import { initTheme } from "@/ui/theme";

// One configure call: each call replaces the whole config, and it must run before any screen mounts.
// The OAuth callback carries `code` and `state`; `server` can name a private self-hosted instance.
Observe.configure({ integrations: { "expo-router": { filteredParams: ["code", "state", "token", "server"] } } });

void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();
// A bulk move chosen while a single stage change is on its way starts from what that change saved.
followStageWrites(queryClient, stageScope, (id) => listedApplication(queryClient, id));

function useNavigationTheme() {
	const { scheme, colors, fonts } = useTheme();
	return {
		dark: scheme === "dark",
		colors: {
			primary: colors.accent,
			background: colors.bg,
			card: colors.surface,
			text: colors.ink,
			border: colors.line,
			notification: colors.danger,
		},
		fonts: {
			regular: { fontFamily: fonts.ui[400], fontWeight: "400" as const },
			medium: { fontFamily: fonts.ui[500], fontWeight: "500" as const },
			bold: { fontFamily: fonts.ui[600], fontWeight: "600" as const },
			heavy: { fontFamily: fonts.ui[700], fontWeight: "700" as const },
		},
	} satisfies typeof DefaultTheme;
}

type CrashScreenProps = { onRetry: () => void };

function CrashScreen({ onRetry }: CrashScreenProps) {
	const { t } = useLingui();
	return (
		<Screen scroll={false} edges={["top", "bottom"]} contentStyle={{ flex: 1, justifyContent: "center" }}>
			<EmptyState
				icon="warning-circle"
				title={t`This screen stopped working`}
				message={t`Try again, or restart the app.`}
				action={{ label: t`Try again`, onPress: onRetry }}
			/>
		</Screen>
	);
}

function RootStack() {
	const { t } = useLingui();
	const navigationTheme = useNavigationTheme();
	const reduced = useReducedMotion();
	useOpenReminder();
	useReviewPrompt();

	return (
		<ThemeProvider value={navigationTheme}>
			<StatusBar style="auto" />
			<Stack
				screenOptions={{
					animation: reduced ? "fade" : "default",
					headerTitleStyle: { fontFamily: navigationTheme.fonts.bold.fontFamily },
				}}
			>
				<Stack.Screen name="(tabs)" options={{ headerShown: false }} />
				<Stack.Screen name="(auth)" options={{ headerShown: false }} />
				<Stack.Screen name="builder/[id]" options={{ headerShown: false, title: t`Resume` }} />
				<Stack.Screen name="letter/[id]" options={{ headerShown: false, title: t`Cover letter` }} />
				<Stack.Screen
					name="new"
					options={{ presentation: "formSheet", sheetAllowedDetents: [0.5, 0.9], title: t`New` }}
				/>
				<Stack.Screen name="search" options={{ presentation: "modal", headerShown: false, title: t`Search` }} />
				<Stack.Screen name="ats-checker" options={{ title: t`ATS checker` }} />
				<Stack.Screen name="applications/[id]" options={{ headerShown: false, title: t`Application` }} />
				<Stack.Screen name="r/[username]/[slug]" options={{ title: t`Resume` }} />
			</Stack>
		</ThemeProvider>
	);
}

function RootLayout() {
	const [fontsLoaded, fontError] = useFonts(fontAssets);
	const [ready, setReady] = useState(false);

	useEffect(() => {
		initTheme();
		void Promise.all([initI18n(), restoreSession()]).finally(() => setReady(true));
	}, []);

	const loaded = ready && (fontsLoaded || !!fontError);

	useEffect(() => {
		if (loaded) void SplashScreen.hideAsync();
	}, [loaded]);

	if (!loaded) return null;

	return (
		<GestureHandlerRootView style={{ flex: 1 }}>
			<SafeAreaProvider>
				<WindowSafeAreaProvider>
					<KeyboardProvider>
						<QueryClientProvider client={queryClient}>
							<I18nProvider i18n={i18n}>
								<TrueSheetProvider>
									<ObserveErrorBoundary fallback={({ resetError }) => <CrashScreen onRetry={resetError} />}>
										<RootStack />
										<SessionGate />
										<IncomingPosting />
									</ObserveErrorBoundary>
									<Toaster />
								</TrueSheetProvider>
							</I18nProvider>
						</QueryClientProvider>
					</KeyboardProvider>
				</WindowSafeAreaProvider>
			</SafeAreaProvider>
		</GestureHandlerRootView>
	);
}

export default ObserveRoot.wrap(RootLayout);
