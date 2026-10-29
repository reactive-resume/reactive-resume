import type { OfferTerms } from "@reactive-resume/schema/career";
import { useLingui } from "@lingui/react/macro";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { careerOfferInputSchema, offerTermsSchema } from "@reactive-resume/schema/career";
import { fromZonedDateTime } from "@reactive-resume/utils/timezone";
import { parseAmount } from "./amount";
import { client, useCareerAction, useCareerTime } from "./hooks";
import { EditorSheet, LoadState } from "./shared";
import { WallClockField } from "@/features/application-detail/date-field";
import { useApplications } from "@/features/applications/queries";
import { routes } from "@/routes";
import { Banner, Button, SelectSheet, Text, TextField, showToast, useTheme } from "@/ui";

type Application = { id: string; company: string; role: string };
type OfferEntryProps = { application?: Application };
export function OfferEntry({ application }: OfferEntryProps) {
	const { t } = useLingui();
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button variant="secondary" label={t`Add offer`} onPress={() => setOpen(true)} />
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
	const [terms, setTerms] = useState(() => ({
		...offerTermsSchema.parse({ currency: "USD", period: "year", base: null, variable: null }),
		currency: "",
	}));
	const [amounts, setAmounts] = useState({ base: "", variable: "", learning: "" });
	const [date, setDate] = useState("");
	const [time, setTime] = useState("17:00");
	const change = (patch: Partial<OfferTerms>) => setTerms((current) => ({ ...current, ...patch }));
	const deadline = date ? fromZonedDateTime(date, time, timeZone) : null;
	const payload = careerOfferInputSchema.safeParse({
		...terms,
		applicationId,
		base: parseAmount(amounts.base, locale),
		variable: parseAmount(amounts.variable, locale),
		learning: parseAmount(amounts.learning, locale),
		respondBy: date ? (profile.data ? deadline?.toISOString() : undefined) : null,
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
					autoCapitalize="characters"
					maxLength={3}
					placeholder="EUR"
					onChangeText={(currency) => change({ currency: currency.toUpperCase() })}
					error={
						terms.currency && !/^[A-Z]{3}$/.test(terms.currency) ? t`Enter a three-letter currency code.` : undefined
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
						onChangeText={(value) => setAmounts((current) => ({ ...current, [key]: value }))}
						error={
							parseAmount(amounts[key], locale) === undefined
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
				<Text color="ink3">{t`Times are shown in ${timeZone}.`}</Text>
				{date ? <LoadState query={profile} /> : null}
				{date && !deadline ? (
					<Banner tone="danger" message={t`Check the application, currency, amounts and deadline before saving.`} />
				) : null}
				{action.error ? <Banner tone="danger" message={action.error} /> : null}
				<Button
					label={t`Save offer`}
					loading={action.pending}
					disabled={!payload.success}
					onPress={() => {
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
