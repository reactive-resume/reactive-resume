import type { SingleComboboxProps } from "@/components/ui/combobox";
import { useLingui } from "@lingui/react";
import { getLocaleOptions } from "./locale-options";
import { Combobox } from "@/components/ui/combobox";
import { changeLocale } from "@/libs/locale";

type Props = Omit<SingleComboboxProps, "options" | "value" | "onValueChange">;

export function LocaleCombobox(props: Props) {
	const { i18n } = useLingui();

	return (
		<Combobox
			showClear={false}
			defaultValue={i18n.locale}
			options={getLocaleOptions()}
			onValueChange={changeLocale}
			{...props}
		/>
	);
}
