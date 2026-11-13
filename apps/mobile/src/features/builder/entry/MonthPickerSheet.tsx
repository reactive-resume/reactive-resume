// The month picker (BUILD.md §3.1): month-only dates with "Present", which neither platform's picker offers. A bottom
// sheet with a month column and a year column; every pick applies at once with `selection`.
import type { YearMonth } from "@reactive-resume/schema/resume/dates";
import { t } from "@lingui/core/macro";
import { useMemo } from "react";
import { ScrollView, View } from "react-native";
import { now } from "@/data/clock";
import { BottomSheet, haptic, Text, Touch, useTheme } from "@/ui";

const ROW = 44;

function Option({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
	const { colors } = useTheme();
	return (
		<Touch
			onPress={onPress}
			feedback="wash"
			accessibilityRole="radio"
			accessibilityLabel={label}
			accessibilityState={{ selected }}
			style={{
				height: ROW,
				marginHorizontal: 4,
				borderRadius: 10,
				justifyContent: "center",
				paddingHorizontal: 12,
				backgroundColor: selected ? colors.accentSoft : "transparent",
			}}
		>
			<Text variant="rowTitle" weight={selected ? 600 : 500} color={selected ? "accentText" : "ink"}>
				{label}
			</Text>
		</Touch>
	);
}

export type MonthPick = { value: YearMonth | null; present: boolean };

export function MonthPickerSheet({
	title,
	value,
	present,
	allowPresent,
	locale,
	onChange,
	onClose,
}: {
	title: string;
	value: YearMonth | null;
	present: boolean;
	allowPresent: boolean;
	locale: string;
	onChange: (next: MonthPick) => void;
	onClose: () => void;
}) {
	const months = useMemo(() => {
		let format: Intl.DateTimeFormat;
		try {
			format = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" });
		} catch {
			format = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" });
		}
		return Array.from({ length: 12 }, (_, i) => format.format(Date.UTC(2000, i, 1)));
	}, [locale]);
	const thisYear = now().getFullYear();
	const years = useMemo(() => Array.from({ length: 70 }, (_, i) => thisYear + 5 - i), [thisYear]);
	const [year, month] = value ? [Number(value.slice(0, 4)), Number(value.slice(5, 7)) || 0] : [0, 0];
	const pick = (next: MonthPick) => {
		haptic("selection");
		onChange(next);
	};
	const set = (y: number, m: number) =>
		pick({ value: (m ? `${y}-${String(m).padStart(2, "0")}` : `${y}`) as YearMonth, present: false });
	return (
		<BottomSheet title={title} height={480} onClose={onClose}>
			{allowPresent ? (
				<View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
					<Option label={t`Present`} selected={present} onPress={() => pick({ value: null, present: true })} />
				</View>
			) : null}
			<View style={{ flex: 1, flexDirection: "row", paddingHorizontal: 20, gap: 8 }}>
				<ScrollView style={{ flex: 3 }} accessibilityLabel={t`Month`}>
					{months.map((label, i) => (
						<Option
							key={label}
							label={label}
							selected={!present && month === i + 1}
							onPress={() => set(year || thisYear, i + 1)}
						/>
					))}
				</ScrollView>
				<ScrollView style={{ flex: 2 }} accessibilityLabel={t`Year`}>
					{years.map((y) => (
						<Option key={y} label={String(y)} selected={!present && year === y} onPress={() => set(y, month)} />
					))}
				</ScrollView>
			</View>
		</BottomSheet>
	);
}
