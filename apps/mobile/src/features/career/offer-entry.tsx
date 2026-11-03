import type { SavedData } from "@/features/workspace/hooks";
import type { ApplicationStatus } from "@reactive-resume/schema/applications/data";
import type { OfferTerms } from "@reactive-resume/schema/career";
import { useLingui } from "@lingui/react/macro";
import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import Storage from "expo-sqlite/kv-store";
import { useLayoutEffect, useRef, useState } from "react";
import { View } from "react-native";
import { offerTermsSchema } from "@reactive-resume/schema/career";
import {
	bonusEntry,
	offerApplications,
	offerHintFromSalary,
	parseOfferEntry,
	previousOfferCurrency,
} from "@reactive-resume/schema/career-offer";
import { pendingRequestId, settleRequestId } from "@reactive-resume/utils/string";
import { client, useCareerAction, useCareerQueries, useCareerTime, useOffers } from "./hooks";
import { formatMoney } from "./offer-compare";
import { rememberSavedOffer } from "./offer-selection";
import { EditorSheet, LoadState } from "./shared";
import { getAccountScope } from "@/auth/session";
import { WallClockField } from "@/features/application-detail/date-field";
import { useApplicationLanes } from "@/features/applications/lane-queries";
import { resolveLane } from "@/features/applications/lanes";
import { useApplications } from "@/features/applications/queries";
import { useMoveWithUndo } from "@/features/applications/stage-actions";
import { routes } from "@/routes";
import { Banner, Button, Card, SelectSheet, Text, TextField, showToast, useTheme } from "@/ui";

type Application = {
	id: string;
	company: string;
	role: string;
	status?: ApplicationStatus | undefined;
	/** The job's salary line, to start a new offer's currency and base from. */
	salary?: string | null | undefined;
};
type OfferEntryProps = {
	application?: Application | undefined;
	primary?: boolean;
	/** Open the form at once ("Add the offer's terms" from a move to Offer). */
	initialOpen?: boolean | undefined;
	/** Called when the form closes, saved or not. */
	onDone?: (() => void) | undefined;
};
type OfferTermsSaved = SavedData<"offer">;
type OfferSaved = { id: string; data: OfferTermsSaved };

/** Stages before Offer: saving an offer for an application still at one of these moves it to Offer, with Undo. */
const BEFORE_OFFER: readonly ApplicationStatus[] = ["saved", "applied", "screening", "interview"];

const requestIds = {
	getItem: (key: string) => Storage.getItemSync(key),
	setItem: (key: string, value: string) => Storage.setItemSync(key, value),
	removeItem: (key: string) => Storage.removeItemSync(key),
};

/**
 * Add offer, and the offer saved last for this application in view as a one-line summary, so saving doesn't make the
 * terms disappear into Saved.
 */
export function OfferEntry(props: OfferEntryProps) {
	return <ScopedOfferEntry key={props.application?.id ?? "global"} {...props} />;
}
function ScopedOfferEntry({ application, primary = false, initialOpen = false, onDone }: OfferEntryProps) {
	const { t } = useLingui();
	const [open, setOpen] = useState(initialOpen);
	const [requested, setRequested] = useState(initialOpen);
	if (initialOpen !== requested) {
		setRequested(initialOpen);
		if (initialOpen) setOpen(true);
	}
	const applications = useApplications();
	const router = useRouter();
	const offers = useOffers();
	const [justSaved, setJustSaved] = useState<OfferSaved | null>(null);
	const latest =
		justSaved ??
		(application
			? (offers.data ?? [])
					.filter((item) => item.data.kind === "offer" && item.applicationId === application.id)
					.toSorted((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
			: undefined);
	const close = () => {
		setOpen(false);
		onDone?.();
	};
	if (!open && !application && (!applications.data || (applications.isError && !applications.data.length)))
		return <LoadState query={applications} />;
	if (!open && !application && applications.data?.length === 0)
		return (
			<Button
				variant={primary ? "primary" : "secondary"}
				label={t`Add an application first`}
				onPress={() => router.push(routes.newJob())}
			/>
		);
	return (
		<>
			{latest?.data.kind === "offer" ? <OfferSummary offer={latest.data} id={latest.id} /> : null}
			<Button
				variant={primary ? "primary" : "secondary"}
				label={latest && application ? t`Add a newer offer` : t`Add offer`}
				onPress={() => setOpen(true)}
			/>
			{open ? <OfferForm {...(application ? { application } : {})} onClose={close} onSaved={setJustSaved} /> : null}
		</>
	);
}

/** "Written offer · €182,000 a year · respond by 12 Nov 2026 · Compare" */
type OfferSummaryProps = { offer: OfferTermsSaved; id: string };
function OfferSummary({ offer, id }: OfferSummaryProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const router = useRouter();
	const { locale, timeZone } = useCareerTime();
	const period = { year: t`a year`, month: t`a month`, hour: t`an hour` }[offer.period];
	const respondBy = offer.respondBy
		? new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "medium" }).format(new Date(offer.respondBy))
		: null;
	const parts = [
		offer.version === "verbal" ? t`Verbal offer` : t`Written offer`,
		offer.base === null ? null : `${formatMoney(locale, offer.currency, offer.base)} ${period}`,
		respondBy ? t`respond by ${respondBy}` : null,
	].filter(Boolean);
	return (
		<Card style={{ gap: space.s2 }}>
			<Text accessibilityLiveRegion="polite">{parts.join(" · ")}</Text>
			<Button
				variant="ghost"
				size="sm"
				label={t`Compare`}
				onPress={() => router.push({ pathname: routes.career("offers"), params: { a: id } })}
			/>
		</Card>
	);
}

