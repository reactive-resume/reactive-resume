import { Trans } from "@lingui/react/macro";
import { CommandItem } from "@reactive-resume/ui/components/command";
import { BaseCommandGroup } from "../base";
import { getLocaleOptions } from "@/features/locale/locale-options";
import { changeLocale } from "@/libs/locale";

export function LanguageCommandPage() {
	return (
		<BaseCommandGroup page="language" heading={<Trans>Language</Trans>}>
			{getLocaleOptions().map(({ value, label, keywords }) => (
				<CommandItem key={value} value={value} keywords={keywords} onSelect={() => changeLocale(value)}>
					{label}
				</CommandItem>
			))}
		</BaseCommandGroup>
	);
}
