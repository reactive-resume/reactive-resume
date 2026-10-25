import type { DateFormat, ResumeDates, YearMonth } from "@reactive-resume/schema/resume/dates";
import { useLingui } from "@lingui/react/macro";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useState } from "react";
import { Platform, View } from "react-native";
import { getPresentLabel } from "@reactive-resume/schema/resume/dates";
import { editDates, fromPickerDate, isReversed, pickerDate, readTypedDate, showYearMonth } from "./dates";
import { resumeFieldFocus } from "@/draft";
import { Button, Icon, IconButton, Sheet, Switch, Text, TextField, useTheme } from "@/ui";

type MonthInputProps = {
	label: string;
	value: YearMonth | null;
	locale: string;
	format?: DateFormat | undefined;
	disabled?: boolean | undefined;
	autoFocus?: boolean | undefined;
	/** Shown instead of the value, e.g. "Present" while ongoing. */
	placeholderValue?: string | undefined;
	onCommit: (value: YearMonth | null) => void;
	onInvalid: (invalid: boolean) => void;
};

/**
 * One date, typed the way people write it ("Mar 2022", "03/2022", "2022-03", "2022") or picked from the month
 * picker. A readable value saves as you type; on blur the field shows it in the resume's date format.
 */
function MonthInput({
	label,
	value,
	locale,
	format,
	disabled,
	autoFocus,
	placeholderValue,
	onCommit,
	onInvalid,
}: MonthInputProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const [typed, setTyped] = useState<string | null>(null);
	const [picking, setPicking] = useState(false);
	const [picked, setPicked] = useState(() => pickerDate(value));

	const commit = (next: YearMonth | null) => {
		setTyped(null);
		onInvalid(false);
		if (next !== value) onCommit(next);
	};

	return (
		<View style={{ flex: 1 }}>
			<TextField
				label={label}
				placeholder={t`Mar 2022`}
				value={placeholderValue ?? typed ?? showYearMonth(value, locale, format)}
				editable={!disabled && placeholderValue === undefined}
				autoFocus={autoFocus && !disabled}
				autoComplete="off"
				autoCorrect={false}
				onFocus={resumeFieldFocus.onFocus}
				onChangeText={(text) => {
					setTyped(text);
					const next = readTypedDate(text, locale);
					onInvalid(next === undefined);
					if (next !== undefined && next !== value) onCommit(next);
				}}
				onBlur={() => {
					resumeFieldFocus.onBlur();
					if (typed === null) return;
					const next = readTypedDate(typed, locale);
					onInvalid(next === undefined);
					if (next !== undefined) setTyped(null);
				}}
				trailing={
					<IconButton
						variant="ghost"
						icon="calendar-dots"
						label={t`Pick ${label}`}
						disabled={disabled || placeholderValue !== undefined}
						onPress={() => {
							setPicked(pickerDate(value));
							setPicking(true);
						}}
					/>
				}
			/>
			{Platform.OS === "android" && picking ? (
				// Android's dialog picks a day; the month and year are kept.
				<DateTimePicker
					value={picked}
					mode="date"
					onChange={(event, date) => {
						setPicking(false);
						if (event.type === "set" && date) commit(fromPickerDate(date));
					}}
				/>
			) : null}
			{Platform.OS === "ios" ? (
				<Sheet open={picking} onClose={() => setPicking(false)} title={label}>
					<View style={{ alignItems: "center" }}>
						<DateTimePicker
							value={picked}
							mode="date"
							display="spinner"
							locale={locale}
							onChange={(_event, date) => date && setPicked(date)}
						/>
					</View>
					<View
						style={{ flexDirection: "row", justifyContent: "flex-end", gap: space.s2, paddingHorizontal: space.s4 }}
					>
						<Button
							variant="ghost"
							label={t`Clear`}
							onPress={() => {
								setPicking(false);
								commit(null);
							}}
						/>
						<Button
							label={t`Done`}
							onPress={() => {
								setPicking(false);
								commit(fromPickerDate(picked));
							}}
						/>
					</View>
				</Sheet>
			) : null}
		</View>
	);
}

type DatesFieldProps = {
	dates: ResumeDates;
	locale: string;
	format?: DateFormat | undefined;
	/** Awards, certifications and publications have one date. */
	single?: boolean | undefined;
	disabled?: boolean | undefined;
	autoFocus?: boolean | undefined;
	onChange: (dates: ResumeDates) => void;
};

/**
 * Structured dates: start – end with a Present switch, or a single date. Editing any part clears the "needs a
 * look" note left by text that couldn't be read exactly.
 */
export function DatesField({ dates, locale, format, single = false, disabled, autoFocus, onChange }: DatesFieldProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const [invalid, setInvalid] = useState({ start: false, end: false });
	const setInvalidFor = (part: "start" | "end") => (value: boolean) =>
		setInvalid((state) => (state[part] === value ? state : { ...state, [part]: value }));

	return (
		<View style={{ gap: space.s2 }}>
			<View style={{ flexDirection: "row", gap: space.s2 }}>
				<MonthInput
					label={single ? t`Date` : t`Start`}
					autoFocus={autoFocus}
					value={dates.start}
					locale={locale}
					format={format}
					disabled={disabled}
					onCommit={(start) => onChange(editDates(dates, { start }))}
					onInvalid={setInvalidFor("start")}
				/>
				{!single ? (
					<MonthInput
						label={t`End`}
						value={dates.end}
						locale={locale}
						format={format}
						disabled={disabled}
						placeholderValue={dates.present ? getPresentLabel(locale) : undefined}
						onCommit={(end) => onChange(editDates(dates, { end }))}
						onInvalid={setInvalidFor("end")}
					/>
				) : null}
			</View>
			{!single ? (
				<View style={{ flexDirection: "row", alignItems: "center", gap: space.s2 }}>
					<Switch
						label={t`Present`}
						value={dates.present}
						disabled={disabled}
						onValueChange={(present) => onChange(editDates(dates, { present, end: present ? null : dates.end }))}
					/>
					<Text>{t`Present`}</Text>
				</View>
			) : null}
			{invalid.start || invalid.end ? (
				<Note icon="warning-circle" tone="dangerText">
					{t`This date hasn't been saved. Use a month and year, like Mar 2022, or just a year. The resume keeps the last valid date.`}
				</Note>
			) : dates.raw !== undefined ? (
				<Note icon="warning" tone="warnText">
					{dates.start
						? t`We read “${dates.raw}”. Pick a month so it sorts and prints consistently.`
						: t`Couldn't read “${dates.raw}”. Enter the dates so they sort and print consistently.`}
				</Note>
			) : isReversed(dates) ? (
				<Note icon="warning" tone="warnText">
					{t`The end is before the start.`}
				</Note>
			) : null}
		</View>
	);
}

type NoteProps = { icon: "warning" | "warning-circle"; tone: "dangerText" | "warnText"; children: string };

function Note({ icon, tone, children }: NoteProps) {
	const { colors, space } = useTheme();
	return (
		<View accessibilityLiveRegion="polite" style={{ flexDirection: "row", gap: space.s1 }}>
			<Icon name={icon} size={16} color={colors[tone]} />
			<Text variant="caption" color={tone} style={{ flex: 1 }}>
				{children}
			</Text>
		</View>
	);
}
