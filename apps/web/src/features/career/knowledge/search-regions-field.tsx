import type { SearchRegionsAction } from "@reactive-resume/utils/region";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useId, useMemo } from "react";
import {
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
	ComboboxRoot,
	ComboboxTrigger,
	useFilter,
} from "@reactive-resume/ui/components/combobox";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import {
	countryName,
	MAX_SEARCH_REGIONS,
	nextSearchRegions,
	SEARCH_REGION_CODES,
	shownSearchRegions,
} from "@reactive-resume/utils/region";

type Country = { value: string; label: string };

export type SearchRegionsFieldProps = {
	value: string[] | null | undefined;
	accountTimeZone: string;
	onChange: (next: string[] | null) => void;
};

/** Countries web searches target: the time zone's country by default, up to three chosen, or none for anywhere. */
export function SearchRegionsField({ value, accountTimeZone, onChange }: SearchRegionsFieldProps) {
	const { i18n } = useLingui();
	const labelId = useId();
	const { contains } = useFilter();
	const device = Intl.DateTimeFormat().resolvedOptions().timeZone;
	const shown = shownSearchRegions(value, accountTimeZone, device);
	const full = shown.codes.length >= MAX_SEARCH_REGIONS;

	const countries = useMemo(
		() =>
			SEARCH_REGION_CODES.map((code) => ({ value: code, label: countryName(code, i18n.locale) })).sort((a, b) =>
				a.label.localeCompare(b.label, i18n.locale),
			),
		[i18n.locale],
	);
	const name = (code: string) => countryName(code, i18n.locale);

	const apply = (action: SearchRegionsAction) => {
		const next = nextSearchRegions(shown.codes, action);
		if (next !== shown.codes) onChange(next);
	};

	const onPick = (picked: Country[]) => {
		const added = picked.find((country) => !shown.codes.includes(country.value));
		const removed = shown.codes.find((code) => !picked.some((country) => country.value === code));
		if (added) apply({ type: "add", code: added.value });
		else if (removed) apply({ type: "remove", code: removed });
	};

	return (
		<div role="group" aria-labelledby={labelId} className="grid content-start gap-1.5">
			<span id={labelId} className="text-xs font-medium text-ink-2">
				<Trans>Where you're looking for work</Trans>
			</span>
			<div className="flex min-h-10 flex-wrap items-center gap-[5px] rounded-md border border-line-2 bg-raised p-[5px]">
				{shown.codes.map((code) => {
					const country = name(code);
					return (
						<span
							key={code}
							className="flex h-7 items-center gap-1 rounded-sm bg-sunken ps-2.5 pe-1 text-[13px] font-medium"
						>
							<span>{country}</span>
							{shown.automatic && (
								<span className="flex items-center gap-0.5 text-xs font-normal text-ink-3">
									<Icon name="clock" size={14} />
									<Trans>From your timezone</Trans>
								</span>
							)}
							<button
								type="button"
								aria-label={t`Remove ${country}`}
								onClick={() => apply({ type: "remove", code })}
								className="touch-target relative flex size-[22px] items-center justify-center rounded-md text-ink-3 transition-colors duration-quick hover:bg-hover hover:text-ink"
							>
								<Icon name="x" size={16} />
							</button>
						</span>
					);
				})}
				{shown.codes.length === 0 && (
					<span className="px-1.5 text-[13px] text-ink-3">
						<Trans>Anywhere</Trans>
					</span>
				)}
				<ComboboxRoot
					multiple
					items={countries}
					value={countries.filter((country) => shown.codes.includes(country.value))}
					onValueChange={onPick}
					itemToStringLabel={(country: Country) => country.label}
					isItemEqualToValue={(a: Country, b: Country) => a.value === b.value}
					filter={(country: Country, query: string) =>
						contains(country.label, query) || country.value === query.trim().toUpperCase()
					}
				>
					<ComboboxTrigger
						aria-label={t`Add a country`}
						className="ms-auto flex h-7 items-center gap-1 rounded-sm px-2 text-[13px] text-ink-3 transition-colors duration-quick hover:bg-hover hover:text-ink"
					>
						<Trans>Add a country</Trans>
					</ComboboxTrigger>
					<ComboboxContent aria-label={t`Countries`}>
						<ComboboxInput
							placeholder={t`Search countries`}
							render={<Input className="border-none focus-visible:border-none focus-visible:ring-0" />}
						/>
						<ComboboxEmpty>
							<Trans>No country matches.</Trans>
						</ComboboxEmpty>
						<ComboboxList>
							{(country: Country) => (
								<ComboboxItem
									key={country.value}
									value={country}
									disabled={full && !shown.codes.includes(country.value)}
								>
									{country.label}
								</ComboboxItem>
							)}
						</ComboboxList>
					</ComboboxContent>
				</ComboboxRoot>
			</div>
			<p className="flex flex-wrap items-center gap-x-1 text-xs text-ink-3">
				<Trans>Web searches look for work here, up to three countries.</Trans>
				{!shown.automatic && (
					<button
						type="button"
						onClick={() => apply({ type: "automatic" })}
						className="text-ink-2 underline underline-offset-2 hover:text-ink"
					>
						<Trans>Use my timezone</Trans>
					</button>
				)}
			</p>
		</div>
	);
}
