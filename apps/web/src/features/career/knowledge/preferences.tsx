import type { CareerProfileData } from "@reactive-resume/schema/career";
import type { KeyboardEvent, ReactNode } from "react";
import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouteContext } from "@tanstack/react-router";
import { useId, useRef, useState } from "react";
import { careerProfileDataSchema } from "@reactive-resume/schema/career";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Label } from "@reactive-resume/ui/components/label";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { parseAmount } from "@reactive-resume/utils/amount";
import { cn } from "@reactive-resume/utils/style";
import { CurrencySelect } from "../currency-select";
import { DraftRecovery } from "../draft-recovery";
import { useDebouncedSave, useSessionDraft } from "../hooks";
import { CareerLoadError, CareerLoading } from "../load-state";
import { RoleSuggestions } from "../role-suggestions";
import { useCareerTime, useNow } from "../shared";
import { KnowledgeFrame } from "./frame";
import {
	chipFieldClassName,
	fieldChipClassName,
	fieldChipRemoveClassName,
	SearchRegionsField,
} from "./search-regions-field";
import { List, ListRow } from "@/components/calm/list-row";
import { Columns } from "@/components/calm/page";
import { SectionHeading } from "@/components/calm/section-heading";
import { getAccountGeneration } from "@/libs/auth/clear-account-data";
import { toastError } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";

const saveFailed = (error: unknown) => toastError(error, t`Couldn't save your preferences. Try again.`);

/** The cache updates at once; a failed save puts the server copy back. */
export function useProfile() {
	const queryClient = useQueryClient();
	const { session } = useRouteContext({ strict: false });
	// The page belongs to the account it rendered for. Binding the write here keeps a profile read before a session
	// swap from being re-labelled as the new account's, even if the transport's global scope moved on.
	const [owner] = useState(() => session?.user.id ?? null);
	const queryKey = orpc.career.profile.queryKey();
	const query = useQuery(orpc.career.profile.queryOptions());
	const profile = query.data;
	const mutationKey = [...orpc.career.updateProfile.key(), owner];
	const mutation = useMutation({
		...orpc.career.updateProfile.mutationOptions({ context: owner ? { accountId: owner } : {} }),
		mutationKey,
		scope: { id: `career-memory:${owner}` },
		onError: (error) => {
			// A failed earlier choice must not overwrite the next queued choice's optimistic cache.
			if (queryClient.isMutating({ mutationKey }) === 1) void queryClient.invalidateQueries({ queryKey });
			saveFailed(error);
		},
	});
	const save = (next: Partial<CareerProfileData>) => {
		queryClient.setQueryData(queryKey, (current: CareerProfileData | undefined) =>
			current ? { ...current, ...next } : current,
		);
		mutation.mutate(next);
	};
	return { profile, save, isError: query.isError, retry: () => void query.refetch() };
}

export function PreferencesPage() {
	const query = useQuery(orpc.career.profile.queryOptions());
	const profile = query.data;
	// The form keeps its own draft once loaded, so a background refetch never overwrites what's being typed.
	if (profile) return <PreferencesForm initial={profile} />;
	return (
		<KnowledgeFrame current="preferences">
			<div className="pt-6">
				{query.isError ? <CareerLoadError onRetry={() => void query.refetch()} /> : <CareerLoading />}
			</div>
		</KnowledgeFrame>
	);
}

type PreferencesFormProps = { initial: CareerProfileData };

