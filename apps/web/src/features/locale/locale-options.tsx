import { i18n } from "@lingui/core";
import { getLanguageName, isRTL, languageTag } from "@reactive-resume/utils/locale";
import { localeMap, selectableLocales } from "@/libs/locale";

export const getLocaleOptions = () => {
	return selectableLocales.map((value) => {
		const label = localeMap[value];
		const translated = i18n.t(label);
		const name = getLanguageName(value);

		return {
			value,
			label: (
				<span className="flex flex-wrap items-center gap-x-1">
					<bdi lang={languageTag(value)} dir={isRTL(value) ? "rtl" : "ltr"}>
						{name}
					</bdi>
					{name !== translated && <span className="text-ink-3"> · {translated}</span>}
				</span>
			),
			// Shown in the collapsed trigger (a ReactNode label would otherwise fall back to the ISO code).
			textValue: name,
			// Match against the translated name, the ISO code, and the untranslated English name so
			// the list stays searchable regardless of the active UI locale.
			keywords: [name, translated, value, getLanguageName(value, "en-US")],
		};
	});
};
