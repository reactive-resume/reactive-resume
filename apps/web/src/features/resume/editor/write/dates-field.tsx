import type { DateFormat, ResumeDates, YearMonth } from "@reactive-resume/schema/resume/dates";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useId, useState } from "react";
import {
	formatResumeDates,
	formatYearMonth,
	getPresentLabel,
	hasUnreadableDateText,
	readLegacyDates,
	toYearMonth,
} from "@reactive-resume/schema/resume/dates";
import { readSingleDate } from "@reactive-resume/schema/resume/period";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input, inputBaseClassName } from "@reactive-resume/ui/components/input";
import { Switch } from "@reactive-resume/ui/components/switch";
import { cn } from "@reactive-resume/utils/style";

type DateSettings = { locale: string; format?: DateFormat | undefined };

/** What someone typed as a date: a year-month, null when cleared, or undefined when it can't be read. */
function readTypedDate(text: string, locale: string): YearMonth | null | undefined {
	const value = text.trim();
	if (!value) return null;
	const reading = readSingleDate(value, locale);
	return reading ? toYearMonth(reading.endpoint) : undefined;
}

const isBefore = (end: YearMonth, start: YearMonth) => end.localeCompare(start) < 0 && !start.startsWith(end);

type MonthYearInputProps = DateSettings & {
	label: string;
	value: YearMonth | null;
	disabled?: boolean;
	/** Shown instead of the value, e.g. "Present" while the entry is ongoing. */
	placeholderValue?: string | undefined;
	onCommit: (value: YearMonth | null) => void;
	onInvalid: (invalid: boolean) => void;
};

/**
 * One date, typed the way people write it ("Mar 2022", "03/2022", "2022-03" or just "2022"). A readable value
 * saves as you type; on blur the field shows it in the resume's date format.
 */
function MonthYearInput({
	label,
	value,
	locale,
	format,
	disabled,
	placeholderValue,
	onCommit,
	onInvalid,
}: MonthYearInputProps) {
	const [typed, setTyped] = useState<string | null>(null);
	const formatted = value ? formatYearMonth(value, { locale, format }) : "";

	return (
		<div className="relative min-w-0 flex-1">
			<Icon
				name="calendar-dots"
				size={18}
				className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-ink-3"
			/>
			<input
				type="text"
				inputMode="text"
				autoComplete="off"
				aria-label={label}
				disabled={disabled}
				placeholder={t`Mar 2022`}
				value={placeholderValue ?? typed ?? formatted}
				className={cn(inputBaseClassName, "h-9 ps-9 disabled:bg-sunken disabled:text-ink-2 disabled:opacity-100")}
				onChange={(event) => {
					setTyped(event.target.value);
					const next = readTypedDate(event.target.value, locale);
					onInvalid(next === undefined);
					if (next !== undefined && next !== value) onCommit(next);
				}}
				onBlur={() => {
					if (typed === null) return;
					const next = readTypedDate(typed, locale);
					onInvalid(next === undefined);
					if (next !== undefined) setTyped(null);
				}}
			/>
		</div>
	);
}

type DatesFieldProps = DateSettings & {
	dates: ResumeDates;
	/** Awards, certifications and publications have one date. */
	single?: boolean | undefined;
	/** Education: an end date still to come can print as "Expected May 2027". */
	expectable?: boolean | undefined;
	onChange: (dates: ResumeDates) => void;
	className?: string;
};

