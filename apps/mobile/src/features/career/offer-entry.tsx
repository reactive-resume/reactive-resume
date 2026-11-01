import type { OfferTerms } from "@reactive-resume/schema/career";
import { useLingui } from "@lingui/react/macro";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { offerTermsSchema } from "@reactive-resume/schema/career";
import { parseOfferEntry, previousOfferCurrency } from "@reactive-resume/schema/career-offer";
import { client, useCareerAction, useCareerTime, useOffers } from "./hooks";
import { EditorSheet, LoadState } from "./shared";
import { WallClockField } from "@/features/application-detail/date-field";
import { useApplications } from "@/features/applications/queries";
import { routes } from "@/routes";
import { Banner, Button, SelectSheet, Text, TextField, showToast, useTheme } from "@/ui";

type Application = { id: string; company: string; role: string };
type OfferEntryProps = { application?: Application; primary?: boolean };
/** "Add offer". An offer belongs to an application, so with none yet it leads to adding one instead. */
export function OfferEntry({ application, primary = false }: OfferEntryProps) {
	const { t } = useLingui();
	const router = useRouter();
	const applications = useApplications();
	const [open, setOpen] = useState(false);
	const variant = primary ? "primary" : "secondary";
	if (!open && !application && (!applications.data || (applications.isError && !applications.data.length)))
		return <LoadState query={applications} />;
	if (!open && !application && applications.data?.length === 0)
		return (
			<Button variant={variant} label={t`Add an application first`} onPress={() => router.push(routes.newJob())} />
		);
	return (
		<>
			<Button variant={variant} label={t`Add offer`} onPress={() => setOpen(true)} />
			{open ? <OfferForm {...(application ? { application } : {})} onClose={() => setOpen(false)} /> : null}
		</>
	);
}

type OfferFormProps = OfferEntryProps & { onClose: () => void };
function OfferForm({ application, onClose }: OfferFormProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const { locale, timeZone, profile } = useCareerTime();
	const router = useRouter();
	const applications = useApplications();
	const action = useCareerAction();
	const [applicationId, setApplicationId] = useState(application?.id ?? "");
	const savedOffers = useOffers();
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
	const amountField = (key: "base" | "variable" | "learning", label: string) => (
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
	);
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
					<Banner tone="danger" message={t`Choose an application and correct the highlighted fields before saving.`} />
				) : null}
				{action.error ? <Banner tone="danger" message={action.error} /> : null}
				<Button
					label={action.pending ? t`Saving…` : t`Save offer`}
					loading={action.pending}
					onPress={() => {
						setSubmitted(true);
						if (amountErrors.variable || amountErrors.learning) setMore(true);
						if (payload.success)
							void action.run(
								() => client.career.createOffer(payload.data),
								() => {
									showToast({ message: t`Offer saved` });
									onClose();
								},
							);
					}}
				/>
			</View>
		</EditorSheet>
	);
}