function PreferencesForm({ initial }: PreferencesFormProps) {
	const { i18n } = useLingui();
	const queryClient = useQueryClient();
	const now = useNow();
	const kept = useSessionDraft(
		"preferences",
		initial,
		(value) => {
			const parsed = careerProfileDataSchema.safeParse(value);
			return parsed.success ? parsed.data : undefined;
		},
		true,
	);
	const { value: draft, setValue: setDraft } = kept;
	const [saved, setSaved] = useState(initial);
	const generation = useRef(getAccountGeneration());
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
	const flush = useDebouncedSave(JSON.stringify(kept.restored ? saved : draft), JSON.stringify(saved), (json) => {
		const next = JSON.parse(json) as CareerProfileData;
		setStatus((current) => ({ ...current, saving: true, failed: false }));
		const operation = saves.current.then(() => {
			if (generation.current !== getAccountGeneration()) throw new Error("Account changed");
			// A recovered Preferences draft must not restore an old Facts memory choice.
			return client.career.updateProfile({ ...next, memoryMode: undefined });
		});
		saves.current = operation.catch(() => undefined);
		operation
			.then(() => {
				if (generation.current !== getAccountGeneration()) return;
				queryClient.setQueryData(orpc.career.profile.queryKey(), (current: CareerProfileData | undefined) => ({
					...next,
					memoryMode: current?.memoryMode ?? next.memoryMode,
				}));
				setSaved(next);
				kept.clear(next);
				setStatus({ saving: false, failed: false, at: Date.now() });
			})
			.catch((error: unknown) => {
				if (generation.current !== getAccountGeneration()) return;
				setStatus((current) => ({ ...current, saving: false, failed: true }));
				void queryClient.invalidateQueries({ queryKey: orpc.career.profile.queryKey() });
				saveFailed(error);
			});
	});

	const failed = kept.restored || (status.failed && !status.saving);
	const dirty = !failed && (status.saving || JSON.stringify(draft) !== JSON.stringify(saved));
	const justNow = status.at !== null && now.getTime() - status.at < 60_000;

	const money =
		draft.minBase.amount === null
			? null
			: new Intl.NumberFormat(i18n.locale, {
					style: "currency",
					currency: draft.minBase.currency || "USD",
					maximumFractionDigits: 0,
				}).format(draft.minBase.amount);
	const days = draft.maxOfficeDays;
	const checks = [
		money && t`${money} minimum`,
		days === null
			? null
			: days === 0
				? t`remote only`
				: plural(days, { one: "at most # office day a week", other: "at most # office days a week" }),
		draft.locations.length > 0 &&
			new Intl.ListFormat(i18n.locale, { type: "disjunction" }).format(
				draft.locations.map((place) => (place.toLowerCase() === "remote" ? t`remote` : place)),
			),
	].filter((item): item is string => Boolean(item));
	const checked = new Intl.ListFormat(i18n.locale, { type: "conjunction" }).format(checks);

	const saveStatus = (
		<span role="status" className="flex h-9 items-center gap-1.5 t-small text-ink-3">
			<Icon name={failed ? "cloud-slash" : dirty ? "arrows-clockwise" : "cloud-check"} size={18} />
			{failed ? (
				<Trans>Not saved</Trans>
			) : dirty ? (
				<Trans>Saving…</Trans>
			) : justNow ? (
				<Trans>Saved just now</Trans>
			) : (
				<Trans>Saved</Trans>
			)}
			{failed && (
				<button
					type="button"
					onClick={() => flush(true)}
					className="rounded-xs font-medium text-accent-text hover:underline"
				>
					<Trans>Retry</Trans>
				</button>
			)}
		</span>
	);

	return (
		<KnowledgeFrame current="preferences" actions={saveStatus}>
			<Columns
				className="xl:grid-cols-[minmax(0,1fr)_320px]"
				aside={
					<>
						<SectionHeading className="pt-6">
							<Trans>Where these are used</Trans>
						</SectionHeading>
						<List>
							{/* calm: request to lead — link this to /dashboard/career/schedules once that route exists. */}
							<UsedRow
								to="/dashboard/career"
								title={<Trans>Role discovery</Trans>}
								subtitle={<Trans>Searches start from your roles, places and countries.</Trans>}
							/>
							<UsedRow
								to="/dashboard/career/offers"
								title={<Trans>Offers</Trans>}
								subtitle={
									checks.length > 0 ? (
										<Trans>Checked for {checked}.</Trans>
									) : (
										<Trans>Checked once you set a requirement.</Trans>
									)
								}
							/>
							<UsedRow
								to="/dashboard/career/coach/{-$conversationId}"
								title={<Trans>The coach</Trans>}
								subtitle={<Trans>Sent with a message while Knowledge is switched on, and never otherwise.</Trans>}
							/>
						</List>
					</>
				}
			>
				<div onBlur={() => flush()}>
					<SectionHeading className="pt-6">
						<Trans>What you're looking for</Trans>
					</SectionHeading>
					<div className="grid gap-[18px]">
						<DraftRecovery {...kept} />
						<ChipField
							label={t`Target roles`}
							hint={<RoleSuggestions onUse={(targetRoles) => change({ targetRoles })} />}
							placeholder={t`Add a role`}
							value={draft.targetRoles}
							onChange={(targetRoles) => change({ targetRoles })}
						/>
						<div className="grid gap-x-3 gap-y-1.5 max-sm:gap-y-[18px] sm:grid-cols-2">
							<ChipField
								label={t`Where you want to work`}
								placeholder={t`Add a place`}
								value={draft.locations}
								onChange={(locations) => change({ locations })}
							/>
							<SearchRegionsField
								value={draft.searchRegions}
								accountTimeZone={timeZone}
								onChange={(searchRegions) => change({ searchRegions })}
							/>
						</div>
						<div className="grid gap-1.5">
							<Label htmlFor={`${id}-priorities`}>
								<Trans>What matters to you</Trans>
							</Label>
							<Textarea
								id={`${id}-priorities`}
								rows={2}
								maxLength={4000}
								value={draft.priorities}
								onChange={(event) => change({ priorities: event.target.value })}
								className="min-h-[74px] resize-none"
							/>
						</div>
					</div>

					<SectionHeading
						className="pt-7"
						note={<Trans>Numbers, so roles and offers can be checked without guessing</Trans>}
					>
						<Trans>Requirements</Trans>
					</SectionHeading>
					<div className="grid items-start gap-4 sm:grid-cols-[232px_minmax(0,1fr)_112px]">
						<SalaryField
							id={`${id}-salary`}
							locale={i18n.locale}
							value={draft.minBase}
							onChange={(minBase) => change({ minBase })}
						/>

						<div className="grid gap-1.5">
							<span id={`${id}-office`} className="text-[13px]/[18px] font-medium text-ink-2">
								<Trans>Office days a week, at most</Trans>
							</span>
							<SegmentedControl
								aria-labelledby={`${id}-office`}
								value={draft.maxOfficeDays === null ? "any" : String(draft.maxOfficeDays)}
								onValueChange={(value) => change({ maxOfficeDays: value === "any" ? null : Number(value) })}
								className="flex h-10 w-full"
							>
								<SegmentedControlItem value="any" className="px-1">
									<Trans>Any</Trans>
								</SegmentedControlItem>
								{[0, 1, 2, 3, 4, 5].map((count) => (
									<SegmentedControlItem
										key={count}
										value={String(count)}
										className={cn("px-1", count === 0 && "flex-[1.7]")}
									>
										{count === 0 ? t`Remote` : count}
									</SegmentedControlItem>
								))}
							</SegmentedControl>
						</div>

						<div className="grid gap-1.5">
							<Label htmlFor={`${id}-notice`}>
								<Trans>Notice period</Trans>
							</Label>
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
									className="w-full min-w-0 flex-1 [appearance:textfield] bg-transparent text-sm outline-none focus-visible:outline-none [&::-webkit-inner-spin-button]:appearance-none"
								/>
								<span className="text-sm text-ink-3">
									<Trans>weeks</Trans>
								</span>
							</span>
						</div>
					</div>
					<p className="pt-5 t-small text-ink-3">
						<Trans>Times are shown in {timeZone}.</Trans>{" "}
						<Link
							to="/dashboard/settings/preferences"
							className="inline-block font-medium text-accent-text hover:underline"
						>
							<Trans>Change timezone</Trans>
						</Link>
					</p>
				</div>
			</Columns>
		</KnowledgeFrame>
	);
}

