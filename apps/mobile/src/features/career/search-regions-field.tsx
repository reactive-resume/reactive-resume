import type { SearchRegionsAction } from "@reactive-resume/utils/region";
import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { View } from "react-native";
import {
	countryName,
	MAX_SEARCH_REGIONS,
	nextSearchRegions,
	SEARCH_REGION_CODES,
	shownSearchRegions,
} from "@reactive-resume/utils/region";
import { deviceTimeZone } from "@/features/reminders/schedule";
import { Button, Chip, SelectSheet, Text, useTheme } from "@/ui";

export type SearchRegionsFieldProps = {
	value: string[] | null | undefined;
	accountTimeZone: string;
	onChange: (next: string[] | null) => void;
};

/** Countries web searches target: the time zone's country by default, up to three chosen, or none for anywhere. */
export function SearchRegionsField({ value, accountTimeZone, onChange }: SearchRegionsFieldProps) {
	const { t, i18n } = useLingui();
	const { space } = useTheme();
	const shown = shownSearchRegions(value, accountTimeZone, deviceTimeZone());
	const full = shown.codes.length >= MAX_SEARCH_REGIONS;

	const countries = useMemo(
		() =>
			SEARCH_REGION_CODES.map((code) => ({ value: code, label: countryName(code, i18n.locale) })).sort((a, b) =>
				a.label.localeCompare(b.label, i18n.locale),
			),
		[i18n.locale],
	);

	const apply = (action: SearchRegionsAction) => {
		const next = nextSearchRegions(shown.codes, action);
		if (next !== shown.codes) onChange(next);
	};

	return (
		<View style={{ gap: space.s2 }}>
			<Text variant="callout" weight={600} color="ink2">
				{t`Where you're looking for work`}
			</Text>
			<View
				style={{
					flexDirection: "row",
					flexWrap: "wrap",
					alignItems: "center",
					gap: space.s1 + space.s0,
					paddingVertical: space.s1,
				}}
			>
				{shown.codes.map((code) => (
					<Chip
						key={code}
						label={countryName(code, i18n.locale)}
						icon={shown.automatic ? "clock" : undefined}
						selected
						onRemove={() => apply({ type: "remove", code })}
					/>
				))}
				{shown.automatic && shown.codes.length > 0 ? (
					<Text variant="callout" color="ink3">
						{t`From your timezone`}
					</Text>
				) : null}
				{shown.codes.length === 0 ? <Text color="ink3">{t`Anywhere`}</Text> : null}
			</View>
			<SelectSheet
				appearance="row"
				label={t`Add a country`}
				value={null}
				options={countries.filter((country) => !shown.codes.includes(country.value))}
				onChange={(code) => apply({ type: "add", code })}
				disabled={full}
				searchable
			/>
			<Text variant="callout" color="ink3">
				{t`Web searches look for work here, up to three countries.`}
			</Text>
			{!shown.automatic ? (
				<Button variant="ghost" size="sm" label={t`Use my timezone`} onPress={() => apply({ type: "automatic" })} />
			) : null}
		</View>
	);
}
