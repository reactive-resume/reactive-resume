import { i18n } from "@lingui/core";
import { localeMap, selectableLocales } from "@/libs/locale";

export const getLocaleOptions = () => {
	return selectableLocales.map((value) => {
		const label = localeMap[value];
		const name = i18n.t(label);

		return {
			value,
			label: (
				<span className="flex items-center gap-x-2">
					<span className="font-mono text-xs text-ink-3">{value}</span>
					{name}
				</span>
			),
			// Shown in the collapsed trigger (a ReactNode label would otherwise fall back to the ISO code).
			textValue: name,
			// Match against the translated name, the ISO code, and the untranslated English name so
			// the list stays searchable regardless of the active UI locale.
			keywords: [name, value.toLowerCase(), label.message].filter((keyword): keyword is string => Boolean(keyword)),
		};
	});
};
