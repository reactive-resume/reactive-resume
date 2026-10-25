import type { Application } from "@/features/applications/types";
import type { InterviewKind, InterviewTimelineEntry } from "@reactive-resume/schema/applications/data";
import { useLingui } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Linking, View } from "react-native";
import { interviewDetailsSchema } from "@reactive-resume/schema/applications/data";
import { generateId } from "@reactive-resume/utils/string";
import { fromZonedDateTime } from "@reactive-resume/utils/timezone";
import { WallClockField } from "./date-field";
import {
	interviewReminder,
	interviewTypeLabel,
	isInterview,
	leadLabel,
	useDetailMutations,
	useUserTime,
} from "./hooks";
import { client } from "@/api/client";
import { applicationDetailQueryKey, useInvalidateApplications } from "@/features/applications/queries";
import {
	DEFAULT_LEAD,
	holdReminder,
	isTimeZone,
	releaseReminder,
	REMINDER_LEADS,
	useReminders,
	zonedParts,
} from "@/features/reminders";
import { timeZones } from "@/lib/timezones";
import {
	Button,
	Chip,
	EditorSheet,
	IconButton,
	ListRow,
	Segmented,
	showToast,
	toastLifetime,
	Switch,
	Text,
	TextArea,
	TextField,
	useTheme,
} from "@/ui";

const KINDS: InterviewKind[] = ["screening", "technical", "behavioral", "onsite", "other"];
const LENGTHS = [30, 45, 60, 90];
const UNDO_MS = 6000;

type Participant = { id: string; name: string; role: string; profileUrl: string };

type Draft = {
	kind: InterviewKind;
	date: string;
	time: string;
	durationMinutes: number;
	location: string;
	notes: string;
	/** Not shown; kept so saving doesn't reset it. */
	audience: InterviewTimelineEntry["audience"];
	timezone: string;
	participants: Participant[];
};

const pad = (value: number) => String(value).padStart(2, "0");

// New interviews default to tomorrow at 09:00 in the timezone, or the next full hour if that has passed.
function emptyDraft(timezone: string): Draft {
	const now = new Date();
	const tomorrow = new Date(now.getTime() + 86_400_000);
	const day = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;
	let at = fromZonedDateTime(day, "09:00", timezone) ?? now;
	if (at <= now) at = new Date(Math.ceil(now.getTime() / 3_600_000) * 3_600_000);
	return {
		kind: "screening",
		...zonedParts(at, timezone),
		durationMinutes: 60,
		location: "",
		notes: "",
		audience: "other",
		timezone,
		participants: [],
	};
}

function draftFrom(interview: InterviewTimelineEntry, fallbackZone: string): Draft {
	const timezone = interview.timezone && isTimeZone(interview.timezone) ? interview.timezone : fallbackZone;
	return {
		kind: interview.kind,
		...zonedParts(interview.at, timezone),
		durationMinutes: interview.durationMinutes,
		location: interview.location,
		notes: interview.notes,
		audience: interview.audience ?? "other",
		timezone,
		participants: (interview.participants ?? []).map((person) => ({
			id: generateId(),
			name: person.name,
			role: person.role,
			profileUrl: person.profileUrl ?? "",
		})),
	};
}

type InterviewSheetProps = {
	application: Application;
	/** The interview to edit, or null to schedule a new one. */
	interview: InterviewTimelineEntry | null;
	open: boolean;
	onClose: () => void;
};

/** Schedule or edit an interview: type, wall-clock time in the interview's timezone, people, and a local reminder. */
export function InterviewSheet({ application, interview, open, onClose }: InterviewSheetProps) {
	return open ? <InterviewForm application={application} interview={interview} onClose={onClose} /> : null;
}

type InterviewFormProps = Omit<InterviewSheetProps, "open">;

