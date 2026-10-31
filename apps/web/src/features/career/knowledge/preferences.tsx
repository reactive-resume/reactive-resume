import type { CareerProfileData } from "@reactive-resume/schema/career";
import type { KeyboardEvent } from "react";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { m } from "motion/react";
import { useId, useRef, useState } from "react";
import { Icon } from "@reactive-resume/ui/components/icon";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { parseAmount } from "@reactive-resume/utils/amount";
import { cn } from "@reactive-resume/utils/style";
import { useDebouncedSave } from "../hooks";
import { CareerLoadError, CareerLoading } from "../load-state";
import { RoleSuggestions } from "../role-suggestions";
import { useCareerTime, useNow } from "../shared";
import { SearchRegionsField } from "./search-regions-field";
import { toastError } from "@/libs/error-message";
import { D2, EASE } from "@/libs/motion";
import { client, orpc } from "@/libs/orpc/client";

const saveFailed = (error: unknown) => toastError(error, t`Couldn't save your preferences. Try again.`);

/** The Preferences profile, saved whole. The cache updates at once; a failed save puts the server copy back. */
export function useProfile() {
	const queryClient = useQueryClient();
	const queryKey = orpc.career.profile.queryKey();
	const query = useQuery(orpc.career.profile.queryOptions());
	const profile = query.data;
	const mutation = useMutation({
		...orpc.career.saveProfile.mutationOptions(),
		onError: (error) => {
			void queryClient.invalidateQueries({ queryKey });
			saveFailed(error);
		},
	});
	const save = (next: CareerProfileData) => {
		queryClient.setQueryData(queryKey, next);
		mutation.mutate(next);
	};
	return { profile, save, isError: query.isError, retry: () => void query.refetch() };
}

export function PreferencesPage() {
	const query = useQuery(orpc.career.profile.queryOptions());
	const profile = query.data;
	if (query.isError && !profile) return <CareerLoadError onRetry={() => void query.refetch()} />;
	// The form keeps its own draft once loaded, so a background refetch never overwrites what's being typed.
	return profile ? <PreferencesForm initial={profile} /> : <CareerLoading />;
}

type PreferencesFormProps = { initial: CareerProfileData };

