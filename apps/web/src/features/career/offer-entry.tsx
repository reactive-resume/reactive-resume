import type { SavedData, SavedItem } from "./hooks";
import type { ApplicationSummary } from "@/features/applications/types";
import type { ApplicationStatus } from "@reactive-resume/schema/applications/data";
import type { OfferTerms } from "@reactive-resume/schema/career";
import type { careerOfferInputSchema } from "@reactive-resume/schema/career";
import type { ReactNode } from "react";
import type z from "zod";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { ORPCError } from "@orpc/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useId, useState } from "react";
import { offerTermsSchema } from "@reactive-resume/schema/career";
import { offerApplications, parseOfferEntry, previousOfferCurrency } from "@reactive-resume/schema/career-offer";
import { Button, buttonVariants } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { CareerLoadError } from "./load-state";
import { formatMoney } from "./offer-compare";
import { useCareerTime } from "./shared";
import { getCategoryLane } from "@/features/applications/lanes";
import {
	applicationsListQueryKey,
	applicationsListQueryOptions,
	savedOffersQueryOptions,
} from "@/features/applications/queries";
import { useMoveWithUndo } from "@/features/applications/use-application-actions";
import { useApplicationLanes } from "@/features/applications/use-application-lanes";
import { MoreOptions } from "@/features/resume/editor/write/fields";
import { orpc } from "@/libs/orpc/client";

