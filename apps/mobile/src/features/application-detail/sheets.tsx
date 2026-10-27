import type { Application, ApplicationSummary } from "@/features/applications/types";
import type { ReminderTarget } from "@/features/reminders";
import type {
	ApplicationClosedReason,
	ApplicationTimelineEntry,
	Contact,
} from "@reactive-resume/schema/applications/data";
import { useLingui } from "@lingui/react/macro";
import { openBrowserAsync } from "expo-web-browser";
import { useState } from "react";
import { Linking, View } from "react-native";
import { contactSchema } from "@reactive-resume/schema/applications/data";
import { WallClockField } from "./date-field";
import { followUpReminder, leadLabel, useDocuments, useUserTime } from "./hooks";
import { followUpDay } from "@/features/applications-board/calendar";
import { applicationError } from "@/features/applications/error";
import { useApplication, useApplicationMutations } from "@/features/applications/queries";
import { CLOSED_REASONS, getClosedReasonLabel } from "@/features/applications/stages";
import { DEFAULT_LEAD, followUpStart, REMINDER_LEADS, useReminders } from "@/features/reminders";
import {
	Banner,
	Button,
	Chip,
	IconButton,
	ListRow,
	Segmented,
	SelectSheet,
	Sheet,
	showToast,
	Switch,
	Text,
	TextArea,
	TextField,
	useTheme,
} from "@/ui";

type SheetBaseProps = { open: boolean; onClose: () => void };
type ApplicationActionSheetProps = SheetBaseProps & { application: ApplicationSummary };
type ApplicationContentSheetProps = SheetBaseProps & { application: Application };

const today = () => new Date().toLocaleDateString("en-CA");

/** "Close this application": one reason, kept for Insights. */
export function CloseSheet({ application, open, onClose }: ApplicationActionSheetProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const { update } = useApplicationMutations();
	const [reason, setReason] = useState<ApplicationClosedReason>("not-selected");

	return (
		<Sheet
			open={open}
			onClose={onClose}
			title={t`Close this application`}
			footer={
				<View style={{ gap: space.s2 }}>
					<Button
						fullWidth
						size="lg"
						label={t`Close application`}
						onPress={() => {
							onClose();
							update.mutate(
								{ id: application.id, status: "closed", closedReason: reason },
								{
									onSuccess: () => showToast({ message: t`Application closed` }),
									onError: (error) => showToast({ message: applicationError(error) }),
								},
							);
						}}
					/>
					<Button fullWidth variant="secondary" label={t`Cancel`} onPress={onClose} />
				</View>
			}
		>
			{CLOSED_REASONS.map((value) => (
				<ListRow
					key={value}
					title={getClosedReasonLabel(value)}
					leading={value === reason ? "check-circle" : "circle"}
					selected={value === reason}
					onPress={() => setReason(value)}
				/>
			))}
			<Text variant="callout" color="ink3" style={{ paddingHorizontal: space.s4 }}>
				{t`The reason is kept for Insights. Linked documents aren't touched.`}
			</Text>
		</Sheet>
	);
}

/** Saved → Applied: the date and the documents actually sent; their current versions are kept. */
export function MarkAppliedSheet({ application, open, onClose }: ApplicationActionSheetProps) {
	const { t } = useLingui();
	return (
		<Sheet open={open} onClose={onClose} title={t`Mark as applied`}>
			{open ? <MarkAppliedForm application={application} onClose={onClose} /> : null}
		</Sheet>
	);
}