function PreferencesForm({ initial }: PreferencesFormProps) {
	const { i18n } = useLingui();
	const queryClient = useQueryClient();
	const now = useNow();
	const [draft, setDraft] = useState(initial);
	const [saved, setSaved] = useState(initial);
	const saves = useRef<Promise<unknown>>(Promise.resolve());
	const [status, setStatus] = useState<{ saving: boolean; failed: boolean; at: number | null }>({
		saving: false,
		failed: false,
		at: null,
	});
	const { timeZone } = useCareerTime();
	const id = useId();

	const change = (patch: Partial<CareerProfileData>) => {
		const next = { ...draft, ...patch };
		setDraft(next);
	};

	// Called directly (not through a mutation hook) so the flush on unmount still saves.
	const flush = useDebouncedSave(JSON.stringify(draft), JSON.stringify(saved), (json) => {
		const next = JSON.parse(json) as CareerProfileData;
		setStatus((current) => ({ ...current, saving: true, failed: false }));
		const operation = saves.current.then(() => client.career.saveProfile(next));
		saves.current = operation.catch(() => undefined);
		operation
			.then(() => {
				queryClient.setQueryData(orpc.career.profile.queryKey(), next);
				setSaved(next);
				setStatus({ saving: false, failed: false, at: Date.now() });
			})
			.catch((error: unknown) => {
				setStatus((current) => ({ ...current, saving: false, failed: true }));
				void queryClient.invalidateQueries({ queryKey: orpc.career.profile.queryKey() });
				saveFailed(error);
			});
	});

	const failed = status.failed && !status.saving;
	const dirty = !failed && (status.saving || JSON.stringify(draft) !== JSON.stringify(saved));
	const justNow = status.at !== null && now.getTime() - status.at < 60_000;

	return (
		<div className="grid max-w-[820px] gap-[18px]" onBlur={() => flush()}>
			<div className="flex items-center gap-2">
				<h2 className="flex-1 text-[17px] font-semibold">
					<Trans>What you're looking for</Trans>
				</h2>
				<span role="status" className="flex items-center gap-1 text-xs text-ink-3">
					<Icon name={failed ? "cloud-slash" : dirty ? "arrows-clockwise" : "cloud-check"} size={16} />
					{failed ? (
						<Trans>Not saved</Trans>
					) : dirty ? (
						<Trans>Saving…</Trans>
					) : justNow ? (
						<Trans>Saved just now</Trans>
					) : (
						<Trans>Saved</Trans>
					)}
				</span>
				{failed && (
					<button
						type="button"
						onClick={() => flush(true)}
						className="text-xs text-ink-3 underline underline-offset-2 hover:text-ink"
					>
						<Trans>Retry</Trans>
					</button>
				)}
			</div>

			<div className="grid gap-4 sm:grid-cols-2">
				<ChipField
					label={t`Target roles`}
					placeholder={t`Add a role, then Enter`}
					value={draft.targetRoles}
					onChange={(targetRoles) => change({ targetRoles })}
				/>
				<ChipField
					label={t`Where you want to work`}
					placeholder={t`Add a place, then Enter`}
					value={draft.locations}
					onChange={(locations) => change({ locations })}
				/>
				<div className="sm:col-start-2">
					<SearchRegionsField
						value={draft.searchRegions}
						accountTimeZone={timeZone}
						onChange={(searchRegions) => change({ searchRegions })}
					/>
				</div>
			</div>

			<RoleSuggestions onUse={(targetRoles) => change({ targetRoles })} />

			<div className="grid gap-1.5">
				<label htmlFor={`${id}-priorities`} className="text-xs font-medium text-ink-2">
					<Trans>What matters to you</Trans>
				</label>
				<Textarea
					id={`${id}-priorities`}
					rows={3}
					maxLength={4000}
					value={draft.priorities}
					onChange={(event) => change({ priorities: event.target.value })}
					className="min-h-[84px] py-2.5 text-sm leading-[21px]"
				/>
			</div>

			<section className="grid gap-2.5 rounded-xl border border-line bg-surface p-4">
				<div className="grid gap-1">
					<h3 className="text-sm font-semibold">
						<Trans>Requirements</Trans>
					</h3>
					<p className="text-xs text-ink-3">
						<Trans>Used to check roles and offers. Each is a number, so the coach can compare without guessing.</Trans>
					</p>
				</div>

				<div className="mt-1 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
					<SalaryField
						id={`${id}-salary`}
						locale={i18n.locale}
						value={draft.minBase}
						onChange={(minBase) => change({ minBase })}
					/>

					<div className="grid gap-1.5 sm:col-span-2">
						<span id={`${id}-office`} className="text-xs font-medium text-ink-2">
							<Trans>Office days a week, at most</Trans>
						</span>
						<SegmentedControl
							aria-labelledby={`${id}-office`}
							value={draft.maxOfficeDays === null ? "any" : String(draft.maxOfficeDays)}
							onValueChange={(value) => change({ maxOfficeDays: value === "any" ? null : Number(value) })}
							className="flex w-full"
						>
							<SegmentedControlItem value="any" className="touch-target relative px-2">
								<Trans>Any</Trans>
							</SegmentedControlItem>
							{[0, 1, 2, 3, 4, 5].map((days) => (
								<SegmentedControlItem
									key={days}
									value={String(days)}
									className="touch-target relative px-1 data-checked:bg-transparent data-checked:shadow-none"
								>
									{draft.maxOfficeDays === days && (
										<m.span
											layoutId="office-days"
											transition={{ duration: D2, ease: EASE }}
											className="absolute inset-0 rounded-sm bg-raised shadow-e1"
										/>
									)}
									<span className="relative">{days === 0 ? t`Remote` : days}</span>
								</SegmentedControlItem>
							))}
						</SegmentedControl>
					</div>

					<div className="grid gap-1.5">
						<label htmlFor={`${id}-notice`} className="text-xs font-medium text-ink-2">
							<Trans>Notice period</Trans>
						</label>
						<span className={fieldShell}>
							<input
								id={`${id}-notice`}
								type="number"
								inputMode="numeric"
								min={0}
								max={52}
								value={draft.noticeWeeks ?? ""}
								onChange={(event) => {
									const weeks = event.target.valueAsNumber;
									change({ noticeWeeks: Number.isNaN(weeks) ? null : Math.min(52, Math.max(0, Math.round(weeks))) });
								}}
								className="w-12 min-w-0 [appearance:textfield] bg-transparent text-sm outline-none [&::-webkit-inner-spin-button]:appearance-none"
							/>
							<span className="text-[13px] text-ink-3">
								<Trans>weeks</Trans>
							</span>
						</span>
					</div>
				</div>

				<div className="grid gap-2 text-xs text-ink-3">
					<p>
						<Trans>Times are shown in {timeZone}.</Trans>{" "}
						<Link to="/dashboard/settings/preferences" className="underline underline-offset-2 hover:text-ink">
							<Trans>Change timezone</Trans>
						</Link>
					</p>
				</div>
			</section>
		</div>
	);
}

/** An input-like box holding a prefix/suffix and a bare input; focus rings the whole box. */
const fieldShell =
	"flex h-9 items-center gap-1.5 rounded-md border border-line-2 bg-raised px-2.5 transition-[border-color,box-shadow] duration-quick focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--accent-soft)] pointer-coarse:h-11";

const bareSelect =
	"field-sizing-content cursor-pointer appearance-none bg-transparent text-ink-3 outline-none hover:text-ink focus-visible:text-ink";

