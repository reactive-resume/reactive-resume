import type { Messages } from "@lingui/core";
import type { LetterWords } from "@reactive-resume/resume/cover-letter";
import type { Locale } from "@reactive-resume/utils/locale";
import { setupI18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { defaultLocale, isLocale } from "@reactive-resume/utils/locale";

// Static imports keep document language independent of the interface language in Metro.
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

export async function letterWords(locale: string): Promise<LetterWords> {
	const resolved = isLocale(locale) ? locale : defaultLocale;
	const { messages } = await loaders[resolved]();
	const i18n = setupI18n();
	i18n.loadAndActivate({ locale: resolved, messages });
	return {
		greeting: (name) => t(i18n)`Dear ${name},`,
		teamGreeting: t(i18n)`Dear hiring team,`,
		hiringTeam: t(i18n)`Hiring team`,
		signOff: t(i18n)`Kind regards,`,
		formatDate: (date) =>
			new Date(`${date}T12:00:00Z`).toLocaleDateString(resolved, {
				day: "numeric",
				month: "long",
				year: "numeric",
				timeZone: "UTC",
			}),
	};
}
