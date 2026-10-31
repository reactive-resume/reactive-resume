import type { ExpoConfig } from "expo/config";

// The official host. Universal Links, App Links and the OAuth callback (`/auth/native-callback`) verify against it.
const host = "rxresu.me";
const microphonePermission = "Reactive Resume records your answers when you practise for an interview.";

const config: ExpoConfig = {
	name: "Reactive Resume",
	slug: "reactive-resume",
	platforms: process.env.EXPO_MOBILE_WEB_PREVIEW === "1" ? ["ios", "android", "web"] : ["ios", "android"],
	scheme: "me.rxresu",
	owner: "reactive-resume",
	version: "1.0.0",
	runtimeVersion: { policy: "fingerprint" },
	updates: {
		url: "https://u.expo.dev/5830280e-e1ba-45b7-b9c9-ba048fa3bd4d",
		requestHeaders: { "expo-channel-name": process.env.MOBILE_UPDATE_CHANNEL ?? "production" },
		checkAutomatically: "ON_LOAD",
		fallbackToCacheTimeout: 0,
	},
	icon: "./assets/icon.png",
	orientation: "default",
	userInterfaceStyle: "automatic",
	ios: {
		buildNumber: process.env.MOBILE_BUILD_NUMBER ?? "1",
		icon: {
			light: "./assets/icon.png",
			dark: "./assets/icon-dark.png",
		},
		bundleIdentifier: "me.rxresu",
		appleTeamId: "654ASRW868",
		deploymentTarget: "17.4",
		supportsTablet: true,
		infoPlist: { CADisableMinimumFrameDurationOnPhone: true },
		config: { usesNonExemptEncryption: false },
		privacyManifests: {
			NSPrivacyTracking: false,
			NSPrivacyTrackingDomains: [],
			NSPrivacyAccessedAPITypes: [
				{
					NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults",
					NSPrivacyAccessedAPITypeReasons: ["CA92.1", "1C8F.1"],
				},
				{
					NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryFileTimestamp",
					NSPrivacyAccessedAPITypeReasons: ["C617.1", "3B52.1", "0A2A.1"],
				},
				{
					NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategorySystemBootTime",
					NSPrivacyAccessedAPITypeReasons: ["35F9.1"],
				},
				{
					NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryDiskSpace",
					NSPrivacyAccessedAPITypeReasons: ["E174.1", "85F4.1"],
				},
			],
		},
		// `webcredentials` lets ASWebAuthenticationSession complete the https callback (iOS 17.4+).
		associatedDomains: [`applinks:${host}`, `webcredentials:${host}`],
	},
	android: {
		versionCode: Number(process.env.MOBILE_BUILD_NUMBER ?? "1"),
		package: "me.rxresu",
		predictiveBackGestureEnabled: false,
		adaptiveIcon: {
			foregroundImage: "./assets/adaptive-foreground.png",
			backgroundImage: "./assets/adaptive-background.png",
			monochromeImage: "./assets/adaptive-monochrome.png",
			backgroundColor: "#337344",
		},
		// Legacy camera capture needs WRITE_EXTERNAL_STORAGE; dependencies cap it at API 32. Keep read access blocked.
		blockedPermissions: [
			"android.permission.SYSTEM_ALERT_WINDOW",
			"android.permission.READ_EXTERNAL_STORAGE",
			"android.permission.READ_MEDIA_IMAGES",
			"android.permission.READ_MEDIA_VIDEO",
			"android.permission.READ_MEDIA_AUDIO",
			"android.permission.FOREGROUND_SERVICE",
			"android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
			"android.permission.FOREGROUND_SERVICE_MICROPHONE",
			// expo-notifications bundles Firebase and vendor badge helpers; app uses neither push nor badge counts.
			"android.permission.WAKE_LOCK",
			"com.google.android.c2dm.permission.RECEIVE",
			"com.sec.android.provider.badge.permission.READ",
			"com.sec.android.provider.badge.permission.WRITE",
			"com.htc.launcher.permission.READ_SETTINGS",
			"com.htc.launcher.permission.UPDATE_SHORTCUT",
			"com.sonyericsson.home.permission.BROADCAST_BADGE",
			"com.sonymobile.home.permission.PROVIDER_INSERT_BADGE",
			"com.anddoes.launcher.permission.UPDATE_COUNT",
			"com.majeur.launcher.permission.UPDATE_BADGE",
			"com.huawei.android.launcher.permission.CHANGE_BADGE",
			"com.huawei.android.launcher.permission.READ_SETTINGS",
			"com.huawei.android.launcher.permission.WRITE_SETTINGS",
			"android.permission.READ_APP_BADGE",
			"com.oppo.launcher.permission.READ_SETTINGS",
			"com.oppo.launcher.permission.WRITE_SETTINGS",
			"me.everything.badger.permission.BADGE_COUNT_READ",
			"me.everything.badger.permission.BADGE_COUNT_WRITE",
		],
		intentFilters: [
			{
				action: "VIEW",
				autoVerify: true,
				category: ["BROWSABLE", "DEFAULT"],
				data: [
					{ scheme: "https", host, path: "/auth/native-callback" },
					{ scheme: "https", host, pathPrefix: "/builder/" },
				],
			},
		],
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
	],
	extra: {
		eas: { projectId: "5830280e-e1ba-45b7-b9c9-ba048fa3bd4d" },
	},
};

export default config;