type ChipFieldProps = { label: string; placeholder: string; value: string[]; onChange: (value: string[]) => void };

/** Enter or comma adds a chip, Backspace in an empty input removes the last one, × removes one. */
function ChipField({ label, placeholder, value, onChange }: ChipFieldProps) {
	const id = useId();
	const [input, setInput] = useState("");

	const add = () => {
		const chip = input.trim().slice(0, 200);
		if (chip && !value.includes(chip) && value.length < 20) onChange([...value, chip]);
		setInput("");
	};

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.nativeEvent.isComposing) return;
		if (event.key === "Enter" || event.key === ",") {
			event.preventDefault();
			add();
		} else if (event.key === "Backspace" && input === "" && value.length > 0) {
			onChange(value.slice(0, -1));
		}
	};

	return (
		<div className="grid content-start gap-1.5">
			<label htmlFor={id} className="text-xs font-medium text-ink-2">
				{label}
			</label>
			<div className="flex min-h-10 flex-wrap items-center gap-[5px] rounded-md border border-line-2 bg-raised p-[5px] transition-[border-color,box-shadow] duration-quick focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--accent-soft)]">
				{value.map((chip) => (
					<span
						key={chip}
						className="flex h-7 items-center gap-0.5 rounded-sm bg-sunken ps-2.5 pe-1 text-[13px] font-medium"
					>
						{chip}
						<button
							type="button"
							aria-label={t`Remove ${chip}`}
							onClick={() => onChange(value.filter((item) => item !== chip))}
							className="touch-target relative flex size-[22px] items-center justify-center rounded-md text-ink-3 transition-colors duration-quick hover:bg-hover hover:text-ink"
						>
							<Icon name="x" size={16} />
						</button>
					</span>
				))}
				<input
					id={id}
					value={input}
					placeholder={placeholder}
					onChange={(event) => setInput(event.target.value)}
					onKeyDown={onKeyDown}
					onBlur={add}
					className="h-7 min-w-40 flex-1 bg-transparent px-1.5 text-[13px] outline-none placeholder:text-ink-3"
				/>
			</div>
		</div>
	);
}

type SalaryFieldProps = {
	id: string;
	locale: string;
	value: CareerProfileData["minBase"];
	onChange: (value: CareerProfileData["minBase"]) => void;
};

const currencies = Intl.supportedValuesOf("currency");

/** Minimum base: currency prefix and period suffix are small selects; the amount gets separators on blur. */
function SalaryField({ id, locale, value, onChange }: SalaryFieldProps) {
	const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
	// While focused the raw typing shows; otherwise the formatted amount.
	const [typing, setTyping] = useState<string | null>(null);
	const [invalid, setInvalid] = useState(false);
	const formatted = value.amount === null ? "" : number.format(value.amount);

	const symbol = (currency: string) =>
		new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "symbol" })
			.formatToParts(0)
			.find((part) => part.type === "currency")?.value ?? currency;

	const periods = { hour: t`/ hour`, month: t`/ month`, year: t`/ year` };

	return (
		<div className="grid gap-1.5">
			<label htmlFor={id} className="text-xs font-medium text-ink-2">
				<Trans>Minimum base salary</Trans>
			</label>
			<span className={fieldShell}>
				<select
					aria-label={t`Currency`}
					value={value.currency}
					onChange={(event) => onChange({ ...value, currency: event.target.value })}
					className={cn(bareSelect, "text-sm")}
				>
					{currencies.map((currency) => (
						<option key={currency} value={currency}>
							{symbol(currency)}
						</option>
					))}
				</select>
				<input
					id={id}
					inputMode="decimal"
					value={typing ?? formatted}
					aria-invalid={invalid || undefined}
					aria-describedby={invalid ? `${id}-error` : undefined}
					onFocus={() => setTyping(typing ?? formatted)}
					onChange={(event) => {
						setTyping(event.target.value);
						setInvalid(false);
					}}
					onBlur={() => {
						const amount = parseAmount(typing ?? formatted, locale);
						if (amount === undefined) return setInvalid(true);
						onChange({ ...value, amount });
						setInvalid(false);
						setTyping(null);
					}}
					className="w-full min-w-0 flex-1 bg-transparent text-sm outline-none"
				/>
				<select
					aria-label={t`Pay period`}
					value={value.period}
					onChange={(event) => onChange({ ...value, period: event.target.value as keyof typeof periods })}
					className={cn(bareSelect, "text-end text-xs")}
				>
					{Object.entries(periods).map(([period, label]) => (
						<option key={period} value={period}>
							{label}
						</option>
					))}
				</select>
			</span>
			{invalid && (
				<p id={`${id}-error`} role="alert" className="text-xs text-danger-text">
					<Trans>Enter a full amount, such as 95000. Your previous amount is unchanged.</Trans>
				</p>
			)}
		</div>
	);
}
