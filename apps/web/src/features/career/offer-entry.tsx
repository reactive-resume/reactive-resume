import type { OfferTerms } from "@reactive-resume/schema/career";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";
import { careerOfferInputSchema, offerTermsSchema } from "@reactive-resume/schema/career";
import { Button } from "@reactive-resume/ui/components/button";
import { Input } from "@reactive-resume/ui/components/input";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import { toast } from "@reactive-resume/ui/components/toast";
import { fromZonedDateTime } from "@reactive-resume/utils/timezone";
import { parseAmount } from "./knowledge/amount";
import { CareerLoadError } from "./load-state";
import { useCareerTime } from "./shared";
import { applicationsListQueryOptions } from "@/features/applications/queries";
import { orpc } from "@/libs/orpc/client";

type Application = { id: string; company: string; role: string };
type OfferEntryProps = { application?: Application };

export function OfferEntry({ application }: OfferEntryProps) {
	const [open, setOpen] = useState(false);
	return open ? (
		<OfferForm {...(application ? { application } : {})} onClose={() => setOpen(false)} />
	) : (
		<Button variant="secondary" onClick={() => setOpen(true)}>
			<Trans>Add offer</Trans>
		</Button>
	);
}

type OfferFormProps = OfferEntryProps & { onClose: () => void };
function OfferForm({ application, onClose }: OfferFormProps) {
	const id = useId();
	const { locale, timeZone } = useCareerTime();
	const queryClient = useQueryClient();
	const applications = useQuery({ ...applicationsListQueryOptions(), enabled: !application });
	const [applicationId, setApplicationId] = useState(application?.id ?? "");
	const [terms, setTerms] = useState(() => ({
		...offerTermsSchema.parse({ currency: "USD", period: "year", base: null, variable: null }),
		currency: "",
	}));
	const [amounts, setAmounts] = useState({ base: "", variable: "", learning: "" });
	const [date, setDate] = useState("");
	const [time, setTime] = useState("17:00");
	const [submitted, setSubmitted] = useState(false);
	const change = (patch: Partial<OfferTerms>) => setTerms((current) => ({ ...current, ...patch }));
	const deadline = date ? fromZonedDateTime(date, time, timeZone) : null;
	const payload = careerOfferInputSchema.safeParse({
		...terms,
		applicationId,
		base: parseAmount(amounts.base, locale),
		variable: parseAmount(amounts.variable, locale),
		learning: parseAmount(amounts.learning, locale),
		respondBy: date ? deadline?.toISOString() : null,
	});
	const save = useMutation({
		...orpc.career.createOffer.mutationOptions(),
		onSuccess: () => {
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
	return (
		<form
			className="grid w-full gap-4 rounded-xl border border-line bg-surface p-4 text-start"
			onSubmit={(event) => {
				event.preventDefault();
				setSubmitted(true);
				if (payload.success && !save.isPending) save.mutate(payload.data);
			}}
		>
			<h2 className="text-base font-semibold">
				<Trans>Add offer</Trans>
			</h2>
			<p className="text-sm text-ink-2">
				<Trans>Enter terms yourself. No AI request is made. Leave unknown amounts blank.</Trans>
			</p>
			<fieldset disabled={save.isPending} className="grid gap-3 sm:grid-cols-2">
				<div className="grid gap-1 text-sm">
					<label htmlFor={`${id}-application`}>
						<Trans>Application</Trans>
					</label>
					<NativeSelect
						id={`${id}-application`}
						value={applicationId}
						disabled={!!application}
						onChange={(event) => setApplicationId(event.target.value)}
						required
					>
						<option value="">{t`Choose an application`}</option>
						{(application ? [application] : (applications.data ?? [])).map((row) => (
							<option key={row.id} value={row.id}>
								{row.company} · {row.role}
							</option>
						))}
					</NativeSelect>
				</div>
				<div className="grid gap-1 text-sm">
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
				<div className="grid gap-1 text-sm">
					<label htmlFor={`${id}-currency`}>
						<Trans>Currency</Trans>
					</label>
					<Input
						id={`${id}-currency`}
						value={terms.currency}
						maxLength={3}
						required
						pattern="[A-Z]{3}"
						placeholder="EUR"
						onChange={(event) => change({ currency: event.target.value.toUpperCase() })}
					/>
				</div>
				<div className="grid gap-1 text-sm">
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
				{(
					[
						{ key: "base", label: t`Base salary` },
						{ key: "variable", label: t`Bonus` },
						{ key: "learning", label: t`Learning budget` },
					] as const
				).map(({ key, label }) => (
					<div key={key} className="grid gap-1 text-sm">
						<label htmlFor={`${id}-${key}`}>{label}</label>
						<Input
							id={`${id}-${key}`}
							inputMode="decimal"
							value={amounts[key]}
							aria-invalid={parseAmount(amounts[key], locale) === undefined}
							aria-describedby={parseAmount(amounts[key], locale) === undefined ? `${id}-${key}-error` : undefined}
							onChange={(event) => setAmounts((current) => ({ ...current, [key]: event.target.value }))}
						/>
						{parseAmount(amounts[key], locale) === undefined && (
							<span
								id={`${id}-${key}-error`}
								className="text-xs text-danger-text"
							>{t`Enter a full amount, such as 95000, or leave blank.`}</span>
						)}
					</div>
				))}
				<div className="grid gap-1 text-sm">
					<label htmlFor={`${id}-office`}>
						<Trans>Office days per week</Trans>
					</label>
					<NativeSelect
						id={`${id}-office`}
						value={terms.officeDays ?? ""}
						onChange={(event) => change({ officeDays: event.target.value === "" ? null : Number(event.target.value) })}
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
					<div key={key} className="grid gap-1 text-sm">
						<label htmlFor={`${id}-${key}`}>{label}</label>
						<Input
							id={`${id}-${key}`}
							value={terms[key]}
							maxLength={max}
							onChange={(event) => change({ [key]: event.target.value })}
						/>
					</div>
				))}
				<div className="grid gap-1 text-sm">
					<label htmlFor={`${id}-date`}>
						<Trans>Respond by</Trans>
					</label>
					<Input id={`${id}-date`} type="date" value={date} onChange={(event) => setDate(event.target.value)} />
				</div>
				{date && (
					<div className="grid gap-1 text-sm">
						<label htmlFor={`${id}-time`}>
							<Trans>Time</Trans>
						</label>
						<Input
							id={`${id}-time`}
							type="time"
							required
							value={time}
							onChange={(event) => setTime(event.target.value)}
						/>
					</div>
				)}
			</fieldset>
			<p className="text-xs text-ink-3">{t`Times are shown in ${timeZone}.`}</p>
			{!application && applications.isError && <CareerLoadError onRetry={() => void applications.refetch()} />}
			{!application && applications.data?.length === 0 && (
				<Link to="/dashboard/applications">
					<Trans>Add an application first</Trans>
				</Link>
			)}
			{((submitted && !payload.success) || (date && !deadline)) && (
				<p role="alert" className="text-sm text-danger-text">
					<Trans>Check the application, currency, amounts and deadline before saving.</Trans>
				</p>
			)}
			{save.isError && (
				<p role="alert" className="text-sm text-danger-text">
					<Trans>Couldn't save the offer. Your draft is still here. Try again.</Trans>
				</p>
			)}
			<div className="flex gap-2">
				<Button type="submit" loading={save.isPending} disabled={!payload.success}>
					<Trans>Save offer</Trans>
				</Button>
				<Button variant="ghost" disabled={save.isPending} onClick={onClose}>
					<Trans>Cancel</Trans>
				</Button>
			</div>
		</form>
	);
}
