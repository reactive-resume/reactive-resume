import type { OfferTerms } from "@reactive-resume/schema/career";
import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
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
import { useCareerTime } from "./shared";
import { applicationsListQueryOptions } from "@/features/applications/queries";
import { MoreOptions } from "@/features/resume/editor/write/fields";
import { orpc } from "@/libs/orpc/client";

type Application = { id: string; company: string; role: string; status?: string; closedReason?: string | null };
type OfferEntryProps = {
	application?: Application;
	primary?: boolean;
	/** Where the closed entry's action sits, e.g. an empty state. The open form takes the frame's place. */
	frame?: (action: ReactNode) => ReactNode;
};

/** "Add offer", which opens the form in its place. */
export function OfferEntry({ application, primary = false, frame = (action) => action }: OfferEntryProps) {
	const [open, setOpen] = useState(false);
	if (open) return <OfferForm {...(application ? { application } : {})} onClose={() => setOpen(false)} />;

	const variant = primary ? "primary" : "secondary";
	const add = (
		<Button variant={variant} onClick={() => setOpen(true)}>
			<Trans>Add offer</Trans>
		</Button>
	);
	return frame(application ? add : <FirstApplication variant={variant}>{add}</FirstApplication>);
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

type OfferFormProps = { application?: Application; onClose: () => void };
function OfferForm({ application, onClose }: OfferFormProps) {
	const id = useId();
	const navigate = useNavigate();
	const { locale, timeZone } = useCareerTime();
	const queryClient = useQueryClient();
	const applications = useQuery({ ...applicationsListQueryOptions(), enabled: !application });
	const [applicationId, setApplicationId] = useState(application?.id ?? "");
	const savedOffers = useQuery(orpc.career.savedItems.queryOptions({ input: { kind: "offer" } }));
	const [draft, setTerms] = useState(() => ({
		...offerTermsSchema.parse({ currency: "USD", period: "year", base: null, variable: null }),
		currency: "",
	}));
	// Until the currency is typed, it's the one the last offer was in, so the two compare.
	const [currencyTyped, setCurrencyTyped] = useState(false);
	const [previousCurrency, setPreviousCurrency] = useState<string>();
	if (previousCurrency === undefined && savedOffers.data) {
		const currency = previousOfferCurrency(savedOffers.data);
		if (currency) setPreviousCurrency(currency);
	}
	const terms = currencyTyped ? draft : { ...draft, currency: previousCurrency ?? "" };
	const [more, setMore] = useState(false);
	const [amounts, setAmounts] = useState({ base: "", variable: "", learning: "" });
	const [date, setDate] = useState("");
	const [time, setTime] = useState("17:00");
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
	const save = useMutation({
		...orpc.career.createOffer.mutationOptions(),
		onSuccess: (result) => {
			if (!application && result) void navigate({ to: "/dashboard/career/offers", search: { a: result.id } });
			void queryClient.invalidateQueries({ queryKey: orpc.career.savedItems.key() });
			toast.add({ description: t`Offer saved` });
			onClose();
		},
	});
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
				if (payload.success && !save.isPending) save.mutate(payload.data);
			}}
		>
			<h2 className="text-base font-semibold">
				<Trans>Add offer</Trans>
			</h2>
			<p className="text-sm text-ink-2">
				<Trans>Enter terms yourself. No AI request is made. Leave unknown amounts blank.</Trans>
			</p>
			<fieldset disabled={save.isPending} className="grid items-start gap-3 sm:grid-cols-2">
				<div className="grid gap-1.5 sm:col-span-2 [&>label]:text-xs [&>label]:font-medium [&>label]:text-ink-2">
					<label htmlFor={`${id}-application`}>
						<Trans>Application</Trans>
					</label>
					<NativeSelect
						id={`${id}-application`}
						value={applicationId}
						disabled={!!application}
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
					<Icon name="warning-circle" /> <Trans>Couldn't save the offer. Your draft is still here. Try again.</Trans>
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
