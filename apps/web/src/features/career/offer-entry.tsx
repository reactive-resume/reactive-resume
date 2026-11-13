import type { SavedData, SavedItem } from "./hooks";
import type { ApplicationSummary } from "@/features/applications/types";
import type { RouterOutput } from "@/libs/orpc/client";
import type { ApplicationStatus } from "@reactive-resume/schema/applications/data";
import type { OfferTerms } from "@reactive-resume/schema/career";
import type { careerOfferInputSchema } from "@reactive-resume/schema/career";
import type { FormEvent, ReactNode } from "react";
import type z from "zod";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { ORPCError } from "@orpc/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { offerTermsSchema } from "@reactive-resume/schema/career";
import {
	bonusEntry,
	offerApplications,
	offerHintFromSalary,
	parseOfferEntry,
	previousOfferCurrency,
} from "@reactive-resume/schema/career-offer";
import { Button, buttonVariants } from "@reactive-resume/ui/components/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@reactive-resume/ui/components/collapsible";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { toast } from "@reactive-resume/ui/components/toast";
import { pendingRequestId, settleRequestId, isolate } from "@reactive-resume/utils/string";
import { cn } from "@reactive-resume/utils/style";
import { CurrencySelect } from "./currency-select";
import { CareerLoadError } from "./load-state";
import { formatMoney } from "./offer-compare";
import { useCareerTime } from "./shared";
import { DateField } from "@/components/ui/date-field";
import { getCategoryLane } from "@/features/applications/lanes";
import {
	applicationsListQueryKey,
	applicationsListQueryOptions,
	savedOffersQueryOptions,
} from "@/features/applications/queries";
import { useMoveWithUndo } from "@/features/applications/use-application-actions";
import { useApplicationLanes } from "@/features/applications/use-application-lanes";
import { getAccountId, getAccountGeneration } from "@/libs/auth/account-scope";
import { client, orpc } from "@/libs/orpc/client";

type Application = {
	id: string;
	company: string;
	role: string;
	status?: ApplicationStatus | undefined;
	closedReason?: string | null;
	/** The job's salary line, to start a new offer's currency and base from. */
	salary?: string | null | undefined;
};
type OfferEntryProps = {
	frame?: ((action: ReactNode) => ReactNode) | undefined;
	application?: Application | undefined;
	primary?: boolean;
	/** Open the form at once ("Add the offer's terms" from a move to Offer). */
	initialOpen?: boolean | undefined;
	/** Called when the form closes, saved or not. */
	onDone?: (() => void) | undefined;
};
type Offer = SavedItem & { data: SavedData<"offer"> };
/** A saved offer as the summary needs it: what createOffer returns, or a row from the saved offers list. */
type OfferLike = Pick<Offer, "id" | "data"> & { application?: { company: string } | null | undefined };

/** Stages before Offer: saving an offer for an application still at one of these moves it to Offer, with Undo. */
const BEFORE_OFFER: readonly ApplicationStatus[] = ["saved", "applied", "screening", "interview"];

/**
 * Add offer, and the offer saved last for this application in view as a one-line summary, so saving doesn't make the
 * terms disappear into Saved.
 */
