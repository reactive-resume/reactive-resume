import type { ExpoConfig } from "expo/config";

// The successor to apps/mobile: same identifiers, so the production variant replaces it in place. The development
// and storyboard variants carry a suffix and install beside it.
const host = "rxresu.me";
const microphonePermission = "Reactive Resume records your answers when you practise for an interview.";

type Variant = "development" | "storyboard" | "production";
const variant = (process.env.APP_VARIANT ?? "development") as Variant;
const suffix = variant === "production" ? "" : variant === "storyboard" ? ".storyboard" : ".dev";
const id = `me.rxresu${suffix}`;
const storyboard = variant === "storyboard";

const config: ExpoConfig = {
	name: variant === "production" ? "Reactive Resume" : variant === "storyboard" ? "RR Storyboard" : "RR Dev",
	slug: "reactive-resume",
	platforms: ["ios", "android"],
	scheme: id,
	owner: "reactive-resume",
	version: "2.0.0",
	icon: "./assets/icon.png",
	orientation: "default",
	userInterfaceStyle: "automatic",
	ios: {
		buildNumber: process.env.MOBILE_BUILD_NUMBER ?? "1",
		icon: { light: "./assets/icon.png", dark: "./assets/icon-dark.png" },
		bundleIdentifier: id,
		appleTeamId: "654ASRW868",
		deploymentTarget: "17.4",
		supportsTablet: true,
		infoPlist: {
			CADisableMinimumFrameDurationOnPhone: true,
			// The storyboard build posts layout dumps to the capture script on localhost.
			...(storyboard ? { NSAppTransportSecurity: { NSAllowsLocalNetworking: true } } : {}),
		},
		config: { usesNonExemptEncryption: false },
		associatedDomains: variant === "production" ? [`applinks:${host}`, `webcredentials:${host}`] : [],
	},
	android: {
		versionCode: Number(process.env.MOBILE_BUILD_NUMBER ?? "1"),
		package: id,
		predictiveBackGestureEnabled: false,
		adaptiveIcon: {
			foregroundImage: "./assets/adaptive-foreground.png",
			backgroundImage: "./assets/adaptive-background.png",
			monochromeImage: "./assets/adaptive-monochrome.png",
			backgroundColor: "#337344",
		},
		blockedPermissions: [
			"android.permission.SYSTEM_ALERT_WINDOW",
			"android.permission.READ_EXTERNAL_STORAGE",
			"android.permission.READ_MEDIA_IMAGES",
			"android.permission.READ_MEDIA_VIDEO",
			"android.permission.READ_MEDIA_AUDIO",
			"android.permission.FOREGROUND_SERVICE",
			"android.permission.WAKE_LOCK",
			"com.google.android.c2dm.permission.RECEIVE",
		],
		intentFilters:
			variant === "production"
				? [
						{
							action: "VIEW",
							autoVerify: true,
							category: ["BROWSABLE", "DEFAULT"],
							data: [
								{ scheme: "https", host, path: "/auth/native-callback" },
								{ scheme: "https", host, pathPrefix: "/builder/" },
							],
						},
					]
				: [],
	},
	plugins: [
		"expo-router",
		"expo-dev-client",
		"expo-font",
		"expo-asset",
		"expo-image",
		"expo-sqlite",
		["expo-secure-store", { faceIDPermission: false }],
		"expo-web-browser",
		"expo-localization",
		"expo-document-picker",
		"expo-file-system",
		[
			"expo-sharing",
			{
				ios: { enabled: true, activationRule: { supportsText: true, supportsWebUrlWithMaxCount: 1 } },
				android: { enabled: true, singleShareMimeTypes: ["text/plain"], multipleShareMimeTypes: [] },
			},
		],
		"expo-system-ui",
		"expo-status-bar",
		[
			"expo-splash-screen",
			{
				image: "./assets/splash-icon.png",
				imageWidth: 160,
				backgroundColor: "#F8F7F3",
				dark: { image: "./assets/splash-icon-dark.png", backgroundColor: "#100F0C" },
			},
		],
		[
			"expo-image-picker",
			{
				photosPermission: "Reactive Resume uses your photos to set the picture on your resume.",
				cameraPermission: "Reactive Resume uses your camera to take a profile photo.",
				microphonePermission,
			},
		],
		[
			"expo-audio",
			{
				microphonePermission,
				recordAudioAndroid: true,
				enableBackgroundPlayback: false,
				enableBackgroundRecording: false,
			},
		],
		["expo-notifications", { enableRemoteNotifications: false, enableBackgroundRemoteNotifications: false }],
		"@react-native-community/datetimepicker",
		["expo-build-properties", { android: { usesCleartextTraffic: storyboard } }],
	],
	extra: { variant },
};

export default config;
