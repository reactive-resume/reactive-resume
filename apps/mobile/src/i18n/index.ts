// Interface language: the device locale (expo-localization) unless the user picked one in Settings → Preferences.
// Catalogs are apps/mobile/locales/*.po, seeded from the web catalogs by scripts/seed-locales.mjs.
import type { Messages } from "@lingui/core";
import type { Locale } from "@reactive-resume/utils/locale";
import { i18n } from "@lingui/core";
import { getLocales } from "expo-localization";
import Storage from "expo-sqlite/kv-store";
import { I18nManager, Platform, Settings } from "react-native";
import {
	defaultLocale,
	getPreferredLocale,
	isLocale,
	isRTL,
	localeSchema,
	supportedLocales,
} from "@reactive-resume/utils/locale";

const storageKey = "locale";
export const selectableLocales = __DEV__ ? localeSchema.options : supportedLocales;

// Static paths, so Metro can bundle each catalog.
const loaders: Record<Locale, () => Promise<{ messages: Messages }>> = {
	"af-ZA": () => import("../../locales/af-ZA.po"),
	"am-ET": () => import("../../locales/am-ET.po"),
	"ar-SA": () => import("../../locales/ar-SA.po"),
	"az-AZ": () => import("../../locales/az-AZ.po"),
	"bg-BG": () => import("../../locales/bg-BG.po"),
	"bn-BD": () => import("../../locales/bn-BD.po"),
	"ca-ES": () => import("../../locales/ca-ES.po"),
	"cs-CZ": () => import("../../locales/cs-CZ.po"),
	"da-DK": () => import("../../locales/da-DK.po"),
	"de-DE": () => import("../../locales/de-DE.po"),
	"el-GR": () => import("../../locales/el-GR.po"),
	"en-US": () => import("../../locales/en-US.po"),
	"en-GB": () => import("../../locales/en-GB.po"),
	"es-ES": () => import("../../locales/es-ES.po"),
	"fa-IR": () => import("../../locales/fa-IR.po"),
	"fi-FI": () => import("../../locales/fi-FI.po"),
	"fr-FR": () => import("../../locales/fr-FR.po"),
	"he-IL": () => import("../../locales/he-IL.po"),
	"hi-IN": () => import("../../locales/hi-IN.po"),
	"hu-HU": () => import("../../locales/hu-HU.po"),
	"id-ID": () => import("../../locales/id-ID.po"),
	"it-IT": () => import("../../locales/it-IT.po"),
	"ja-JP": () => import("../../locales/ja-JP.po"),
	"km-KH": () => import("../../locales/km-KH.po"),
	"kn-IN": () => import("../../locales/kn-IN.po"),
	"ko-KR": () => import("../../locales/ko-KR.po"),
	"lt-LT": () => import("../../locales/lt-LT.po"),
	"lv-LV": () => import("../../locales/lv-LV.po"),
	"ml-IN": () => import("../../locales/ml-IN.po"),
	"mr-IN": () => import("../../locales/mr-IN.po"),
	"ms-MY": () => import("../../locales/ms-MY.po"),
	"ne-NP": () => import("../../locales/ne-NP.po"),
	"nl-NL": () => import("../../locales/nl-NL.po"),
	"no-NO": () => import("../../locales/no-NO.po"),
	"or-IN": () => import("../../locales/or-IN.po"),
	"pl-PL": () => import("../../locales/pl-PL.po"),
	"pt-BR": () => import("../../locales/pt-BR.po"),
	"pt-PT": () => import("../../locales/pt-PT.po"),
	"ro-RO": () => import("../../locales/ro-RO.po"),
	"ru-RU": () => import("../../locales/ru-RU.po"),
	"sk-SK": () => import("../../locales/sk-SK.po"),
	"sl-SI": () => import("../../locales/sl-SI.po"),
	"sq-AL": () => import("../../locales/sq-AL.po"),
	"sr-SP": () => import("../../locales/sr-SP.po"),
	"sv-SE": () => import("../../locales/sv-SE.po"),
	"ta-IN": () => import("../../locales/ta-IN.po"),
	"te-IN": () => import("../../locales/te-IN.po"),
	"th-TH": () => import("../../locales/th-TH.po"),
	"tr-TR": () => import("../../locales/tr-TR.po"),
	"uk-UA": () => import("../../locales/uk-UA.po"),
	"uz-UZ": () => import("../../locales/uz-UZ.po"),
	"vi-VN": () => import("../../locales/vi-VN.po"),
	"zh-CN": () => import("../../locales/zh-CN.po"),
	"zh-TW": () => import("../../locales/zh-TW.po"),
	"zu-ZA": () => import("../../locales/zu-ZA.po"),
};

/** The supported locale closest to the device's preferred languages. */
export function getDeviceLocale(): Locale {
	return getPreferredLocale(getLocales().map(({ languageTag }) => languageTag));
}

/** The user's override, or null to follow the device. */
export function getLocalePreference(): Locale | null {
	const stored = Storage.getItemSync(storageKey);
	return isLocale(stored) && selectableLocales.includes(stored) ? stored : null;
}

/**
 * Saves the override (null follows the device) and activates it. Changing between a left-to-right and a
 * right-to-left language only flips the layout after the app restarts: React Native reads the direction at launch.
 * Returns true when a restart is needed.
 */
export function setLocalePreference(value: Locale | null): Promise<boolean> {
	const locale = value && selectableLocales.includes(value) ? value : null;
	if (locale) Storage.setItemSync(storageKey, locale);
	else Storage.removeItemSync(storageKey);
	return activateLocale(locale ?? getDeviceLocale());
}

/** Loads and activates a catalog. Returns true when the layout direction changes on the next launch. */
export async function activateLocale(value: Locale) {
	const locale = selectableLocales.includes(value) ? value : defaultLocale;
	const { messages } = await loaders[locale]().catch(() => loaders[defaultLocale]());
	i18n.loadAndActivate({ locale, messages });

	const rtl = isRTL(locale);
	if (Platform.OS === "ios") {
		// expo-localization resets forceRTL at launch; UIKit's persisted direction survives that reset.
		Settings.set({ AppleTextDirection: rtl, NSForceRightToLeftWritingDirection: rtl });
	}
	if (I18nManager.isRTL === rtl) return false;
	I18nManager.allowRTL(rtl);
	I18nManager.forceRTL(rtl);
	return true;
}

/** Activates the preferred locale at startup. */
export function initI18n() {
	return activateLocale(getLocalePreference() ?? getDeviceLocale());
}

export { i18n };