function MarkAppliedForm({ application, onClose }: Omit<ApplicationActionSheetProps, "open">) {
	const { t } = useLingui();
	const { space } = useTheme();
	const { update } = useApplicationMutations();
	const detail = useApplication(application.id);
	const documents = useDocuments();
	const [date, setDate] = useState(today);
	const [resumeId, setResumeId] = useState(application.resumeId ?? "");
	const [letterId, setLetterId] = useState(application.coverLetterId ?? "");
	const [resumeFileSent, setResumeFileSent] = useState(true);
	const [letterFileSent, setLetterFileSent] = useState(true);
	const none = { value: "", label: t`None` };
	// Cached full details remain usable while a background refresh reports an error.
	const detailsReady = Boolean(detail.data);
	const resumeAttachment = detail.data?.resumeFileUrl
		? { url: detail.data.resumeFileUrl, name: detail.data.resumeFileName ?? "PDF" }
		: null;
	const coverLetterAttachment = detail.data?.coverLetterUrl
		? { url: detail.data.coverLetterUrl, name: detail.data.coverLetterName ?? "PDF" }
		: null;
	const options = (type: "resume" | "letter") => [
		none,
		...(documents.data ?? [])
			.filter((document) => document.type === type)
			.map((document) => ({ value: document.id, label: document.name })),
	];

	return (
		<View style={{ gap: space.s3, paddingHorizontal: space.s4 }}>
			<Text color="ink2">
				{t`Confirm submission and choose the documents you actually sent. Their current versions will be saved.`}
			</Text>
			<WallClockField label={t`Application date`} mode="date" value={date} onChange={setDate} />
			<SelectSheet
				label={t`Resume submitted (optional)`}
				value={resumeId}
				options={options("resume")}
				onChange={setResumeId}
			/>
			<SelectSheet
				label={t`Cover letter submitted (optional)`}
				value={letterId}
				options={options("letter")}
				onChange={setLetterId}
			/>
			{resumeAttachment ? (
				<ListRow
					title={t`Submitted attached resume: ${resumeAttachment.name}`}
					trailing={
						<Switch label={t`Submitted attached resume`} value={resumeFileSent} onValueChange={setResumeFileSent} />
					}
				/>
			) : null}
			{coverLetterAttachment ? (
				<ListRow
					title={t`Submitted attached cover letter: ${coverLetterAttachment.name}`}
					trailing={
						<Switch
							label={t`Submitted attached cover letter`}
							value={letterFileSent}
							onValueChange={setLetterFileSent}
						/>
					}
				/>
			) : null}
			{detail.isError ? (
				<Banner
					tone="danger"
					message={t`Couldn't load this. Check your connection and try again.`}
					action={{ label: t`Retry loading applications`, onPress: () => void detail.refetch() }}
				/>
			) : null}
			{update.error ? <Banner tone="danger" message={t`Couldn't record submission. Try again.`} /> : null}
			<Button
				fullWidth
				size="lg"
				label={t`Confirm applied`}
				loading={update.isPending}
				disabled={!date || !detailsReady}
				onPress={() =>
					update.mutate(
						{
							id: application.id,
							status: "applied",
							stageEnteredAt: date,
							resumeId: resumeId || null,
							coverLetterId: letterId || null,
							...(!resumeFileSent ? { resumeFileUrl: null, resumeFileName: null } : {}),
							...(!letterFileSent ? { coverLetterUrl: null, coverLetterName: null } : {}),
						},
						{ onSuccess: onClose },
					)
				}
			/>
			<Button fullWidth variant="secondary" label={t`Cancel`} onPress={onClose} />
		</View>
	);
}

/** The follow-up: a day and what to do, shown as the next step until done, with an optional local reminder. */
export function FollowUpSheet({ application, open, onClose }: ApplicationActionSheetProps) {
	const { t } = useLingui();
	return (
		<Sheet open={open} onClose={onClose} title={t`Follow-up`}>
			{open ? <FollowUpForm application={application} onClose={onClose} /> : null}
		</Sheet>
	);
}

