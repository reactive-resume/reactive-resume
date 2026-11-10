import { t } from "@lingui/core/macro";
// J8 · Add or edit an interview: Type, Starts (the system date and time picker), Length, the zone it is saved in,
// Where, With, and three switches. Time has a zone: the exact instant plus the IANA zone is saved; a repeated hour
// at a daylight-saving change asks which one; a skipped hour is refused. Away from home both zones show.
import DateTimePicker, {
	DateTimePickerAndroid,
	type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Platform, View } from "react-native";
import { clockTime, interviewTitle, shortDay, zoneAbbreviation, zoneCity } from "./model";
import { ChoiceSheet } from "./parts";
import { storyboard } from "./storyboard";
import { approveRecurring, providerConnection, useAIProviders, useApplication, useApplicationActions } from "@/data";
import { now, timeZone, wallTimeChoices, zonedParts } from "@/data/clock";
import {
	BottomSheet,
	Button,
	FieldRow,
	FooterBar,
	haptic,
	layout,
	ListRow,
	SheetScreen,
	SheetScrollView,
	showToast,
	Switch,
	Text,
	TextField,
	TextLink,
	toggleValue,
} from "@/ui";

const KINDS = ["screening", "technical", "behavioral", "onsite", "other"] as const;
const LENGTHS = [15, 30, 45, 60, 90, 120] as const;
type Picker = "kind" | "length" | "when" | "hour" | null;

/** Wall time in `zone` as a Date whose device-local fields read the same (what the system picker edits). */
const asLocal = (instant: Date, zone: string) => {
	const { date, time } = zonedParts(instant, zone);
	return new Date(`${date}T${time}:00`);
};
const pad = (n: number) => String(n).padStart(2, "0");
const localParts = (d: Date) => ({
	date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
	time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
});

export function InterviewSheet() {
	const params = useLocalSearchParams<{ id: string; interview?: string }>();
	const application = useApplication(params.id ?? "");
	const existing = application.data?.activity.find(
		(entry) => entry.type === "interview" && entry.id === params.interview,
	);
	const interview = existing?.type === "interview" ? existing : undefined;
	// The form starts from the saved interview; it starts again only if that interview changes elsewhere.
	return (
		<InterviewForm
			key={interview ? JSON.stringify(interview) : "new"}
			application={application}
			interview={interview}
		/>
	);
}

type Interview = Extract<
	NonNullable<ReturnType<typeof useApplication>["data"]>["activity"][number],
	{ type: "interview" }
>;