/** Preset date fields or verbatim custom text, using the existing raw date representation. */
export function DatesField({
	dates,
	single = false,
	expectable = false,
	locale,
	format,
	onChange,
	className,
}: DatesFieldProps) {
	const id = useId();
	const [invalid, setInvalid] = useState<Record<"start" | "end", boolean>>({ start: false, end: false });
	const current: ResumeDates = {
		start: dates.start,
		end: dates.end,
		present: dates.present,
		...(dates.expected ? { expected: true } : {}),
	};
	const reversed = !single && !dates.present && dates.start && dates.end && isBefore(dates.end, dates.start);
	const custom = dates.raw !== undefined;
	const preset = formatResumeDates(current, { locale, format });
	const parsed = custom && dates.raw !== preset ? readLegacyDates(dates.raw ?? "", { locale, single }) : current;
	const canUseFields = parsed.raw === undefined;
	const unreadable = hasUnreadableDateText(dates);
	const hasError = !custom && (invalid.start || (!dates.present && invalid.end));

	const setInvalidFor = (part: "start" | "end") => (value: boolean) =>
		setInvalid((state) => (state[part] === value ? state : { ...state, [part]: value }));

	return (
		<fieldset className={cn("grid min-w-0 gap-1.5", className)} aria-describedby={`${id}-note`}>
			<legend className="mb-1.5 text-[13px] leading-4 font-medium text-ink">
				{single ? <Trans>Date</Trans> : <Trans>Dates</Trans>}
			</legend>

			{/* oxlint-disable-next-line jsx-a11y/label-has-associated-control -- Base UI Switch is the wrapped control. */}
			<label className="flex w-fit items-center gap-2 p-1 text-sm">
				<Switch
					checked={custom}
					disabled={custom && !canUseFields}
					aria-describedby={`${id}-note`}
					onCheckedChange={(checked) => {
						setInvalid({ start: false, end: false });
						onChange(checked ? { ...current, raw: preset } : parsed);
					}}
				/>
				<Trans>Custom date text</Trans>
			</label>

			{custom ? (
				<Input
					aria-label={single ? t`Date` : t`Dates`}
					aria-describedby={`${id}-note`}
					value={dates.raw}
					onChange={(event) => {
						const raw = event.target.value;
						onChange({ ...readLegacyDates(raw, { locale, single }), raw });
					}}
				/>
			) : (
				<div className="flex items-center gap-2">
					<MonthYearInput
						label={single ? t`Date` : t`Start`}
						value={dates.start}
						locale={locale}
						format={format}
						onCommit={(start) => onChange({ ...current, start })}
						onInvalid={setInvalidFor("start")}
					/>

					{!single && (
						<>
							<span aria-hidden="true" className="text-ink-3">
								–
							</span>
							<MonthYearInput
								label={t`End`}
								value={dates.end}
								locale={locale}
								format={format}
								disabled={dates.present}
								placeholderValue={dates.present ? getPresentLabel(locale) : undefined}
								onCommit={(end) => onChange({ ...current, end })}
								onInvalid={setInvalidFor("end")}
							/>
						</>
					)}
				</div>
			)}

			{!custom && !single && (
				<>
					{/* oxlint-disable-next-line jsx-a11y/label-has-associated-control -- Base UI's Switch is the control; wrapping it in a label is its documented pattern. */}
					<label className="flex w-fit cursor-pointer items-center gap-2 p-1 text-sm">
						<Switch
							checked={dates.present}
							onCheckedChange={(present) => {
								const { expected: _expected, ...rest } = current;
								onChange({ ...rest, present, end: present ? null : dates.end });
							}}
						/>
						<Trans>Present</Trans>
					</label>
					{expectable && !dates.present && (
						// oxlint-disable-next-line jsx-a11y/label-has-associated-control -- Base UI's Switch is the control; wrapping it in a label is its documented pattern.
						<label className="flex w-fit cursor-pointer items-center gap-2 p-1 text-sm">
							<Switch
								checked={dates.expected === true}
								onCheckedChange={(expected) => {
									const { expected: _expected, ...rest } = current;
									onChange(expected ? { ...rest, expected: true } : rest);
								}}
							/>
							<Trans comment="Switch on an education entry's dates: the end date is still to come">Expected</Trans>
						</label>
					)}
				</>
			)}

			<div id={`${id}-note`}>
				{unreadable && (
					<p className="text-xs leading-4 text-warn-text">
						<Trans>Saved as written. Automated date checks and sorting are unavailable for this text.</Trans>
					</p>
				)}
				{custom && !canUseFields && (
					<p className="text-xs leading-4 text-ink-2">
						<Trans>Enter a readable date or clear the text to use date fields.</Trans>
					</p>
				)}
				{hasError ? (
					<p className="flex items-start gap-1 text-xs leading-4 text-danger-text">
						<Icon name="warning-circle" size={16} className="shrink-0" />
						<Trans>
							This date hasn't been saved. Use a month and year, like Mar 2022, or just a year. The resume keeps the
							last valid date. Turn on Custom date text to save other wording.
						</Trans>
					</p>
				) : reversed ? (
					<p className="flex items-start gap-1 text-xs leading-4 text-warn-text">
						<Icon name="warning" size={16} className="shrink-0" />
						<Trans>The end is before the start.</Trans>
					</p>
				) : null}
			</div>
		</fieldset>
	);
}