function FollowUpForm({ application, onClose }: Omit<ApplicationActionSheetProps, "open">) {
	const { t } = useLingui();
	const { space } = useTheme();
	const { timeZone } = useUserTime();
	const { update } = useApplicationMutations();
	const reminders = useReminders(application.id);
	const existing = reminders.leadFor({ kind: "follow-up", applicationId: application.id });
	const [date, setDate] = useState(() =>
		// Web stores the bare date at UTC midnight; read it as that date, not the evening before west of UTC.
		application.followUpAt ? followUpDay(application.followUpAt, timeZone) : "",
	);
	const [note, setNote] = useState(application.followUpNote ?? "");
	const [remind, setRemind] = useState<boolean | null>(null);
	const reminderOn = remind ?? existing !== null;

	const save = (followUpAt: Date | null) =>
		update.mutate(
			{ id: application.id, followUpAt, followUpNote: followUpAt ? note.trim() || null : null },
			{
				onSuccess: async (saved) => {
					onClose();
					const target = followUpReminder(saved);
					if (target && reminderOn) {
						const result = await reminders.turnOn(target, 0);
						if (result === "denied")
							showToast({
								message: t`The follow-up is saved. To get a reminder, allow notifications in your device settings.`,
								action: { label: t`Settings`, onPress: () => void Linking.openSettings() },
							});
					} else if (existing !== null) {
						await reminders.turnOff({ kind: "follow-up", applicationId: application.id });
					}
				},
				onError: () => showToast({ message: t`Couldn't save the follow-up. Try again.` }),
			},
		);

	return (
		<View style={{ gap: space.s3, paddingHorizontal: space.s4 }}>
			<Text color="ink2">{t`A reminder to check in, shown as the next step until you do.`}</Text>
			<WallClockField label={t`Date`} mode="date" value={date} onChange={setDate} />
			<TextField label={t`What to do`} value={note} placeholder={t`Email the recruiter`} onChangeText={setNote} />
			<ListRow
				title={t`Remind me on this device`}
				subtitle={t`At 09:00 that day (${timeZone}).`}
				trailing={<Switch label={t`Remind me on this device`} value={reminderOn} onValueChange={setRemind} />}
			/>
			<Button
				fullWidth
				size="lg"
				label={t`Save`}
				loading={update.isPending}
				disabled={!date}
				onPress={() => {
					const at = followUpStart(date, timeZone);
					if (at) save(at);
				}}
			/>
			{application.followUpAt ? (
				<Button fullWidth variant="ghost" label={t`Clear`} disabled={update.isPending} onPress={() => save(null)} />
			) : null}
		</View>
	);
}

type ReminderSheetProps = SheetBaseProps & {
	target: ReminderTarget | null;
	/** "Mon 19 Oct, 16:00 · Europe/Berlin" */
	subtitle: string;
	onShareIcs: () => void;
};

/** A local notification for the next step; permission is asked when it's turned on, never before. */
export function ReminderSheet({ target, subtitle, open, onClose, onShareIcs }: ReminderSheetProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const reminders = useReminders(target?.applicationId ?? "");
	const [denied, setDenied] = useState(false);
	const [busy, setBusy] = useState(false);
	if (!target) return null;
	const lead = reminders.leadFor(target);
	const interview = target.kind === "interview";

	const turnOn = async (minutes: number) => {
		setBusy(true);
		try {
			const result = await reminders.turnOn(target, minutes);
			setDenied(result === "denied");
			if (result === "passed") showToast({ message: t`That reminder time has already passed.` });
		} finally {
			setBusy(false);
		}
	};

	return (
		<Sheet open={open} onClose={onClose} title={target.title}>
			<View style={{ gap: space.s3, paddingHorizontal: space.s4 }}>
				<Text color="ink2">{subtitle}</Text>
				<ListRow
					title={t`Remind me on this device`}
					trailing={
						<Switch
							label={t`Remind me on this device`}
							value={lead !== null}
							disabled={busy}
							onValueChange={(on) => void (on ? turnOn(interview ? DEFAULT_LEAD : 0) : reminders.turnOff(target))}
						/>
					}
				/>
				{interview && lead !== null ? (
					<Segmented
						label={t`Before interview`}
						value={String(lead)}
						options={REMINDER_LEADS.map((minutes) => ({ value: String(minutes), label: leadLabel(minutes) }))}
						onChange={(minutes) => void turnOn(Number(minutes))}
					/>
				) : null}
				{denied ? (
					<Banner
						tone="warn"
						title={t`Notifications are off`}
						message={t`To get a reminder, allow notifications in your device settings.`}
						action={{ label: t`Open device settings`, onPress: () => void Linking.openSettings() }}
					/>
				) : (
					<Text variant="callout" color="ink3">
						{t`Only this device schedules the notification. Allow notifications when the system asks.`}
					</Text>
				)}
				<Button
					fullWidth
					variant="secondary"
					icon="calendar-plus"
					label={t`Share calendar event (.ics)`}
					onPress={onShareIcs}
				/>
			</View>
		</Sheet>
	);
}

