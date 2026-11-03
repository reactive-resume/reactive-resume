import type { Application, ApplicationSummary } from "@/features/applications/types";
import type { InterviewKind, InterviewTimelineEntry } from "@reactive-resume/schema/applications/data";
import { i18n } from "@lingui/core";
import { useLingui } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState } from "react";
import { Linking, View } from "react-native";
import { interviewDetailsSchema, nextInterviewKind } from "@reactive-resume/schema/applications/data";
import { generateId } from "@reactive-resume/utils/string";
import { fromZonedDateTime } from "@reactive-resume/utils/timezone";
import { interviewCalendarAction, showInterviewCancellation } from "./calendar";
import { WallClockField } from "./date-field";
import {
	interviewReminder,
	interviewTypeLabel,
	isInterview,
	leadLabel,
	useDetailMutations,
	useUserTime,
} from "./hooks";
import { client, prepareRpc } from "@/api/client";
import { getAccountScope } from "@/auth/session";
import { applicationDetailQueryKey, useInvalidateApplications } from "@/features/applications/queries";
import { withUndo } from "@/features/career/undo";
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
	Switch,
	Text,
	TextArea,
	TextField,
	useTheme,
} from "@/ui";

const KINDS: InterviewKind[] = ["screening", "technical", "behavioral", "onsite", "other"];
const LENGTHS = [30, 45, 60, 90];

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
function emptyDraft(timezone: string, kind: InterviewKind = "screening"): Draft {
	const now = new Date();
	const tomorrow = new Date(now.getTime() + 86_400_000);
	const day = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;
	let at = fromZonedDateTime(day, "09:00", timezone) ?? now;
	if (at <= now) at = new Date(Math.ceil(now.getTime() / 3_600_000) * 3_600_000);
	return {
		kind,
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
	application: ApplicationSummary;
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
	// A new interview starts as the likely next type: after a screening, a technical round, and so on (web too).
	const [initial] = useState(() =>
		interview
			? draftFrom(interview, userZone)
			: emptyDraft(
					userZone,
					nextInterviewKind(
						application.activity.flatMap((entry) => (entry.type === "interview" ? [entry.kind] : [])),
						application.status === "interview" || application.status === "offer",
					),
				),
	);
	const [draft, setDraft] = useState(initial);
	const saving = useRef(false);
	const activeForm = useRef<symbol | null>(null);
	useLayoutEffect(() => {
		activeForm.current = Symbol();
		return () => {
			activeForm.current = null;
		};
	}, [application.id, interview?.id]);

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

	const applyReminder = (saved: Application, entryId: string) => {
		const entry = saved.activity.filter(isInterview).find((item) => item.id === entryId);
		if (!entry) return;
		const target = interviewReminder(saved, entry);
		if (!reminder.on) return existingLead !== null ? reminders.turnOff(target) : undefined;
		return reminders.turnOn(target, reminder.lead);
	};

	const save = async () => {
		const scope = getAccountScope();
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
			if (!scope || scope !== getAccountScope()) return;
			showToast({
				message: interview
					? t`Couldn't update the interview. Try again.`
					: t`Couldn't confirm the save. Check the application before retrying to avoid a duplicate.`,
			});
			return;
		}
		if (!scope || scope !== getAccountScope()) return;
		onClose();
		const savedInterview = saved.activity.find(
			(entry): entry is InterviewTimelineEntry => entry.type === "interview" && entry.id === entryId,
		);
		const calendar =
			interview && savedInterview ? interviewCalendarAction(application, savedInterview, "PUBLISH", scope) : undefined;
		showToast({ message: t`Interview saved`, ...(calendar ? { action: calendar } : {}) });
		try {
			const result = entryId ? await applyReminder(saved, entryId) : undefined;
			if (scope !== getAccountScope()) return;
			if (result === "denied")
				showToast({
					message: t`The interview is saved. To get a reminder, allow notifications in your device settings.`,
					action: calendar ?? { label: t`Settings`, onPress: () => void Linking.openSettings() },
				});
			if (result === "passed")
				showToast({
					message: t`Interview saved. The reminder time has already passed.`,
					...(calendar ? { action: calendar } : {}),
				});
		} catch {
			if (scope === getAccountScope())
				showToast({
					message: t`Interview saved. Couldn't update its reminder. Edit the interview to try again.`,
					...(calendar ? { action: calendar } : {}),
				});
		}
	};

	const remove = () => {
		if (!interview || saving.current) return;
		const form = activeForm.current;
		saving.current = true;
		const scope = getAccountScope();
		const current = () => !!scope && scope === getAccountScope();
		const key = applicationDetailQueryKey(application.id);
		const reconcile = async () => {
			releaseReminder(interview.id);
			if (!current()) return;
			await queryClient.cancelQueries({ queryKey: key });
			if (!current()) return;
			await queryClient.invalidateQueries({ queryKey: key, refetchType: "all" }, { throwOnError: true });
			if (current()) void invalidate();
		};
		const failed = () => {
			saving.current = false;
			if (current())
				showToast({
					message: t`Couldn't delete the interview. Try again.`,
					action: { label: t`Retry`, onPress: () => void reconcile().catch(failed) },
				});
		};
		withUndo({
			message: t`Interview deleted`,
			prepare: async () => {
				const request = await prepareRpc(client.applications.deleteTimelineEntry, {
					id: application.id,
					entryId: interview.id,
				});
				return {
					send: request.send,
					cancel: () => {
						request.cancel();
						releaseReminder(interview.id);
					},
				};
			},
			onReady: () => {
				holdReminder(interview.id);
				queryClient.setQueryData<Application>(key, (row) =>
					row ? { ...row, activity: row.activity.filter((entry) => entry.id !== interview.id) } : row,
				);
				if (form && activeForm.current === form) onClose();
			},
			restore: reconcile,
			failed,
			commit: async (result) => {
				try {
					await result;
					let message = t`Interview deleted`;
					const target = { kind: "interview", applicationId: application.id, entryId: interview.id } as const;
					try {
						if (current()) await reminders.turnOff(target);
					} catch {
						message = t`Interview deleted. Couldn't cancel its device reminder.`;
					}
					showInterviewCancellation(application, interview, scope, message);
				} finally {
					releaseReminder(interview.id);
					if (current()) void invalidate();
				}
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
										label={t`Name of person ${i18n.number(index + 1)}`}
										editable={!pending}
										value={person.name}
										maxLength={200}
										onChangeText={(name) => setPerson(person.id, { name })}
									/>
								</View>
								<IconButton
									icon="x"
									label={t`Remove person ${i18n.number(index + 1)}`}
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
