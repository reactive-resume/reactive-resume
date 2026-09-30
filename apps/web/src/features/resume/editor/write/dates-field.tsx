import type { DateFormat, ResumeDates, YearMonth } from "@reactive-resume/schema/resume/dates";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useId, useState } from "react";
import { formatYearMonth, getPresentLabel, toYearMonth } from "@reactive-resume/schema/resume/dates";
import { readSingleDate } from "@reactive-resume/schema/resume/period";
import { Icon } from "@reactive-resume/ui/components/icon";
import { inputBaseClassName } from "@reactive-resume/ui/components/input";
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
				name="calendar_month"
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
	onChange: (dates: ResumeDates) => void;
	className?: string;
};

/**
 * Structured dates: start – end with a Present switch, or a single date. Editing any part clears the
 * "needs a look" note left by text that couldn't be read exactly.
 */
export function DatesField({ dates, single = false, locale, format, onChange, className }: DatesFieldProps) {
	const id = useId();
	const [invalid, setInvalid] = useState<Record<"start" | "end", boolean>>({ start: false, end: false });
	// Any edit replaces the dates without `raw`, which clears the review note.
	const current: ResumeDates = { start: dates.start, end: dates.end, present: dates.present };
	const reversed = !single && !dates.present && dates.start && dates.end && isBefore(dates.end, dates.start);
	const hasError = invalid.start || invalid.end;

	const setInvalidFor = (part: "start" | "end") => (value: boolean) =>
		setInvalid((state) => (state[part] === value ? state : { ...state, [part]: value }));

	return (
		<fieldset className={cn("grid min-w-0 gap-1.5", className)} aria-describedby={`${id}-note`}>
			<legend className="mb-1.5 font-medium text-[13px] text-ink leading-4">
				{single ? <Trans>Date</Trans> : <Trans>Dates</Trans>}
			</legend>

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

			{!single && (
				<>
					{/* biome-ignore lint/a11y/noLabelWithoutControl: Base UI's Switch is the control; wrapping it in a label is its documented pattern. */}
					<label className="flex w-fit cursor-pointer items-center gap-2 p-1 text-sm">
						<Switch
							checked={dates.present}
							onCheckedChange={(present) => onChange({ ...current, present, end: present ? null : dates.end })}
						/>
						<Trans>Present</Trans>
					</label>
				</>
			)}

			<div id={`${id}-note`}>
				{hasError ? (
					<p className="flex items-start gap-1 text-danger-text text-xs leading-4">
						<Icon name="error" size={16} className="shrink-0" />
						<Trans>
							This date hasn't been saved. Use a month and year, like Mar 2022, or just a year. The resume keeps the
							last valid date.
						</Trans>
					</p>
				) : dates.raw !== undefined ? (
					<p className="flex items-start gap-1 text-warn-text text-xs leading-4">
						<Icon name="warning" size={16} className="shrink-0" />
						{dates.start ? (
							<Trans>We read "{dates.raw}". Pick a month so it sorts and prints consistently.</Trans>
						) : (
							<Trans>We couldn't read "{dates.raw}". Enter the dates so they sort and print consistently.</Trans>
						)}
					</p>
				) : reversed ? (
					<p className="flex items-start gap-1 text-warn-text text-xs leading-4">
						<Icon name="warning" size={16} className="shrink-0" />
						<Trans>The end is before the start.</Trans>
					</p>
				) : null}
			</div>
		</fieldset>
	);
}
