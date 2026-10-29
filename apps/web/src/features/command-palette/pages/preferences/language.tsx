import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { CommandItem } from "@reactive-resume/ui/components/command";
import { BaseCommandGroup } from "../base";
import { changeLocale, localeMap, selectableLocales } from "@/libs/locale";

export function LanguageCommandPage() {
	const { i18n } = useLingui();

	return (
		<BaseCommandGroup page="language" heading={<Trans>Language</Trans>}>
			{selectableLocales.map((value) => (
				<CommandItem key={value} onSelect={() => changeLocale(value)}>
					<span className="font-mono text-xs text-ink-3">{value}</span>
					{i18n.t(localeMap[value])}
				</CommandItem>
			))}
		</BaseCommandGroup>
	);
}