type UsedRowProps = {
	to: "/dashboard/career" | "/dashboard/career/offers" | "/dashboard/career/coach/{-$conversationId}";
	title: ReactNode;
	subtitle: ReactNode;
};

/** Where an answer goes: a row that opens the place, with a line that may wrap. */
function UsedRow({ to, title, subtitle }: UsedRowProps) {
	return (
		<ListRow render={<Link to={to} />} className="min-h-0 items-start py-3">
			<span className="flex min-w-0 flex-1 flex-col gap-px">
				<span className="t-row-title text-ink">{title}</span>
				<span className="t-small text-ink-3">{subtitle}</span>
			</span>
			<Icon name="caret-right" size={18} className="shrink-0 text-ink-3" />
		</ListRow>
	);
}

/** An input-like box holding a prefix/suffix and a bare input; focus rings the whole box. */
const fieldShell =
	"flex h-10 items-center gap-2 rounded-md border border-control-border bg-raised px-[11px] transition-[border-color,box-shadow] duration-quick focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--accent-soft)] pointer-coarse:h-11";

type ChipFieldProps = {
	label: string;
	/** At the end of the label's line: "optional", or the action that fills the field. */
	hint?: ReactNode;
	placeholder: string;
	value: string[];
	onChange: (value: string[]) => void;
};

