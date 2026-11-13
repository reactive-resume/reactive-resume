import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { useMemo } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { getCurrencyOptions } from "@reactive-resume/utils/amount";
import { Combobox } from "@/components/ui/combobox";

type CurrencySelectProps = {
	id?: string | undefined;
	value: string;
	onChange: (value: string) => void;
	invalid?: boolean | undefined;
	describedBy?: string | undefined;
	className?: string | undefined;
	symbol?: boolean;
};

export function CurrencySelect({
	id,
	value,
	onChange,
	invalid,
	describedBy,
	className,
	symbol = true,
}: CurrencySelectProps) {
	const { i18n } = useLingui();
	const options = useMemo(
		() =>
			getCurrencyOptions(i18n.locale, value).map((option) => ({
				...option,
				label: symbol ? option.label.replace(" · ", " ") : option.value,
			})),
		[i18n.locale, value, symbol],
	);
	return (
		<Combobox
			{...(id ? { id } : {})}
			value={value || null}
			options={options}
			onValueChange={(next) => onChange(next ?? "")}
			showClear={false}
			render={
				<Button
					variant="secondary"
					aria-label={t`Currency`}
					aria-invalid={invalid}
					aria-describedby={describedBy}
					className={className}
				/>
			}
		/>
	);
}