export function OfferEntry(props: OfferEntryProps) {
	return <ScopedOfferEntry key={props.application?.id ?? "global"} {...props} />;
}
function ScopedOfferEntry({
	application,
	primary = false,
	initialOpen = false,
	onDone,
	frame = (action) => action,
}: OfferEntryProps) {
	const [open, setOpen] = useState(initialOpen);
	const [requested, setRequested] = useState(initialOpen);
	if (initialOpen !== requested) {
		setRequested(initialOpen);
		if (initialOpen) setOpen(true);
	}
	const [justSaved, setJustSaved] = useState<OfferLike | null>(null);
	const offers = useQuery({ ...savedOffersQueryOptions(), enabled: Boolean(application) });
	const latest: OfferLike | undefined =
		justSaved ??
		(application
			? (offers.data ?? [])
					.filter((item): item is Offer => item.data.kind === "offer" && item.applicationId === application.id)
					.toSorted((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
			: undefined);
	const close = () => {
		setOpen(false);
		onDone?.();
	};

	const form = (
		<OfferForm
			sheet={!application}
			application={application}
			onClose={close}
			onSaved={(offer) => {
				if (offer) setJustSaved(offer);
				close();
			}}
		/>
	);
	// Beside one application the form opens in place; the page-level Add offer is a long form, so it takes a sheet
	// and leaves the page as it was (DESIGN.md: dialog, sheet or inline).
	if (open && application) return form;
	const sheet = !application && (
		<OfferSheet open={open} onClose={close}>
			{form}
		</OfferSheet>
	);
	const variant = primary ? "primary" : "secondary";
	const add = (
		<Button variant={variant} className="w-fit" onClick={() => setOpen(true)}>
			{!application && <Icon name="plus" />}
			{latest && application ? <Trans>Add a newer offer</Trans> : <Trans>Add offer</Trans>}
		</Button>
	);
	const action = application ? add : <FirstApplication variant={variant}>{add}</FirstApplication>;
	return latest ? (
		<div className="grid gap-3">
			<OfferSummary offer={latest} />
			{frame(action)}
			{sheet}
		</div>
	) : (
		<>
			{frame(action)}
			{sheet}
		</>
	);
}

type OfferSheetProps = { open: boolean; onClose: () => void; children: ReactNode };

/** The offer form over the page: a 560 dialog, a bottom sheet on phones. The form inside names the dialog. */
export function OfferSheet({ open, onClose, children }: OfferSheetProps) {
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<DialogContent closeLabel={t`Close`} className="sm:max-w-[560px]">
				{children}
			</DialogContent>
		</Dialog>
	);
}

const periodLabel = (period: OfferTerms["period"]) =>
	({ year: t`a year`, month: t`a month`, hour: t`an hour` })[period];

/** "Written offer · €182,000 a year · respond by Thu 12 Nov · Compare" */
function OfferSummary({ offer }: { offer: OfferLike }) {
	const { locale, day } = useCareerTime();
	const { data } = offer;
	const parts = [
		data.version === "verbal" ? t`Verbal offer` : t`Written offer`,
		data.base === null ? null : `${formatMoney(locale, data.currency, data.base)} ${periodLabel(data.period)}`,
		data.respondBy ? t`respond by ${day(data.respondBy)}` : null,
	].filter(Boolean);

	return (
		<div
			role="status"
			className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-line bg-surface px-3 py-2.5 text-sm"
		>
			<Icon name="scales" size={18} className="text-ink-2" />
			<span className="min-w-0 flex-1">
				{offer.application?.company ? <b className="font-semibold">{offer.application.company} · </b> : null}
				{parts.join(" · ")}
			</span>
			<Link
				to="/dashboard/career/offers"
				search={{ a: offer.id }}
				className="text-sm font-medium text-accent-text hover:underline"
			>
				<Trans>Compare</Trans>
			</Link>
		</div>
	);
}

type FirstApplicationProps = { variant: "primary" | "secondary"; children: ReactNode };

/** An offer belongs to an application, so with none yet "Add offer" leads to adding one instead. */
function FirstApplication({ variant, children }: FirstApplicationProps) {
	const applications = useQuery(applicationsListQueryOptions());
	if (applications.isError && !applications.data?.length)
		return <CareerLoadError onRetry={() => void applications.refetch()} />;
	if (applications.isPending) return <Skeleton className="h-9 w-40" />;
	if (applications.data?.length !== 0) return children;
	return (
		<Link to="/dashboard/applications" search={{ create: true }} className={buttonVariants({ variant })}>
			<Trans>Add an application first</Trans>
		</Link>
	);
}

/** A saved offer being corrected: its terms as stored, which the save sends back as the copy it changed. */
type EditedOffer = { id: string; applicationId: string | null; data: OfferTerms };

type OfferFormProps = OfferEntryProps & {
	offer?: EditedOffer;
	/** Inside `OfferSheet`: the title names the sheet and the buttons sit in its footer. */
	sheet?: boolean;
	onClose: () => void;
	onSaved?: (offer: OfferLike | null) => void;
};

/** The stored terms alone: what a correction replaces and what it expects to find. */
const offerTerms = (data: OfferTerms) => offerTermsSchema.parse(data);

/** "2026-11-20" and "17:00" in the account's timezone, for the date and time fields. */
const zonedFields = (value: string, timeZone: string) => {
	const at = new Date(value);
	const date = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
		at,
	);
	const time = new Intl.DateTimeFormat("en-GB", {
		timeZone,
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).format(at);
	return { date, time };
};

export function OfferForm({ application, offer: initialOffer, sheet = false, onClose, onSaved }: OfferFormProps) {
	// Draft and expected terms belong to the same edit session, even when the comparison refetches.
	const [offer] = useState(initialOffer);
	const mounted = useRef(true);
	useLayoutEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const id = useId();
	const router = useRouter();
	const [pathname] = useState(() => router.state.location.pathname);
	const currentView = () => mounted.current && router.state.location.pathname === pathname;
	const navigate = useNavigate();
	const search = useSearch({ strict: false });
	const [owner] = useState(() => ({ id: getAccountId(), generation: getAccountGeneration() }));
	const current = () => getAccountId() === owner.id && getAccountGeneration() === owner.generation;
	const { locale, timeZone } = useCareerTime();
	const queryClient = useQueryClient();
	const moveWithUndo = useMoveWithUndo();
	const { lanes } = useApplicationLanes();
	const applications = useQuery({ ...applicationsListQueryOptions(), enabled: !application && !offer });
	const [applicationId, setApplicationId] = useState(application?.id ?? offer?.applicationId ?? "");
	// A new offer for a job starts from the job's own salary line: its currency, its pay period, and the low end as an
	// editable base.
	const chosen = application ?? applications.data?.find((row) => row.id === applicationId);
	const hint = offer ? null : offerHintFromSalary(chosen?.salary);
	const [draft, setTerms] = useState(() =>
		offer
			? offerTerms(offer.data)
			: {
					...offerTermsSchema.parse({ currency: "USD", period: hint?.period ?? "year", base: null, variable: null }),
					currency: "",
				},
	);
	const amount = (value: number | null | undefined) => (value === null || value === undefined ? "" : String(value));
	const [amounts, setAmounts] = useState(() => ({
		base: amount(offer ? offer.data.base : hint?.base),
		variable: offer ? bonusEntry(offer.data, locale) : "",
		learning: amount(offer?.data.learning),
	}));
	// What the job's salary filled in, so an untouched sheet isn't "changed" and choosing another job refills it.
	const [seed, setSeed] = useState(() => (offer ? "" : amount(hint?.base)));
	const [periodTyped, setPeriodTyped] = useState(false);
	const chooseApplication = (id: string) => {
		setApplicationId(id);
		if (offer) return;
		const next = offerHintFromSalary(applications.data?.find((row) => row.id === id)?.salary);
		const nextSeed = amount(next.base);
		if (amounts.base === seed) setAmounts((current) => ({ ...current, base: nextSeed }));
		setSeed(nextSeed);
	};
	const deadline = offer?.data.respondBy ? zonedFields(offer.data.respondBy, timeZone) : null;
	const [date, setDate] = useState(deadline?.date ?? "");
	const [time, setTime] = useState(deadline?.time ?? "17:00");

	const savedOffers = useQuery(orpc.career.savedItems.queryOptions({ input: { kind: "offer" } }));
	const [currencyTyped, setCurrencyTyped] = useState(false);
	const [previousCurrency, setPreviousCurrency] = useState<string>();
	if (previousCurrency === undefined && savedOffers.data) {
		const currency = previousOfferCurrency(savedOffers.data);
		if (currency) setPreviousCurrency(currency);
	}
	// A new offer starts in the last offer's currency, else the one the user's minimum salary is in (Preferences).
	const { data: profile } = useQuery(orpc.career.profile.queryOptions());
	const preferred = profile?.minBase.amount === null ? undefined : profile?.minBase.currency;
	const terms = {
		...draft,
		currency: offer || currencyTyped ? draft.currency : (hint?.currency ?? previousCurrency ?? preferred ?? ""),
		period:
			offer || periodTyped
				? draft.period
				: (hint?.period ?? (hint?.base != null ? "year" : (profile?.minBase.period ?? "year"))),
	};
	const [more, setMore] = useState(Boolean(offer));
	const [submitted, setSubmitted] = useState(false);
	const change = (patch: Partial<OfferTerms>) => setTerms((current) => ({ ...current, ...patch }));
	const [touched, setTouched] = useState<Record<string, boolean>>({});
	const touch = (key: string) => setTouched((current) => ({ ...current, [key]: true }));
	const { payload, amountErrors, deadlineError } = parseOfferEntry({
		applicationId,
		terms,
		amounts,
		date,
		time,
		locale,
		timeZone,
	});
	const deadlineMessage = deadlineError ? t`Choose a valid date and time in ${timeZone}, or clear the deadline.` : null;
	const showDeadlineError = !!deadlineMessage && (submitted || touched.deadline);
	const rememberOffer = (saved: NonNullable<RouterOutput["career"]["createOffer"]>) => {
		if (!current()) return;
		const target = application ?? applications.data?.find((row) => row.id === saved.applicationId);
		// Publish the save receipt before navigation; a slow or failed list refresh cannot select the old offer again.
		queryClient.setQueryData<SavedItem[]>(orpc.career.savedItems.queryKey({ input: { kind: "offer" } }), (items) => [
			{
				...saved,
				submission: false,
				outdated: false,
				application:
					items?.find((item) => item.applicationId === saved.applicationId)?.application ??
					(target
						? {
								company: target.company,
								role: target.role,
								status: target.status ?? null,
								closedReason: target.closedReason ?? null,
							}
						: null),
			},
			...(items ?? []).filter((item) => item.id !== saved.id),
		]);
		void queryClient.invalidateQueries({ queryKey: orpc.career.savedItems.key() });
	};
	const create = useMutation({
		...orpc.career.createOffer.mutationOptions(),
		onSuccess: (offer, input) => {
			if (!current()) return;
			if (offer) rememberOffer(offer);
			if (!application && offer && currentView())
				void navigate({ to: "/dashboard/career/offers", search: { a: offer.id, b: search.b, highlight: offer.id } });
			const row = (
				applications.data ?? queryClient.getQueryData<ApplicationSummary[]>(applicationsListQueryKey())
			)?.find((item) => item.id === input.applicationId);
			const target = application ?? row;
			const status = application?.status ?? row?.status;
			if (target && status && BEFORE_OFFER.includes(status)) {
				// An offer means the application is at Offer; Undo keeps the offer and leaves the stage where it was.
				moveWithUndo({
					applications: [{ id: input.applicationId }],
					lane: getCategoryLane(lanes, "offer"),
					description: t`Offer saved. ${isolate(target.company)} moved to Offer.`,
				});
			} else {
				toast.add({ description: t`Offer saved` });
			}
			if (currentView())
				onSaved?.(
					offer?.data.kind === "offer"
						? { id: offer.id, data: offer.data, ...(target ? { application: { company: target.company } } : {}) }
						: null,
				);
			if (!onSaved && currentView()) onClose();
		},
	});
	const update = useMutation({
		...orpc.career.updateOffer.mutationOptions(),
		mutationFn: async (input: Parameters<typeof client.career.updateOffer>[0]) => {
			if (!current() || !owner.id) throw new Error("Account changed");
			const key = JSON.stringify(["career:offer-version", owner.id, input]);
			const newId = pendingRequestId(key, sessionStorage);
			const result = await client.career.updateOffer({ ...input, newId }, { context: { accountId: owner.id } });
			settleRequestId(key, sessionStorage, newId);
			return result;
		},
		onSuccess: (offer) => {
			if (!current()) return;
			rememberOffer(offer);
			if (!currentView()) return;
			void navigate({ to: "/dashboard/career/offers", search: { a: offer.id, b: search.b, highlight: offer.id } });
			toast.add({ description: t`New offer version saved` });
			onClose();
		},
	});
	const save = offer ? update : create;
	const submitPayload = (data: z.infer<typeof careerOfferInputSchema>) => {
		if (!current()) return;
		if (!offer) return create.mutate(data);
		const { applicationId: _applicationId, ...changed } = data;
		// The copy this form started from: a change made elsewhere since is a conflict, not overwritten.
		update.mutate({ id: offer.id, terms: changed, expected: offerTerms(offer.data), newVersion: true });
	};
	const currencyInvalid = (submitted || touched.currency) && !/^[A-Z]{3}$/.test(terms.currency);
	const field = "grid content-start gap-1.5";
	const amountField = (key: "base" | "variable" | "learning", label: string, className: string) => {
		const invalid = (submitted || touched[key]) && amountErrors[key];
		return (
			<div className={cn(field, className)}>
				<Label htmlFor={`${id}-${key}`}>{label}</Label>
				<Input
					id={`${id}-${key}`}
					inputMode="decimal"
					value={amounts[key]}
					onBlur={() => touch(key)}
					aria-invalid={invalid}
					aria-describedby={
						key === "variable"
							? `${id}-variable-hint${invalid ? ` ${id}-${key}-error` : ""}`
							: invalid
								? `${id}-${key}-error`
								: undefined
					}
					onChange={(event) => setAmounts((current) => ({ ...current, [key]: event.target.value }))}
				/>
				{invalid && (
					<span id={`${id}-${key}-error`} className="flex items-start gap-1.5 text-xs text-danger-text">
						<Icon name="warning-circle" size={16} />
						<span>
							{key === "variable"
								? t`Enter an amount or a percentage such as 10%, or leave blank.`
								: t`Enter a full amount, such as 95000, or leave blank.`}
						</span>
					</span>
				)}
			</div>
		);
	};
	const textField = (
		key: "variableConditions" | "equity" | "location" | "leave" | "other",
		label: string,
		max: number,
		className: string,
		placeholder?: string,
	) => (
		<div className={cn(field, className)}>
			<Label htmlFor={`${id}-${key}`}>{label}</Label>
			<Input
				id={`${id}-${key}`}
				value={terms[key]}
				maxLength={max}
				placeholder={placeholder}
				onChange={(event) => change({ [key]: event.target.value })}
			/>
		</div>
	);

	const title = offer ? <Trans>Edit offer terms</Trans> : <Trans>Add offer</Trans>;
	const description = offer ? (
		<Trans>Save corrected terms as a new version. The previous version stays available. No AI request is made.</Trans>
	) : (
		<Trans>You enter the terms yourself and no AI request is made. Leave unknown amounts blank.</Trans>
	);

	const fields = (
		<>
			<fieldset disabled={save.isPending} className="grid items-start gap-x-3 gap-y-4 sm:grid-cols-12">
				<div className={cn(field, "sm:col-span-12")}>
					<Label htmlFor={`${id}-application`}>
						<Trans>Application</Trans>
					</Label>
					<NativeSelect
						id={`${id}-application`}
						value={applicationId}
						disabled={!!application || !!offer}
						onBlur={() => touch("application")}
						aria-invalid={submitted && !applicationId}
						onChange={(event) => chooseApplication(event.target.value)}
						required
					>
						<option value="">{t`Choose an application`}</option>
						{(application ? [application] : offerApplications(applications.data ?? [])).map((row) => (
							<option key={row.id} value={row.id}>
								{row.company} · {row.role} ·{" "}
								{row.closedReason === "accepted"
									? t`Accepted`
									: row.status === "offer"
										? t`Offer`
										: row.status === "closed"
											? t`Closed`
											: t`In progress`}
							</option>
						))}
					</NativeSelect>
				</div>

				<div className={cn(field, "sm:col-span-5")}>
					<Label id={`${id}-version`}>
						<Trans>Offer type</Trans>
					</Label>
					<SegmentedControl
						aria-labelledby={`${id}-version`}
						value={terms.version}
						onValueChange={(version) => change({ version: version as OfferTerms["version"] })}
						className="h-10 w-full"
					>
						<SegmentedControlItem value="written">
							<Trans context="Offer type: an offer made in writing">Written</Trans>
						</SegmentedControlItem>
						<SegmentedControlItem value="verbal">
							<Trans context="Offer type: an offer made in conversation">Verbal</Trans>
						</SegmentedControlItem>
					</SegmentedControl>
				</div>
				<div className={cn(field, "sm:col-span-4")}>
					<Label htmlFor={`${id}-date`}>
						<Trans>Respond by</Trans>
					</Label>
					<DateField
						id={`${id}-date`}
						type="date"
						value={date}
						onBlur={() => touch("deadline")}
						aria-invalid={showDeadlineError}
						aria-describedby={showDeadlineError ? `${id}-deadline-error` : undefined}
						onChange={(event) => setDate(event.target.value)}
					/>
				</div>
				<div className={cn(field, "sm:col-span-3")}>
					<Label htmlFor={`${id}-time`}>
						<Trans>Time</Trans>
					</Label>
					<DateField
						id={`${id}-time`}
						type="time"
						onBlur={() => touch("deadline")}
						aria-invalid={showDeadlineError}
						aria-describedby={`${id}-time-zone${showDeadlineError ? ` ${id}-deadline-error` : ""}`}
						// The deadline's time only counts with a date; it is ready before one is chosen.
						required={Boolean(date)}
						value={time}
						onChange={(event) => setTime(event.target.value)}
					/>
				</div>

				{amountField("base", t`Base salary`, "sm:col-span-6 sm:col-start-1")}
				<div className={cn(field, "sm:col-span-3")}>
					<Label htmlFor={`${id}-currency`}>
						<Trans>Currency</Trans>
					</Label>
					<CurrencySelect
						symbol={false}
						id={`${id}-currency`}
						value={terms.currency}
						invalid={currencyInvalid}
						describedBy={`${id}-currency-hint`}
						className="h-10 w-full justify-start font-normal"
						onChange={(currency) => {
							setCurrencyTyped(true);
							touch("currency");
							change({ currency });
						}}
					/>
					{/* A hint, not a placeholder: a placeholder "EUR" reads as a currency already chosen. */}
					<p
						id={`${id}-currency-hint`}
						className={currencyInvalid ? "flex items-start gap-1.5 text-xs text-danger-text" : "sr-only"}
					>
						{currencyInvalid && <Icon name="warning-circle" size={16} />}
						<span>{t`Choose a currency.`}</span>
					</p>
				</div>
				<div className={cn(field, "sm:col-span-3")}>
					<Label htmlFor={`${id}-period`}>
						<Trans>Pay period</Trans>
					</Label>
					<NativeSelect
						id={`${id}-period`}
						value={terms.period}
						onChange={(event) => {
							setPeriodTyped(true);
							change({ period: event.target.value as OfferTerms["period"] });
						}}
					>
						<option value="year">{t`Per year`}</option>
						<option value="month">{t`Per month`}</option>
						<option value="hour">{t`Per hour`}</option>
					</NativeSelect>
				</div>

				{amountField("variable", t`Bonus`, "sm:col-span-4")}
				{amountField("learning", t`Learning budget`, "sm:col-span-4")}
				<div className={cn(field, "sm:col-span-4")}>
					<Label htmlFor={`${id}-office`}>
						<Trans>Office days a week</Trans>
					</Label>
					<NativeSelect
						id={`${id}-office`}
						value={terms.officeDays ?? ""}
						onChange={(event) => change({ officeDays: event.target.value === "" ? null : Number(event.target.value) })}
					>
						<option value="">{t`Unknown`}</option>
						{[0, 1, 2, 3, 4, 5].map((days) => (
							<option key={days} value={days}>
								{/* The word Preferences uses for no office days. */}
								{days === 0 ? t`Remote (0)` : days}
							</option>
						))}
					</NativeSelect>
				</div>

				<Collapsible open={more} onOpenChange={setMore} className="col-span-full">
					<CollapsibleTrigger className="group/more flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-xs text-sm font-medium text-ink">
						<Icon
							name="caret-right"
							size={16}
							className="shrink-0 transition-transform duration-standard ease-enter group-data-panel-open/more:rotate-90"
						/>
						<span className="shrink-0">
							<Trans>More terms</Trans>
						</span>
						{/* What the fold holds, for the eye; its fields are read once it opens. */}
						<span aria-hidden="true" className="ms-auto min-w-0 truncate text-[13px]/[18px] font-normal text-ink-3">
							<Trans>Equity · bonus conditions · where you work · leave · other benefits</Trans>
						</span>
					</CollapsibleTrigger>
					<CollapsibleContent hiddenUntilFound>
						<div className="grid items-start gap-x-3 gap-y-4 pt-3 sm:grid-cols-12">
							{textField(
								"variableConditions",
								t`Bonus conditions`,
								1000,
								"sm:col-span-12",
								t`What it depends on, when it is paid`,
							)}
							{textField("equity", t`Equity`, 1000, "sm:col-span-12")}
							{textField("location", t`Where you work`, 500, "sm:col-span-8")}
							{textField("leave", t`Leave`, 500, "sm:col-span-4")}
							{textField("other", t`Other benefits`, 1000, "sm:col-span-12", t`Pension, allowances, equipment`)}
						</div>
					</CollapsibleContent>
				</Collapsible>
			</fieldset>
			<p className="text-xs/4 text-ink-3">
				<span id={`${id}-variable-hint`}>{t`Bonus takes an amount or a share of base, such as 10%.`}</span>
				{date && (
					<>
						{" "}
						<span id={`${id}-time-zone`}>{t`Times are shown in ${timeZone}.`}</span>
					</>
				)}
			</p>
			{!application && applications.isError && <CareerLoadError onRetry={() => void applications.refetch()} />}
			{!application && applications.data?.length === 0 && (
				<Link
					to="/dashboard/applications"
					search={{ create: true }}
					className="w-fit text-sm text-accent-text underline"
				>
					<Trans>Add an application first</Trans>
				</Link>
			)}
			{showDeadlineError && (
				<p id={`${id}-deadline-error`} role="alert" className="flex items-start gap-1.5 text-sm text-danger-text">
					<Icon name="warning-circle" size={18} />
					<span>{deadlineMessage}</span>
				</p>
			)}
			{submitted && !payload.success && (
				<p role="alert" className="flex items-start gap-1.5 text-sm text-danger-text">
					<Icon name="warning-circle" size={18} />
					{/* Only what applies: a chosen application isn't asked for again. */}
					{applicationId ? (
						<Trans>Correct the highlighted fields before saving.</Trans>
					) : (
						<Trans>Choose an application before saving.</Trans>
					)}
				</p>
			)}
			{save.isError && (
				<p role="alert" className="flex items-start gap-1.5 text-sm text-danger-text">
					<Icon name="warning-circle" size={18} />
					{/* A conflict says the offer changed elsewhere; anything else keeps the draft and asks to retry. */}
					{save.error instanceof ORPCError && save.error.code === "CONFLICT"
						? save.error.message
						: t`Couldn't save the offer. Your draft is still here. Try again.`}
				</p>
			)}
		</>
	);
	const actions = (
		<>
			<Button variant="ghost" disabled={save.isPending} onClick={onClose}>
				<Trans>Cancel</Trans>
			</Button>
			<Button type="submit" loading={save.isPending}>
				{save.isPending ? <Trans>Saving…</Trans> : <Trans>Save offer</Trans>}
			</Button>
		</>
	);
	const onSubmit = (event: FormEvent) => {
		event.preventDefault();
		setSubmitted(true);
		if (payload.success && !save.isPending) submitPayload(payload.data);
	};

	if (sheet)
		return (
			<form noValidate className="grid min-w-0 gap-5 text-start" onSubmit={onSubmit}>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				{fields}
				<DialogFooter>{actions}</DialogFooter>
			</form>
		);

	return (
		<form
			noValidate
			className="grid w-full gap-4 rounded-xl border border-line bg-surface p-5 text-start"
			onSubmit={onSubmit}
		>
			<div className="grid gap-1">
				<h2 className="t-section-title">{title}</h2>
				<p className="text-sm/5 text-ink-3">{description}</p>
			</div>
			{fields}
			<div className="flex justify-end gap-2">{actions}</div>
		</form>
	);
}