/** Enter or comma adds a chip, Backspace in an empty input removes the last one, × removes one. */
export function ChipField({ label, hint, placeholder, value, onChange }: ChipFieldProps) {
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
			{hint ? (
				<div className="flex items-center justify-between gap-2">
					<Label htmlFor={id}>{label}</Label>
					{hint}
				</div>
			) : (
				<Label htmlFor={id}>{label}</Label>
			)}
			<div className={chipFieldClassName}>
				{value.map((chip) => (
					<span key={chip} className={fieldChipClassName}>
						{chip}
						<button
							type="button"
							aria-label={t`Remove ${chip}`}
							onClick={() => onChange(value.filter((item) => item !== chip))}
							className={fieldChipRemoveClassName}
						>
							<Icon name="x" size={14} />
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
					className="h-7 min-w-24 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-ink-3 focus-visible:outline-none"
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

/** Minimum base: currency prefix and period suffix are small selects; the amount gets separators on blur. */
function SalaryField({ id, locale, value, onChange }: SalaryFieldProps) {
	const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
	// While focused the raw typing shows; otherwise the formatted amount.
	const [typing, setTyping] = useState<string | null>(null);
	const [invalid, setInvalid] = useState(false);
	const formatted = value.amount === null ? "" : number.format(value.amount);

	const periods = { hour: t`an hour`, month: t`a month`, year: t`a year` };

	return (
		<div className="grid gap-1.5">
			<Label htmlFor={id}>
				<Trans>Minimum base salary</Trans>
			</Label>
			<span className={cn(fieldShell, "gap-0 ps-0 pe-1")}>
				<CurrencySelect
					value={value.currency}
					onChange={(currency) => onChange({ ...value, currency })}
					className="h-full w-auto gap-0.5 rounded-e-none bg-transparent ps-[11px] pe-1.5 font-normal text-ink-2 shadow-none"
				/>
				<span aria-hidden="true" className="my-2 w-px self-stretch bg-line" />
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
					className="w-full min-w-0 flex-1 bg-transparent ps-2.5 text-sm outline-none focus-visible:outline-none"
				/>
				<span className="relative flex h-full items-center text-ink-2">
					<select
						aria-label={t`Pay period`}
						value={value.period}
						onChange={(event) => onChange({ ...value, period: event.target.value as keyof typeof periods })}
						className="field-sizing-content h-full cursor-pointer appearance-none bg-transparent ps-1 pe-6 text-sm outline-none hover:text-ink focus-visible:text-ink"
					>
						{Object.entries(periods).map(([period, label]) => (
							<option key={period} value={period}>
								{label}
							</option>
						))}
					</select>
					<Icon name="caret-down" size={18} className="pointer-events-none absolute inset-e-1 text-ink-3" />
				</span>
			</span>
			{invalid && (
				<p id={`${id}-error`} role="alert" className="text-xs/4 text-danger-text">
					<Trans>Enter a full amount, such as 95000. Your previous amount is unchanged.</Trans>
				</p>
			)}
		</div>
	);
}