function InterviewForm({ application, interview, onClose }: InterviewFormProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const queryClient = useQueryClient();
	const { timeZone: userZone, when } = useUserTime();
	const mutations = useDetailMutations(application.id);
	const invalidate = useInvalidateApplications();
	const reminders = useReminders(application.id);
	const [initial] = useState(() => (interview ? draftFrom(interview, userZone) : emptyDraft(userZone)));
	const [draft, setDraft] = useState(initial);
	const saving = useRef(false);
	const [zonePicker, setZonePicker] = useState(false);
	const [zoneLimit, setZoneLimit] = useState(40);
	const [zoneQuery, setZoneQuery] = useState("");
	const existingLead = interview
		? reminders.leadFor({ kind: "interview", applicationId: application.id, entryId: interview.id })
		: null;
	const [remind, setRemind] = useState<{ on: boolean; lead: number } | null>(null);
	const reminder = remind ?? { on: existingLead !== null, lead: existingLead ?? DEFAULT_LEAD };

	const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
		if (!saving.current) setDraft((current) => ({ ...current, [key]: value }));
	};
	const setPerson = (id: string, patch: Partial<Participant>) =>
		set(
			"participants",
			draft.participants.map((person) => (person.id === id ? { ...person, ...patch } : person)),
		);

	const original = interview ? zonedParts(interview.at, draft.timezone) : null;
	// Keep the exact stored instant when the clock time is unchanged, including inside a DST overlap.
	const at =
		interview && original?.date === draft.date && original.time === draft.time
			? new Date(interview.at)
			: fromZonedDateTime(draft.date, draft.time, draft.timezone);
	const details = interviewDetailsSchema.safeParse({
		...draft,
		participants: draft.participants
			.filter(({ name }) => name.trim())
			.map(({ name, role, profileUrl }) => ({
				name,
				role,
				...(profileUrl.trim() ? { profileUrl: profileUrl.trim() } : {}),
			})),
	});
	const peopleInvalid = details.error?.issues.some((issue) => issue.path[0] === "participants") ?? false;
	const pending = mutations.addInterview.isPending || mutations.updateInterview.isPending;
	const dirty =
		JSON.stringify(draft) !== JSON.stringify(initial) ||
		(remind !== null && (remind.on !== (existingLead !== null) || remind.lead !== (existingLead ?? DEFAULT_LEAD)));
	const lengths = LENGTHS.includes(draft.durationMinutes)
		? LENGTHS
		: [...LENGTHS, draft.durationMinutes].sort((a, b) => a - b);
	const query = zoneQuery.trim().toLowerCase().replaceAll(" ", "_");
	const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	const allZones = [...new Set([...timeZones, deviceZone, userZone, draft.timezone])].sort();
	const matchingZones = allZones.filter((zone) => zone.toLowerCase().includes(query));
	const zones = matchingZones.slice(0, zoneLimit);

	const applyReminder = async (saved: Application, entryId: string) => {
		const entry = saved.activity.filter(isInterview).find((item) => item.id === entryId);
		if (!entry) return;
		const target = interviewReminder(saved, entry);
		if (!reminder.on) return existingLead !== null ? reminders.turnOff(target) : undefined;
		const result = await reminders.turnOn(target, reminder.lead);
		if (result === "denied")
			showToast({
				message: t`The interview is saved. To get a reminder, allow notifications in your device settings.`,
				action: { label: t`Settings`, onPress: () => void Linking.openSettings() },
			});
		if (result === "passed") showToast({ message: t`Interview saved. The reminder time has already passed.` });
	};

	const save = async () => {
		if (!at || !details.success || pending || saving.current) return;
		saving.current = true;
		const input = { id: application.id, at: at.toISOString(), ...details.data };
		let saved: Application;
		let entryId: string | undefined;
		try {
			if (interview) {
				saved = await mutations.updateInterview.mutateAsync({ ...input, entryId: interview.id });
				entryId = interview.id;
			} else {
				const known = new Set(application.activity.map((entry) => entry.id));
				saved = await mutations.addInterview.mutateAsync(input);
				entryId = saved.activity.find((entry) => entry.type === "interview" && !known.has(entry.id))?.id;
			}
		} catch {
			saving.current = false;
			showToast({
				message: interview
					? t`Couldn't update the interview. Try again.`
					: t`Couldn't confirm the save. Check the application before retrying to avoid a duplicate.`,
			});
			return;
		}
		onClose();
		showToast({ message: t`Interview saved` });
		try {
			if (entryId) await applyReminder(saved, entryId);
		} catch {
			showToast({ message: t`Interview saved. Couldn't update its reminder. Edit the interview to try again.` });
		}
	};

	// Hidden at once and committed when the undo toast ends, so Undo keeps the round's identity and history.
	// ponytail: the commit lives in a JS timer; if the app is killed first, the interview simply stays.
	const remove = () => {
		if (!interview || saving.current) return;
		const key = applicationDetailQueryKey(application.id);
		queryClient.setQueryData<Application>(key, (current) =>
			current ? { ...current, activity: current.activity.filter((entry) => entry.id !== interview.id) } : current,
		);
		onClose();
		// Its reminder stays scheduled through the undo window and is cancelled only once the delete commits.
		holdReminder(interview.id);
		const target = { kind: "interview", applicationId: application.id, entryId: interview.id } as const;
		const timer = setTimeout(() => {
			// The form is gone by now, so this calls the client directly rather than through a mounted mutation.
			void client.applications
				.deleteTimelineEntry({ id: application.id, entryId: interview.id })
				.then(() => reminders.turnOff(target))
				.catch(() => showToast({ message: t`Couldn't delete the interview. Try again.` }))
				.finally(() => {
					releaseReminder(interview.id);
					void invalidate();
				});
		}, toastLifetime(UNDO_MS));
		showToast({
			message: t`Interview deleted`,
			duration: UNDO_MS,
			action: {
				label: t`Undo`,
				onPress: () => {
					clearTimeout(timer);
					releaseReminder(interview.id);
					void invalidate();
				},
			},
		});
	};

	return (
		<EditorSheet
			onClose={onClose}
			dirty={dirty}
			pending={pending}
			detents={[0.92]}
			title={interview ? t`Edit interview` : t`Schedule an interview`}
			footer={
				<Button
					size="lg"
					fullWidth
					label={t`Save interview`}
					loading={pending}
					disabled={!at || !details.success}
					onPress={() => void save()}
				/>
			}
		>
			<View style={{ gap: space.s4 }}>
				<Text color="ink2">
					{application.role} · {application.company}
				</Text>

				<View style={{ gap: space.s2 }}>
					<Text variant="callout" color="ink2">
						{t`Type`}
					</Text>
					<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s2 }}>
						{KINDS.map((kind) => (
							<Chip
								key={kind}
								label={interviewTypeLabel(kind)}
								selected={draft.kind === kind}
								onPress={() => set("kind", kind)}
							/>
						))}
					</View>
				</View>

				<View style={{ flexDirection: "row", gap: space.s4 }}>
					<WallClockField
						label={t`Date`}
						mode="date"
						value={draft.date}
						disabled={pending}
						onChange={(date) => set("date", date)}
					/>
					<WallClockField
						label={t`Time · ${draft.timezone}`}
						mode="time"
						disabled={pending}
						value={draft.time}
						onChange={(time) => set("time", time)}
						error={at ? undefined : t`This time does not exist in the selected timezone. Choose another time.`}
					/>
				</View>

				<View style={{ gap: space.s2 }}>
					<Text variant="callout" color="ink2">
						{t`Length · minutes`}
					</Text>
					<Segmented
						label={t`Length in minutes`}
						value={String(draft.durationMinutes)}
						options={lengths.map((minutes) => ({ value: String(minutes), label: String(minutes) }))}
						onChange={(minutes) => set("durationMinutes", Number(minutes))}
					/>
				</View>

				{zonePicker || draft.timezone !== userZone ? (
					<View style={{ gap: space.s2 }}>
						<TextField
							label={t`Interview timezone`}
							value={zoneQuery}
							onChangeText={(value) => {
								setZoneQuery(value);
								setZoneLimit(40);
							}}
							placeholder={draft.timezone.replaceAll("_", " ")}
							autoCapitalize="none"
							autoCorrect={false}
						/>
						{zonePicker || query ? (
							<View>
								{(zones.length > 0 || !isTimeZone(zoneQuery.trim()) ? zones : [zoneQuery.trim()]).map((zone) => (
									<ListRow
										key={zone}
										title={zone.replaceAll("_", " ")}
										selected={zone === draft.timezone}
										onPress={() => {
											set("timezone", zone);
											setZoneQuery("");
										}}
									/>
								))}
								{matchingZones.length > zoneLimit ? (
									<Button variant="ghost" label={t`Show more`} onPress={() => setZoneLimit((limit) => limit + 40)} />
								) : null}
							</View>
						) : null}
						{at && draft.timezone !== userZone ? (
							<Text variant="callout" color="ink3">
								{t`${draft.time} in ${draft.timezone} is ${when(at)} in your timezone (${userZone}).`}
							</Text>
						) : null}
					</View>
				) : (
					<View style={{ gap: space.s1 }}>
						<Text variant="callout" color="ink3">
							{t`Shown in your timezone.`}
						</Text>
						<Button variant="link" label={t`Interview is in another timezone`} onPress={() => setZonePicker(true)} />
					</View>
				)}

				<TextField
					label={t`Location`}
					editable={!pending}
					value={draft.location}
					maxLength={500}
					placeholder={t`Video link, office address, or phone number`}
					autoCapitalize="none"
					onChangeText={(location) => set("location", location)}
				/>

				<View style={{ gap: space.s3 }}>
					<Text variant="label">{t`Who you'll meet`}</Text>
					{draft.participants.map((person, index) => (
						<View key={person.id} style={{ gap: space.s2 }}>
							<View style={{ flexDirection: "row", alignItems: "flex-end", gap: space.s2 }}>
								<View style={{ flex: 1 }}>
									<TextField
										label={t`Name of person ${index + 1}`}
										editable={!pending}
										value={person.name}
										maxLength={200}
										onChangeText={(name) => setPerson(person.id, { name })}
									/>
								</View>
								<IconButton
									icon="x"
									label={t`Remove person ${index + 1}`}
									disabled={pending}
									onPress={() =>
										set(
											"participants",
											draft.participants.filter((item) => item.id !== person.id),
										)
									}
								/>
							</View>
							<TextField
								label={t`Role`}
								editable={!pending}
								value={person.role}
								maxLength={200}
								onChangeText={(role) => setPerson(person.id, { role })}
							/>
							<TextField
								label={t`Profile link (optional)`}
								editable={!pending}
								value={person.profileUrl}
								maxLength={2048}
								keyboardType="url"
								autoCapitalize="none"
								autoCorrect={false}
								onChangeText={(profileUrl) => setPerson(person.id, { profileUrl })}
							/>
						</View>
					))}
					{peopleInvalid ? (
						<Text variant="callout" color="dangerText">
							{t`Profile links must be public HTTPS addresses.`}
						</Text>
					) : null}
					<Button
						variant="ghost"
						icon="user-plus"
						label={t`Add a person`}
						disabled={pending || draft.participants.length >= 20}
						onPress={() =>
							set("participants", [...draft.participants, { id: generateId(), name: "", role: "", profileUrl: "" }])
						}
					/>
					<Text variant="callout" color="ink3">
						{t`Public HTTPS profile links are optional and only used if Web research is on.`}
					</Text>
				</View>

				<TextArea
					label={t`What they asked you to prepare`}
					editable={!pending}
					value={draft.notes}
					maxLength={5000}
					minLines={3}
					onChangeText={(notes) => set("notes", notes)}
				/>

				<View style={{ gap: space.s2 }}>
					<ListRow
						title={t`Remind me on this device`}
						subtitle={t`Only this device schedules the notification.`}
						trailing={
							<Switch
								label={t`Remind me on this device`}
								disabled={pending}
								value={reminder.on}
								onValueChange={(on) => setRemind({ ...reminder, on })}
							/>
						}
					/>
					{reminder.on ? (
						<Segmented
							label={t`Before interview`}
							value={String(reminder.lead)}
							options={REMINDER_LEADS.map((lead) => ({ value: String(lead), label: leadLabel(lead) }))}
							onChange={(lead) => {
								if (!saving.current) setRemind({ ...reminder, lead: Number(lead) });
							}}
						/>
					) : null}
				</View>

				{interview ? (
					<Button
						variant="danger"
						fullWidth
						icon="trash"
						label={t`Delete interview`}
						disabled={pending}
						onPress={remove}
					/>
				) : null}
			</View>
		</EditorSheet>
	);
}
