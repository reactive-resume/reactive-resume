import type { SavedData } from "@/features/workspace/hooks";
import type { ApplicationStatus } from "@reactive-resume/schema/applications/data";
import type { OfferTerms } from "@reactive-resume/schema/career";
import { useLingui } from "@lingui/react/macro";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { offerTermsSchema } from "@reactive-resume/schema/career";
import { parseOfferEntry } from "@reactive-resume/schema/career-offer";
import { client, useCareerAction, useCareerTime, useOffers } from "./hooks";
import { formatMoney } from "./offer-compare";
import { EditorSheet, LoadState } from "./shared";
import { WallClockField } from "@/features/application-detail/date-field";
import { useApplicationLanes } from "@/features/applications/lane-queries";
import { resolveLane } from "@/features/applications/lanes";
import { useApplications } from "@/features/applications/queries";
import { useMoveWithUndo } from "@/features/applications/stage-actions";
import { routes } from "@/routes";
import { Banner, Button, Card, SelectSheet, Text, TextField, showToast, useTheme } from "@/ui";

type Application = { id: string; company: string; role: string; status?: ApplicationStatus | undefined };
type OfferEntryProps = {
	application?: Application | undefined;
	primary?: boolean;
	/** Open the form at once ("Add the offer's terms" from a move to Offer). */
	initialOpen?: boolean | undefined;
	/** Called when the form closes, saved or not. */
	onDone?: (() => void) | undefined;
};
type OfferTermsSaved = SavedData<"offer">;

/** Stages before Offer: saving an offer for an application still at one of these moves it to Offer, with Undo. */
const BEFORE_OFFER: readonly ApplicationStatus[] = ["saved", "applied", "screening", "interview"];

/**
 * Add offer, and the offer saved last for this application in view as a one-line summary, so saving doesn't make the
 * terms disappear into Saved.
 */
export function OfferEntry({ application, primary = false, initialOpen = false, onDone }: OfferEntryProps) {
	const { t } = useLingui();
	const [open, setOpen] = useState(initialOpen);
	const [requested, setRequested] = useState(initialOpen);
	if (initialOpen !== requested) {
		setRequested(initialOpen);
		if (initialOpen) setOpen(true);
	}
	const offers = useOffers();
	const latest = application
		? (offers.data ?? [])
				.filter((item) => item.data.kind === "offer" && item.applicationId === application.id)
				.toSorted((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
		: undefined;
	const close = () => {
		setOpen(false);
		onDone?.();
	};
	return (
		<>
			{latest?.data.kind === "offer" ? <OfferSummary offer={latest.data} /> : null}
			<Button
				variant={primary ? "primary" : "secondary"}
				label={latest && application ? t`Add a newer offer` : t`Add offer`}
				onPress={() => setOpen(true)}
			/>
			{open ? <OfferForm {...(application ? { application } : {})} onClose={close} /> : null}
		</>
	);
}

/** "Written offer · €182,000 a year · respond by 12 Nov 2026 · Compare" */
function OfferSummary({ offer }: { offer: OfferTermsSaved }) {
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
			<Button variant="ghost" size="sm" label={t`Compare`} onPress={() => router.push(routes.career("offers"))} />
		</Card>
	);
}

type OfferFormProps = { application?: Application | undefined; onClose: () => void };
function OfferForm({ application, onClose }: OfferFormProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const { locale, timeZone, profile } = useCareerTime();
	const router = useRouter();
	const applications = useApplications();
	const action = useCareerAction();
	const lanes = useApplicationLanes();
	const moveWithUndo = useMoveWithUndo();
	const [applicationId, setApplicationId] = useState(application?.id ?? "");
	const [terms, setTerms] = useState(() => ({
		...offerTermsSchema.parse({ currency: "USD", period: "year", base: null, variable: null }),
		currency: "",
	}));
	const [amounts, setAmounts] = useState({ base: "", variable: "", learning: "" });
	const [date, setDate] = useState("");
	const [time, setTime] = useState("17:00");
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
		terms.currency ||
		amounts.base ||
		amounts.variable ||
		amounts.learning ||
		date ||
		terms.version !== "written" ||
		terms.period !== "year" ||
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
	return (
		<EditorSheet title={t`Add offer`} dirty={dirty} pending={action.pending} onClose={onClose}>
			<View style={{ padding: space.s4, gap: space.s4 }}>
				<Text color="ink2">{t`Enter terms yourself. No AI request is made. Leave unknown amounts blank.`}</Text>
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
							options={(applications.data ?? []).map((row) => ({
								value: row.id,
								label: `${row.company} · ${row.role}`,
							}))}
							onChange={setApplicationId}
						/>
						{applications.data?.length === 0 ? (
							<Button
								variant="ghost"
								label={t`Add an application first`}
								onPress={() => {
									onClose();
									router.push(routes.applications());
								}}
							/>
						) : null}
					</>
				)}
				<SelectSheet
					label={t`Offer type`}
					value={terms.version}
					onChange={(version) => change({ version })}
					options={[
						{ value: "written", label: t`Written offer` },
						{ value: "verbal", label: t`Verbal offer` },
					]}
				/>
				<TextField
					label={t`Currency`}
					value={terms.currency}
					onBlur={() => touch("currency")}
					autoCapitalize="characters"
					maxLength={3}
					placeholder="EUR"
					onChangeText={(currency) => change({ currency: currency.toUpperCase() })}
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
				{(
					[
						{ key: "base", label: t`Base salary` },
						{ key: "variable", label: t`Bonus` },
						{ key: "learning", label: t`Learning budget` },
					] as const
				).map(({ key, label }) => (
					<TextField
						key={key}
						label={label}
						keyboardType="decimal-pad"
						value={amounts[key]}
						onBlur={() => touch(key)}
						onChangeText={(value) => setAmounts((current) => ({ ...current, [key]: value }))}
						error={
							(submitted || touched[key]) && amountErrors[key]
								? t`Enter a full amount, such as 95000, or leave blank.`
								: undefined
						}
					/>
				))}
				<SelectSheet
					label={t`Office days per week`}
					value={terms.officeDays === null ? "" : String(terms.officeDays)}
					onChange={(value) => change({ officeDays: value === "" ? null : Number(value) })}
					options={[
						{ value: "", label: t`Unknown` },
						...[0, 1, 2, 3, 4, 5].map((days) => ({ value: String(days), label: String(days) })),
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
				<WallClockField label={t`Respond by`} mode="date" value={date} onChange={setDate} clearable />
				{date ? <WallClockField label={t`Time`} mode="time" value={time} onChange={setTime} /> : null}
				{profile.isSuccess ? <Text color="ink3">{t`Times are shown in ${timeZone}.`}</Text> : null}
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
					<Banner tone="danger" message={t`Choose an application and correct the highlighted fields before saving.`} />
				) : null}
				{action.error ? <Banner tone="danger" message={action.error} /> : null}
				<Button
					label={action.pending ? t`Saving…` : t`Save offer`}
					loading={action.pending}
					onPress={() => {
						setSubmitted(true);
						if (payload.success)
							void action.run(
								() => client.career.createOffer(payload.data),
								() => {
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
									onClose();
								},
							);
					}}
				/>
			</View>
		</EditorSheet>
	);
}