/** The saved posting: its link, provenance, what it asks for, and its editable text. */
export function PostingSheet({ application, open, onClose }: ApplicationContentSheetProps) {
	return (
		<Sheet open={open} onClose={onClose} detents={[0.9]} title={`${application.role} · ${application.company}`}>
			{open ? <PostingBody application={application} onClose={onClose} /> : null}
		</Sheet>
	);
}

function PostingBody({ application, onClose }: Omit<ApplicationContentSheetProps, "open">) {
	const { t } = useLingui();
	const { space } = useTheme();
	const { update } = useApplicationMutations();
	const [text, setText] = useState(application.jobDescription ?? "");
	const source = application.postingSource;
	const sourceUrl = application.sourceUrl;

	return (
		<View style={{ gap: space.s3, paddingHorizontal: space.s4 }}>
			{sourceUrl ? <Button variant="link" label={sourceUrl} onPress={() => void openBrowserAsync(sourceUrl)} /> : null}
			{source ? (
				<Text variant="callout" color="ink3">
					{source.method === "paste"
						? t`Pasted description`
						: t`Retrieved ${source.retrievedAt} using ${source.method}. Retrieval time does not establish origin freshness.`}
				</Text>
			) : null}
			{source?.truncated || source?.completeness === "incomplete" ? (
				<Banner
					tone="warn"
					message={t`This saved description is clipped or incomplete. Review before preparing documents.`}
				/>
			) : null}
			{application.requirements.length > 0 ? (
				<View style={{ gap: space.s2 }}>
					<Text variant="label">{t`What it asks for`}</Text>
					<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s2 }}>
						{application.requirements.map((requirement) => (
							<Chip key={requirement} label={requirement} />
						))}
					</View>
				</View>
			) : null}
			<TextArea label={t`Job description`} value={text} minLines={8} maxLength={20_000} onChangeText={setText} />
			<Button
				fullWidth
				size="lg"
				label={t`Save changes`}
				loading={update.isPending}
				disabled={text === (application.jobDescription ?? "")}
				onPress={() =>
					update.mutate(
						{ id: application.id, jobDescription: text.trim() ? text : null },
						{
							onSuccess: onClose,
							onError: () => showToast({ message: t`Couldn't save the job description. Try again.` }),
						},
					)
				}
			/>
		</View>
	);
}

const EMPTY_CONTACT = { name: "", role: "", type: "", email: "", phone: "" };