function InterviewForm({
	application,
	interview,
}: {
	application: ReturnType<typeof useApplication>;
	interview: Interview | undefined;
}) {
	const router = useRouter();
	const providers = useAIProviders();
	const actions = useApplicationActions();
	const home = timeZone();
	const zone = interview?.timezone ?? home;

	const [kind, setKind] = useState<string>(interview?.kind ?? "technical");
	const [starts, setStarts] = useState<Date | null>(interview ? new Date(interview.at) : null);
	const [length, setLength] = useState(interview?.durationMinutes ?? 45);
	const [where, setWhere] = useState(interview?.location ?? "");
	const [people, setPeople] = useState(interview?.participants.map((p) => p.name).join(", ") ?? "");
	const [remind, setRemind] = useState(true);
	const [brief, setBrief] = useState(false);
	const [calendar, setCalendar] = useState(false);
	const [picker, setPicker] = useState<Picker>(null);
	const [draft, setDraft] = useState<Date | null>(null);
	const [choices, setChoices] = useState<ReturnType<typeof wallTimeChoices>>([]);
	const [timeError, setTimeError] = useState<string | undefined>();
	const [touched, setTouched] = useState(false);
	const provider = providers.data?.find((p) => p.isDefault) ?? providers.data?.[0];

	/** The picker's wall time, read in the interview's zone: one instant, a choice of two, or none. */
	const pickWallTime = (local: Date) => {
		const { date, time } = localParts(local);
		const found = wallTimeChoices(date, time, zone);
		setTouched(true);
		if (found.length === 0)
			return setTimeError(t`This time does not exist in the selected timezone. Choose another time.`);
		setTimeError(undefined);
		if (found.length === 1) return setStarts(found[0]?.instant ?? null);
		setChoices(found);
		setPicker("hour");
	};

	const openWhen = () => {
		const value = asLocal(starts ?? now(), zone);
		if (Platform.OS === "android") {
			DateTimePickerAndroid.open({
				value,
				mode: "date",
				onChange: (event: DateTimePickerEvent, date?: Date) => {
					if (event.type !== "set" || !date) return;
					DateTimePickerAndroid.open({
						value: date,
						mode: "time",
						is24Hour: true,
						onChange: (e: DateTimePickerEvent, d?: Date) => {
							if (e.type === "set" && d) pickWallTime(d);
						},
					});
				},
			});
			return;
		}
		setPicker("when");
	};

	const save = () => {
		if (!starts) return setTimeError(t`Choose when it starts.`);
		const id = application.data?.id;
		if (!id) return;
		// The exact instant plus the zone it was entered in.
		const details = {
			at: starts.toISOString(),
			kind: kind as (typeof KINDS)[number],
			durationMinutes: length,
			location: where.trim(),
			participants: people
				.split(",")
				.map((name) => name.trim())
				.filter(Boolean)
				.map((name) => ({ name, role: "" })),
			timezone: zone,
		};
		void (
			interview
				? actions.updateInterview({ id, entryId: interview.id, ...details })
				: actions.addInterview({ id, ...details })
		)
			.then(() => {
				haptic("success");
				router.back();
			})
			.catch(() => {
				haptic("error");
				showToast({ message: t`Couldn't schedule the interview. Try again.` });
			});
	};

	const startsLabel = starts ? `${shortDay(starts, zone)}, ${clockTime(starts, zone)}` : "";
	const away =
		starts && zone !== home
			? `${clockTime(starts, zone)} ${zoneCity(zone)} · ${clockTime(starts, home)} ${t`here`}`
			: null;
	const zoneLine = `${t`${zoneCity(zone)} time`} (${zoneAbbreviation(starts ?? now(), zone)}) ·`;

	return (
		<SheetScreen
			title={interview && !storyboard ? t`Edit interview` : t`Add interview`}
			height={786}
			closeIconSize={24}
			bottomPadding={3}
			keyboard
			dirty={touched}
			footer={
				<FooterBar bg="raised" divider={false} inset={false}>
					<Button label={t`Save interview`} tone="primary" size="lg" grow onPress={save} testID="interview-save" />
				</FooterBar>
			}
		>
			<SheetScrollView contentContainerStyle={{ paddingTop: 12, paddingHorizontal: layout.screenMargin, gap: 20 }}>
				<TextField
					label={t`Type`}
					value={interviewTitle(kind)}
					trailingIcon="caret-down"
					onPress={() => setPicker("kind")}
				/>
				<View style={{ gap: 0 }}>
					<FieldRow>
						<TextField
							grow
							label={t`Starts`}
							value={startsLabel}
							placeholder={t`Choose`}
							onPress={openWhen}
							error={timeError}
						/>
						<TextField grow label={t`Length`} value={t`${length} min`} onPress={() => setPicker("length")} />
					</FieldRow>
					<View
						style={{
							marginTop: 12,
							minHeight: 48,
							flexDirection: "row",
							flexWrap: "wrap",
							alignItems: "center",
							alignContent: "center",
							gap: 4,
						}}
					>
						<Text variant="ui" color="ink3">
							{away ?? zoneLine}
						</Text>
						<TextLink label={t`Change`} variant="ui" onPress={() => router.push("/settings/preferences")} />
					</View>
				</View>
				<TextField
					label={t`Where`}
					value={where}
					onChangeText={(v) => {
						setTouched(true);
						setWhere(v);
					}}
					placeholder={t`Address or meeting link`}
					autoCapitalize="none"
				/>
				<TextField
					label={t`With`}
					value={people}
					onChangeText={(v) => {
						setTouched(true);
						setPeople(v);
					}}
					placeholder={application.data?.contacts.map((c) => c.name).join(", ") || t`Who you'll meet`}
				/>
				<View style={{ marginHorizontal: -layout.screenMargin, marginTop: -8 }}>
					<ListRow
						title={t`Remind me the day before`}
						trailing={<Switch value={remind} interactive={false} />}
						onPress={() => toggleValue(remind, setRemind)}
						accessibilityRole="switch"
						accessibilityState={{ checked: remind }}
					/>
					<ListRow
						title={t`Prepare a briefing`}
						secondary={
							provider
								? t`Sends the posting and resume to ${provider.label}, which may charge`
								: t`Set up AI in Settings to prepare a briefing`
						}
						wrapSecondary
						disabled={!provider}
						trailing={<Switch value={brief} interactive={false} />}
						onPress={() =>
							toggleValue(brief, (next) => {
								// Turning it on is the approval: the posting and resume go to this connection, as C7.
								if (next && provider) approveRecurring(providerConnection(provider));
								setBrief(next);
							})
						}
						accessibilityRole="switch"
						accessibilityState={{ checked: brief }}
					/>
					<ListRow
						title={t`Add to my phone calendar`}
						trailing={<Switch value={calendar} interactive={false} />}
						onPress={() => toggleValue(calendar, setCalendar)}
						accessibilityRole="switch"
						accessibilityState={{ checked: calendar }}
						last
					/>
				</View>
			</SheetScrollView>
			{picker === "kind" ? (
				<ChoiceSheet
					title={t`Type`}
					height={470}
					value={KINDS.includes(kind as (typeof KINDS)[number]) ? (kind as (typeof KINDS)[number]) : undefined}
					choices={KINDS.map((k) => ({ key: k, title: interviewTitle(k) }))}
					onClose={() => setPicker(null)}
					onChoose={(k) => {
						setTouched(true);
						setKind(k);
						setPicker(null);
					}}
				/>
			) : null}
			{picker === "length" ? (
				<ChoiceSheet
					title={t`Length`}
					height={520}
					value={String(length)}
					choices={LENGTHS.map((n) => ({ key: String(n), title: t`${n} min` }))}
					onClose={() => setPicker(null)}
					onChoose={(n) => {
						setTouched(true);
						setLength(Number(n));
						setPicker(null);
					}}
				/>
			) : null}
			{picker === "hour" ? (
				<ChoiceSheet
					title={t`Which ${localParts(asLocal(choices[0]?.instant ?? now(), zone)).time}?`}
					height={300}
					choices={choices.map((choice, i) => ({ key: String(i), title: choice.label }))}
					onClose={() => setPicker(null)}
					onChoose={(i) => {
						setStarts(choices[Number(i)]?.instant ?? null);
						setPicker(null);
					}}
				/>
			) : null}
			{picker === "when" ? (
				<BottomSheet
					title={t`Starts`}
					height={420}
					onClose={() => setPicker(null)}
					footer={
						<FooterBar bg="raised" divider={false} inset={false}>
							<Button
								label={t`Done`}
								tone="primary"
								size="lg"
								grow
								onPress={() => {
									setPicker(null);
									pickWallTime(draft ?? asLocal(starts ?? now(), zone));
								}}
							/>
						</FooterBar>
					}
				>
					<DateTimePicker
						value={draft ?? asLocal(starts ?? now(), zone)}
						mode="datetime"
						display="spinner"
						minuteInterval={5}
						onChange={(_event, date) => date && setDraft(date)}
					/>
				</BottomSheet>
			) : null}
		</SheetScreen>
	);
}