/** A saved offer being corrected: its terms as stored, which the save sends back as the copy it changed. */
type EditedOffer = { id: string; data: OfferTerms };

type OfferFormProps = OfferEntryProps & {
	offer?: EditedOffer;
	onClose: () => void;
	onSaved?: (offer: OfferSaved) => void;
};

/** "2026-11-20" and "17:00" in the account's timezone, for the date and time fields. */
const zonedFields = (value: string, timeZone: string) => {
	const at = new Date(value);
	return {
		date: new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at),
		time: new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
			at,
		),
	};
};

export function OfferForm({ application, offer: initialOffer, onClose, onSaved }: OfferFormProps) {
	const params = useLocalSearchParams<{ b?: string }>();
	const focused = useIsFocused();
	const active = useRef(focused);
	useLayoutEffect(() => {
		active.current = focused;
		return () => {
			active.current = false;
		};
	}, [focused]);
	const [scope] = useState(getAccountScope);
	// Draft and expected terms belong to the same edit session, even when saved offers refetch.
	const [offer] = useState(initialOffer);
	const { t } = useLingui();
	const { space } = useTheme();
	const { locale, timeZone, profile } = useCareerTime();
	const router = useRouter();
	const applications = useApplications();
	const action = useCareerAction();
	const lanes = useApplicationLanes();
	const moveWithUndo = useMoveWithUndo();
	const [applicationId, setApplicationId] = useState(application?.id ?? "");
	// A new offer for a job starts from the job's own salary line: its currency, its pay period, and the low end as an
	// editable base.
	const chosen = application ?? applications.data?.find((row) => row.id === applicationId);
	const hint = offer ? null : offerHintFromSalary(chosen?.salary);
	const [draft, setTerms] = useState(() =>
		offer
			? offerTermsSchema.parse(offer.data)
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
	const [seed, setSeed] = useState(() => ({ base: offer ? "" : amount(hint?.base), period: hint?.period ?? "year" }));
	const chooseApplication = (id: string) => {
		setApplicationId(id);
		if (offer) return;
		const next = offerHintFromSalary(applications.data?.find((row) => row.id === id)?.salary);
		const nextSeed = { base: amount(next.base), period: next.period ?? "year" };
		if (amounts.base === seed.base) setAmounts((current) => ({ ...current, base: nextSeed.base }));
		if (draft.period === seed.period) setTerms((current) => ({ ...current, period: nextSeed.period }));
		setSeed(nextSeed);
	};
	const deadline = offer?.data.respondBy ? zonedFields(offer.data.respondBy, timeZone) : null;
	const [date, setDate] = useState(deadline?.date ?? "");
	const [time, setTime] = useState(deadline?.time ?? "17:00");

	const savedOffers = useOffers();
	const [currencyTyped, setCurrencyTyped] = useState(false);
	const [previousCurrency, setPreviousCurrency] = useState<string>();
	if (previousCurrency === undefined && savedOffers.data) {
		const currency = previousOfferCurrency(savedOffers.data);
		if (currency) setPreviousCurrency(currency);
	}
	// A new offer starts in the last offer's currency, else the one the user's minimum salary is in (Preferences).
	const careerProfile = useCareerQueries().profile.data;
	const preferred = careerProfile?.minBase.amount === null ? undefined : careerProfile?.minBase.currency;
	const terms =
		offer || currencyTyped ? draft : { ...draft, currency: hint?.currency ?? previousCurrency ?? preferred ?? "" };
	const [more, setMore] = useState(Boolean(offer));
	const change = (patch: Partial<OfferTerms>) => setTerms((current) => ({ ...current, ...patch }));
	const [submitted, setSubmitted] = useState(false);
	const [touched, setTouched] = useState<Record<string, boolean>>({});
	const touch = (key: string) => setTouched((current) => ({ ...current, [key]: true }));
	const { payload, amountErrors, deadlineError } = parseOfferEntry({
		applicationId,
		terms,
		amounts,
		date,
		time,
		locale,
		timeZone: profile.isSuccess ? timeZone : null,
	});
	const dirty = !!(
		(currencyTyped && terms.currency) ||
		amounts.base !== seed.base ||
		amounts.variable ||
		amounts.learning ||
		date ||
		terms.version !== "written" ||
		terms.period !== seed.period ||
		terms.officeDays !== null ||
		terms.variableConditions ||
		terms.equity ||
		terms.location ||
		terms.leave ||
		terms.other
	);
	const textFields = [
		{ key: "variableConditions", label: t`Bonus conditions`, max: 1000 },
		{ key: "equity", label: t`Equity`, max: 1000 },
		{ key: "location", label: t`Where you work`, max: 500 },
		{ key: "leave", label: t`Leave`, max: 500 },
		{ key: "other", label: t`Other benefits`, max: 1000 },
	] as const;
	const amountField = (key: "base" | "variable" | "learning", label: string) => (
		<TextField
			key={key}
			label={label}
			keyboardType={key === "variable" ? "default" : "decimal-pad"}
			helper={key === "variable" ? t`Enter an amount or a percentage of base, such as 10%.` : undefined}
			value={amounts[key]}
			onBlur={() => touch(key)}
			onChangeText={(value) => setAmounts((current) => ({ ...current, [key]: value }))}
			error={
				(submitted || touched[key]) && amountErrors[key]
					? key === "variable"
						? t`Enter an amount or a percentage such as 10%, or leave blank.`
						: t`Enter a full amount, such as 95000, or leave blank.`
					: undefined
			}
		/>
	);
	const saveTerms = async () => {
		if (!payload.success || !scope || getAccountScope() !== scope) throw new Error("Account changed");
		if (!offer) return client.career.createOffer(payload.data, { context: { scope } });
		const { applicationId: _applicationId, ...terms } = payload.data;
		const input = { id: offer.id, terms, expected: offerTermsSchema.parse(offer.data), newVersion: true };
		const key = JSON.stringify(["career:offer-version", scope, input]);
		const newId = pendingRequestId(key, requestIds);
		const result = await client.career.updateOffer({ ...input, newId }, { context: { scope } });
		settleRequestId(key, requestIds, newId);
		return result;
	};
	return (
		<EditorSheet
			title={offer ? t`Edit offer terms` : t`Add offer`}
			dirty={dirty}
			pending={action.pending}
			onClose={onClose}
		>
			<View style={{ padding: space.s4, gap: space.s4 }}>
				<Text color="ink2">
					{offer
						? t`Save corrected terms as a new version. The previous version stays available. No AI request is made.`
						: t`Enter terms yourself. No AI request is made. Leave unknown amounts blank.`}
				</Text>
				{application ? (
					<Text>
						{application.company} · {application.role}
					</Text>
				) : (
					<>
						<LoadState query={applications} />
						<SelectSheet
							label={t`Application`}
							value={applicationId}
							options={offerApplications(applications.data ?? []).map((row) => ({
								value: row.id,
								label: `${row.company} · ${row.role} · ${row.closedReason === "accepted" ? t`Accepted` : row.status === "offer" ? t`Offer` : row.status === "closed" ? t`Closed` : t`In progress`}`,
							}))}
							onChange={chooseApplication}
						/>
						{applications.data?.length === 0 ? (
							<Button
								variant="ghost"
								label={t`Add an application first`}
								onPress={() => {
									onClose();
									router.push(routes.newJob());
								}}
							/>
						) : null}
					</>
				)}
				<TextField
					label={t`Currency`}
					value={terms.currency}
					onBlur={() => touch("currency")}
					autoCapitalize="characters"
					maxLength={3}
					// A hint, not a placeholder: a placeholder "EUR" reads as a currency already chosen.
					helper={t`Enter a three-letter currency code.`}
					onChangeText={(currency) => {
						setCurrencyTyped(true);
						change({ currency: currency.toUpperCase() });
					}}
					error={
						(submitted || touched.currency) && !/^[A-Z]{3}$/.test(terms.currency)
							? t`Enter a three-letter currency code.`
							: undefined
					}
				/>
				<SelectSheet
					label={t`Pay period`}
					value={terms.period}
					onChange={(period) => change({ period })}
					options={[
						{ value: "year", label: t`Per year` },
						{ value: "month", label: t`Per month` },
						{ value: "hour", label: t`Per hour` },
					]}
				/>
				{amountField("base", t`Base salary`)}
				<WallClockField label={t`Respond by`} mode="date" value={date} onChange={setDate} clearable />
				{date ? <WallClockField label={t`Time`} mode="time" value={time} onChange={setTime} /> : null}
				{date && profile.isSuccess ? <Text color="ink3">{t`Times are shown in ${timeZone}.`}</Text> : null}
				<Button
					variant="ghost"
					icon={more ? "caret-down" : "caret-right"}
					label={t`More options`}
					expanded={more}
					onPress={() => setMore(!more)}
				/>
				{more ? (
					<>
						<SelectSheet
							label={t`Offer type`}
							value={terms.version}
							onChange={(version) => change({ version })}
							options={[
								{ value: "written", label: t`Written offer` },
								{ value: "verbal", label: t`Verbal offer` },
							]}
						/>
						{amountField("variable", t`Bonus`)}
						{amountField("learning", t`Learning budget`)}
						<SelectSheet
							label={t`Office days per week`}
							value={terms.officeDays === null ? "" : String(terms.officeDays)}
							onChange={(value) => change({ officeDays: value === "" ? null : Number(value) })}
							options={[
								{ value: "", label: t`Unknown` },
								// The word Preferences uses for no office days.
								...[0, 1, 2, 3, 4, 5].map((days) => ({
									value: String(days),
									label: days === 0 ? t`Remote (0)` : String(days),
								})),
							]}
						/>
						{textFields.map(({ key, label, max }) => (
							<TextField
								key={key}
								label={label}
								value={terms[key]}
								maxLength={max}
								onChangeText={(value) => change({ [key]: value })}
							/>
						))}
					</>
				) : null}
				{date ? <LoadState query={profile} /> : null}
				{submitted && deadlineError ? (
					<Banner
						tone="danger"
						message={
							deadlineError === "timezone"
								? t`Wait for your account timezone to load, retry if it failed, or clear the deadline.`
								: t`Choose a valid date and time in ${timeZone}, or clear the deadline.`
						}
					/>
				) : null}
				{submitted && !payload.success ? (
					<Banner
						tone="danger"
						message={
							applicationId ? t`Correct the highlighted fields before saving.` : t`Choose an application before saving.`
						}
					/>
				) : null}
				{action.error ? <Banner tone="danger" message={action.error} /> : null}
				<Button
					label={action.pending ? t`Saving…` : t`Save offer`}
					loading={action.pending}
					onPress={() => {
						if (!scope || getAccountScope() !== scope) return;
						setSubmitted(true);
						if (amountErrors.variable || amountErrors.learning) setMore(true);
						if (payload.success)
							void action.run(saveTerms, (result) => {
								if (getAccountScope() !== scope) return;
								if (result) rememberSavedOffer(scope, result.id, params.b);
								if (offer) {
									if (!active.current) return;
									showToast({ message: t`New offer version saved` });
									onClose();
									return;
								}
								if (active.current && result?.data.kind === "offer") onSaved?.({ id: result.id, data: result.data });
								const row = applications.data?.find((item) => item.id === payload.data.applicationId);
								const target = application ?? row;
								const status = application?.status ?? row?.status;
								if (target && status && BEFORE_OFFER.includes(status))
									// An offer means the application is at Offer; Undo keeps the offer and leaves the stage.
									moveWithUndo({
										applications: [{ id: payload.data.applicationId }],
										lane: resolveLane(lanes.lanes, { status: "offer" }),
										supported: lanes.supported,
										message: t`Offer saved. ${target.company} moved to Offer.`,
									});
								else showToast({ message: t`Offer saved` });
								if (active.current) onClose();
							});
					}}
				/>
			</View>
		</EditorSheet>
	);
}