/** Contacts: the list with remove, and a form to add one, checked with the API's schema before saving. */
export function ContactsSheet({ application, open, onClose }: ApplicationContentSheetProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const { update } = useApplicationMutations();
	const [draft, setDraft] = useState(EMPTY_CONTACT);
	const [error, setError] = useState("");
	const save = (contacts: Contact[], onSuccess = () => {}) =>
		update.mutate(
			{ id: application.id, contacts },
			{ onSuccess, onError: () => showToast({ message: t`Couldn't save the contacts. Try again.` }) },
		);
	const set = (key: keyof typeof EMPTY_CONTACT) => (value: string) => {
		setError("");
		setDraft((current) => ({ ...current, [key]: value }));
	};
	const add = () => {
		const parsed = contactSchema.safeParse(draft);
		if (!parsed.success) return setError(t`Enter a valid email address.`);
		save([...application.contacts, parsed.data], () => setDraft(EMPTY_CONTACT));
	};

	return (
		<Sheet open={open} onClose={onClose} detents={[0.9]} title={t`Contacts`}>
			{application.contacts.length === 0 ? (
				<Text color="ink3" style={{ paddingHorizontal: space.s4 }}>
					{t`No contacts yet.`}
				</Text>
			) : null}
			{application.contacts.map((contact, index) => (
				<ListRow
					key={`${contact.name}-${index}`}
					title={contact.type ? `${contact.name} · ${contact.type}` : contact.name}
					subtitle={[contact.role, contact.email, contact.phone].filter(Boolean).join(" · ") || undefined}
					{...(contact.email ? { onPress: () => void Linking.openURL(`mailto:${contact.email}`) } : {})}
					trailing={
						<IconButton
							icon="x"
							label={t`Remove ${contact.name}`}
							disabled={update.isPending}
							onPress={() => save(application.contacts.filter((_, i) => i !== index))}
						/>
					}
				/>
			))}
			<View style={{ gap: space.s3, paddingHorizontal: space.s4, paddingTop: space.s3 }}>
				<Text variant="label">{t`Add contact`}</Text>
				<TextField label={t`Name`} value={draft.name} onChangeText={set("name")} />
				<TextField label={t`Role (optional)`} value={draft.role} onChangeText={set("role")} />
				<TextField label={t`Label`} value={draft.type} placeholder={t`Recruiter`} onChangeText={set("type")} />
				<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s2 }}>
					{[t`Recruiter`, t`Hiring manager`, t`Referral`, t`Interviewer`].map((label) => (
						<Chip key={label} label={label} selected={draft.type === label} onPress={() => set("type")(label)} />
					))}
				</View>
				<TextField
					label={t`Email (optional)`}
					value={draft.email}
					keyboardType="email-address"
					autoCapitalize="none"
					autoCorrect={false}
					error={error || undefined}
					onChangeText={set("email")}
				/>
				<TextField
					label={t`Phone (optional)`}
					value={draft.phone}
					keyboardType="phone-pad"
					onChangeText={set("phone")}
				/>
				<Button
					fullWidth
					size="lg"
					label={t`Add contact`}
					loading={update.isPending}
					disabled={!draft.name.trim()}
					onPress={add}
				/>
			</View>
		</Sheet>
	);
}

type TimelineEntrySheetProps = SheetBaseProps & {
	entry: Exclude<ApplicationTimelineEntry, { type: "interview" }> | null;
	saving: boolean;
	onSave: (patch: { date: string; text?: string }) => void;
	onDelete: (() => void) | undefined;
};

/** Edit a stage or note entry's day (and a note's text); entries are whole days stored at noon UTC. */
export function TimelineEntrySheet({ entry, open, saving, onClose, onSave, onDelete }: TimelineEntrySheetProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const [date, setDate] = useState(() => (entry ? new Date(entry.at).toISOString().slice(0, 10) : ""));
	const [text, setText] = useState(entry?.type === "note" ? entry.text : "");

	return (
		<Sheet open={open} onClose={onClose} title={entry?.type === "note" ? t`Edit note` : t`Edit date`}>
			<View style={{ gap: space.s3, paddingHorizontal: space.s4 }}>
				{entry?.type === "note" ? <TextArea label={t`Note`} value={text} minLines={3} onChangeText={setText} /> : null}
				<WallClockField label={t`Date`} mode="date" value={date} onChange={setDate} />
				<Button
					fullWidth
					size="lg"
					label={t`Save`}
					loading={saving}
					disabled={!date}
					onPress={() => onSave({ date, ...(entry?.type === "note" && text.trim() ? { text: text.trim() } : {}) })}
				/>
				{onDelete ? <Button fullWidth variant="danger" label={t`Delete entry…`} onPress={onDelete} /> : null}
			</View>
		</Sheet>
	);
}