type Application = {
	id: string;
	company: string;
	role: string;
	status?: ApplicationStatus | undefined;
	closedReason?: string | null;
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

	if (open)
		return (
			<OfferForm
				application={application}
				onClose={close}
				onSaved={(offer) => {
					if (offer) setJustSaved(offer);
					close();
				}}
			/>
		);
	const variant = primary ? "primary" : "secondary";
	const add = (
		<Button variant={variant} className="w-fit" onClick={() => setOpen(true)}>
			{latest && application ? <Trans>Add a newer offer</Trans> : <Trans>Add offer</Trans>}
		</Button>
	);
	const action = application ? add : <FirstApplication variant={variant}>{add}</FirstApplication>;
	return latest ? (
		<div className="grid gap-3">
			<OfferSummary offer={latest} />
			{frame(action)}
		</div>
	) : (
		frame(action)
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

export function OfferForm({ application, offer: initialOffer, onClose, onSaved }: OfferFormProps) {
	// Draft and expected terms belong to the same edit session, even when the comparison refetches.
	const [offer] = useState(initialOffer);
	const id = useId();
	const navigate = useNavigate();
	const { locale, timeZone } = useCareerTime();
	const queryClient = useQueryClient();
	const moveWithUndo = useMoveWithUndo();
	const { lanes } = useApplicationLanes();
	const applications = useQuery({ ...applicationsListQueryOptions(), enabled: !application && !offer });
	const [applicationId, setApplicationId] = useState(application?.id ?? offer?.applicationId ?? "");
	const [draft, setTerms] = useState(() =>
		offer
			? offerTerms(offer.data)
			: { ...offerTermsSchema.parse({ currency: "USD", period: "year", base: null, variable: null }), currency: "" },
	);
	const amount = (value: number | null | undefined) => (value === null || value === undefined ? "" : String(value));
	const [amounts, setAmounts] = useState(() => ({
		base: amount(offer?.data.base),
		variable: amount(offer?.data.variable),
		learning: amount(offer?.data.learning),
	}));
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
	const terms = offer || currencyTyped ? draft : { ...draft, currency: previousCurrency ?? "" };
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
	const create = useMutation({
		...orpc.career.createOffer.mutationOptions(),
		onSuccess: (offer, input) => {
			if (!application && offer) void navigate({ to: "/dashboard/career/offers", search: { a: offer.id } });
			void queryClient.invalidateQueries({ queryKey: orpc.career.savedItems.key() });
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
					description: t`Offer saved. ${target.company} moved to Offer.`,
				});
			} else {
				toast.add({ description: t`Offer saved` });
			}
			onSaved?.(
				offer?.data.kind === "offer"
					? { id: offer.id, data: offer.data, ...(target ? { application: { company: target.company } } : {}) }
					: null,
			);
			if (!onSaved) onClose();
		},
	});
	const update = useMutation({
		...orpc.career.updateOffer.mutationOptions(),
		onSettled: () => void queryClient.invalidateQueries({ queryKey: orpc.career.savedItems.key() }),
		onSuccess: () => {
			toast.add({ description: t`Offer terms updated` });
			onClose();
		},
	});
	const save = offer ? update : create;
	const submitPayload = (data: z.infer<typeof careerOfferInputSchema>) => {
		if (!offer) return create.mutate(data);
		const { applicationId: _applicationId, ...changed } = data;
		// The copy this form started from: a change made elsewhere since is a conflict, not overwritten.
		update.mutate({ id: offer.id, terms: changed, expected: offerTerms(offer.data) });
	};
	const textFields = [
		{ key: "variableConditions", label: t`Bonus conditions`, max: 1000 },
		{ key: "equity", label: t`Equity`, max: 1000 },
		{ key: "location", label: t`Where you work`, max: 500 },
		{ key: "leave", label: t`Leave`, max: 500 },
		{ key: "other", label: t`Other benefits`, max: 1000 },
	] as const;
	const currencyInvalid = (submitted || touched.currency) && !/^[A-Z]{3}$/.test(terms.currency);
	const amountField = (key: "base" | "variable" | "learning", label: string) => {
		const invalid = (submitted || touched[key]) && amountErrors[key];
		return (
			<div className="grid gap-1.5 [&>label]:text-xs [&>label]:font-medium [&>label]:text-ink-2">
				<label htmlFor={`${id}-${key}`}>{label}</label>
				<Input
					id={`${id}-${key}`}
					inputMode="decimal"
					value={amounts[key]}
					onBlur={() => touch(key)}
					aria-invalid={invalid}
					aria-describedby={invalid ? `${id}-${key}-error` : undefined}
					onChange={(event) => setAmounts((current) => ({ ...current, [key]: event.target.value }))}
				/>
				{invalid && (
					<span id={`${id}-${key}-error`} className="flex items-start gap-1.5 text-xs text-danger-text">
						<Icon name="warning-circle" />
						<span>{t`Enter a full amount, such as 95000, or leave blank.`}</span>
					</span>
				)}
			</div>
		);
	};
	return (
		<form
			noValidate
			className="grid w-full gap-4 rounded-xl border border-line bg-surface p-4 text-start"
			onSubmit={(event) => {
				event.preventDefault();
				setSubmitted(true);
				if (amountErrors.variable || amountErrors.learning) setMore(true);
				if (payload.success && !save.isPending) submitPayload(payload.data);
			}}
		>
			<h2 className="text-base font-semibold">{offer ? <Trans>Edit offer terms</Trans> : <Trans>Add offer</Trans>}</h2>
			<p className="text-sm text-ink-2">
				{offer ? (
					<Trans>Correct the terms yourself. No AI request is made. Leave unknown amounts blank.</Trans>
				) : (
					<Trans>Enter terms yourself. No AI request is made. Leave unknown amounts blank.</Trans>
				)}
			</p>
			<fieldset disabled={save.isPending} className="grid items-start gap-3 sm:grid-cols-2">
				<div className="grid gap-1.5 sm:col-span-2 [&>label]:text-xs [&>label]:font-medium [&>label]:text-ink-2">
					<label htmlFor={`${id}-application`}>
						<Trans>Application</Trans>
					</label>
					<NativeSelect
						id={`${id}-application`}
						value={applicationId}
						disabled={!!application || !!offer}
						onBlur={() => touch("application")}
						aria-invalid={submitted && !applicationId}
						onChange={(event) => setApplicationId(event.target.value)}
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
				<div className="grid gap-1.5 [&>label]:text-xs [&>label]:font-medium [&>label]:text-ink-2">
					<label htmlFor={`${id}-currency`}>
						<Trans>Currency</Trans>
					</label>
					<Input
						id={`${id}-currency`}
						value={terms.currency}
						maxLength={3}
						required
						pattern="[A-Z]{3}"
						onBlur={() => touch("currency")}
						aria-invalid={currencyInvalid}
						aria-describedby={`${id}-currency-hint`}
						onChange={(event) => {
							setCurrencyTyped(true);
							change({ currency: event.target.value.toUpperCase() });
						}}
					/>
					{/* A hint, not a placeholder: a placeholder "EUR" reads as a currency already chosen. */}
					<p
						id={`${id}-currency-hint`}
						className={cn("flex items-start gap-1.5 text-xs", currencyInvalid ? "text-danger-text" : "text-ink-3")}
					>
						{currencyInvalid && <Icon name="warning-circle" />}
						<span>{t`Enter a three-letter currency code.`}</span>
					</p>
				</div>
				<div className="grid gap-1.5 [&>label]:text-xs [&>label]:font-medium [&>label]:text-ink-2">
					<label htmlFor={`${id}-period`}>
						<Trans>Pay period</Trans>
					</label>
					<NativeSelect
						id={`${id}-period`}
						value={terms.period}
						onChange={(event) => change({ period: event.target.value as OfferTerms["period"] })}
					>
						<option value="year">{t`Per year`}</option>
						<option value="month">{t`Per month`}</option>
						<option value="hour">{t`Per hour`}</option>
					</NativeSelect>
				</div>
				{amountField("base", t`Base salary`)}
				<div className="grid gap-1.5 sm:col-start-1 [&>label]:text-xs [&>label]:font-medium [&>label]:text-ink-2">
					<label htmlFor={`${id}-date`}>
						<Trans>Respond by</Trans>
					</label>
					<Input
						id={`${id}-date`}
						type="date"
						value={date}
						onBlur={() => touch("deadline")}
						aria-invalid={showDeadlineError}
						aria-describedby={showDeadlineError ? `${id}-deadline-error` : undefined}
						onChange={(event) => setDate(event.target.value)}
					/>
				</div>
				{date && (
					<div className="grid gap-1.5 [&>label]:text-xs [&>label]:font-medium [&>label]:text-ink-2">
						<label htmlFor={`${id}-time`}>
							<Trans>Time</Trans>
						</label>
						<Input
							id={`${id}-time`}
							type="time"
							onBlur={() => touch("deadline")}
							aria-invalid={showDeadlineError}
							aria-describedby={`${id}-time-zone${showDeadlineError ? ` ${id}-deadline-error` : ""}`}
							required
							value={time}
							onChange={(event) => setTime(event.target.value)}
						/>
						<p id={`${id}-time-zone`} className="text-xs text-ink-3">
							{t`Times are shown in ${timeZone}.`}
						</p>
					</div>
				)}
				<MoreOptions open={more} onOpenChange={setMore}>
					<div className="grid items-start gap-3 sm:grid-cols-2">
						<div className="grid gap-1.5 [&>label]:text-xs [&>label]:font-medium [&>label]:text-ink-2">
							<label htmlFor={`${id}-version`}>
								<Trans>Offer type</Trans>
							</label>
							<NativeSelect
								id={`${id}-version`}
								value={terms.version}
								onChange={(event) => change({ version: event.target.value as OfferTerms["version"] })}
							>
								<option value="written">{t`Written offer`}</option>
								<option value="verbal">{t`Verbal offer`}</option>
							</NativeSelect>
						</div>
						{amountField("variable", t`Bonus`)}
						{amountField("learning", t`Learning budget`)}
						<div className="grid gap-1.5 [&>label]:text-xs [&>label]:font-medium [&>label]:text-ink-2">
							<label htmlFor={`${id}-office`}>
								<Trans>Office days per week</Trans>
							</label>
							<NativeSelect
								id={`${id}-office`}
								value={terms.officeDays ?? ""}
								onChange={(event) =>
									change({ officeDays: event.target.value === "" ? null : Number(event.target.value) })
								}
							>
								<option value="">{t`Unknown`}</option>
								{[0, 1, 2, 3, 4, 5].map((days) => (
									<option key={days} value={days}>
										{days}
									</option>
								))}
							</NativeSelect>
						</div>
						{textFields.map(({ key, label, max }) => (
							<div key={key} className="grid gap-1.5 [&>label]:text-xs [&>label]:font-medium [&>label]:text-ink-2">
								<label htmlFor={`${id}-${key}`}>{label}</label>
								<Input
									id={`${id}-${key}`}
									value={terms[key]}
									maxLength={max}
									onChange={(event) => change({ [key]: event.target.value })}
								/>
							</div>
						))}
					</div>
				</MoreOptions>
			</fieldset>
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
					<Icon name="warning-circle" />
					<span>{deadlineMessage}</span>
				</p>
			)}
			{submitted && !payload.success && (
				<p role="alert" className="text-sm text-danger-text">
					<Icon name="warning-circle" />{" "}
					<Trans>Choose an application and correct the highlighted fields before saving.</Trans>
				</p>
			)}
			{save.isError && (
				<p role="alert" className="text-sm text-danger-text">
					<Icon name="warning-circle" />{" "}
					{/* A conflict says the offer changed elsewhere; anything else keeps the draft and asks to retry. */}
					{save.error instanceof ORPCError && save.error.code === "CONFLICT"
						? save.error.message
						: t`Couldn't save the offer. Your draft is still here. Try again.`}
				</p>
			)}
			<div className="flex gap-2">
				<Button type="submit" loading={save.isPending}>
					{save.isPending ? <Trans>Saving…</Trans> : <Trans>Save offer</Trans>}
				</Button>
				<Button variant="ghost" disabled={save.isPending} onClick={onClose}>
					<Trans>Cancel</Trans>
				</Button>
			</div>
		</form>
	);
}
