import type { AttachmentKind } from "./hooks";
import type { ApplicationLane } from "@/features/applications/lanes";
import type { Application } from "@/features/applications/types";
import type { ApplicationTimelineEntry, InterviewTimelineEntry } from "@reactive-resume/schema/applications/data";
import type { ReactNode } from "react";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { useRouter } from "expo-router";
import Storage from "expo-sqlite/kv-store";
import { openBrowserAsync } from "expo-web-browser";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, View } from "react-native";
import { attachmentProblem } from "./attachment";
import {
	followUpReminder,
	interviewReminder,
	interviewTypeLabel,
	useDetailMutations,
	useDocuments,
	useNow,
	useUserTime,
} from "./hooks";
import { createNotesQueue } from "./notes-queue";
import { ContactsSheet, FollowUpSheet, ReminderSheet, TimelineEntrySheet } from "./sheets";
import { client, orpc } from "@/api/client";
import { getServer } from "@/auth/session";
import { getDraftScope } from "@/draft";
import { applicationError } from "@/features/applications/error";
import { canonicalStageEntries, currentLaneEntry, laneSince } from "@/features/applications/history";
import { LaneNotice } from "@/features/applications/lane-notice";
import { useApplicationLanes } from "@/features/applications/lane-queries";
import {
	getLaneHistoryLabel,
	getLaneLabel,
	laneInput,
	nextActiveLane,
	resolveLane,
} from "@/features/applications/lanes";
import { describeNextStep, getNextStep } from "@/features/applications/next-step";
import { useApplicationMutations } from "@/features/applications/queries";
import { PIPELINE } from "@/features/applications/stages";
import { followUpEvent, icsFileName, interviewEvent, shareIcs, zonedParts } from "@/features/reminders";
import { shareDocumentPdf } from "@/features/share/files";
import { routes } from "@/routes";
import {
	Button,
	Card,
	ChipInput,
	ConfirmDialog,
	Icon,
	IconButton,
	ListGroup,
	ListRow,
	SelectSheet,
	Sheet,
	showToast,
	Text,
	TextArea,
	TextField,
	useTheme,
} from "@/ui";

type SectionProps = { application: Application };
type InterviewOpener = { onOpenInterview: (interview: InterviewTimelineEntry | null) => void };

type SectionBlockProps = { title: string; children: ReactNode };

export function Section({ title, children }: SectionBlockProps) {
	const { space } = useTheme();
	return (
		<View style={{ gap: space.s2 }}>
			<Text variant="eyebrow" color="ink3">
				{title}
			</Text>
			{children}
		</View>
	);
}

type StageStepperProps = SectionProps & {
	onMarkApplied: (lane: ApplicationLane) => void;
	onCloseLane: (lane: ApplicationLane) => void;
};

/** Lane identity is independent of canonical progress; the picker accommodates any lane count and label length. */
export function StageStepper({ application, onMarkApplied, onCloseLane }: StageStepperProps) {
	const { t } = useLingui();
	const { radius, space } = useTheme();
	const { update } = useApplicationMutations();
	const lanes = useApplicationLanes();
	const current = resolveLane(lanes.lanes, application);
	const lane =
		update.isPending && update.variables.laneId
			? (lanes.lanes.find((item) => item.id === update.variables.laneId) ?? current)
			: update.isPending && update.variables.status
				? resolveLane(lanes.lanes, { status: update.variables.status })
				: current;
	const now = useNow();
	const days = Math.max(0, Math.floor((now.getTime() - laneSince(application, lanes.lanes).getTime()) / 86_400_000));
	const next = nextActiveLane(lanes.lanes, application);
	const move = (id: string) => {
		const target = lanes.active.find((item) => item.id === id);
		if (!lanes.ready || !target || id === lane.id) return;
		if (target.category === "closed" && !target.closedReason) return onCloseLane(target);
		if (application.status === "saved" && target.category === "applied") return onMarkApplied(target);
		update.mutate(
			{ id: application.id, ...laneInput(target, lanes.supported) },
			{
				onSuccess: () => showToast({ message: t`Moved to ${getLaneLabel(target)}` }),
				onError: (error) => showToast({ message: applicationError(error) }),
			},
		);
	};
	return (
		<View style={{ gap: space.s3 }}>
			<LaneNotice />
			<View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.s2 }}>
				<View style={{ width: 8, height: 8, borderRadius: radius.rSm, backgroundColor: lane.color }} />
				<Text variant="label" style={{ flexShrink: 1 }}>
					{getLaneLabel(lane)}
				</Text>
				<Text color="ink3">
					{application.status === "closed"
						? ""
						: plural(days, { 0: "· since today", one: "· for # day", other: "· for # days" })}
				</Text>
			</View>
			<ListGroup>
				<SelectSheet
					appearance="row"
					label={t`Change lane`}
					value={lane.id}
					options={lanes.active.map((item) => ({ value: item.id, label: getLaneLabel(item) }))}
					disabled={update.isPending || !lanes.ready}
					onChange={move}
				/>
			</ListGroup>
			{next && (
				<Button
					label={t`Move to ${getLaneLabel(next)}`}
					variant="secondary"
					disabled={update.isPending || !lanes.ready}
					onPress={() => move(next.id)}
				/>
			)}
		</View>
	);
}

/** NEXT STEP: what the application needs, with reminder, calendar and edit actions for dated steps. */
export function NextStepCard({ application, onOpenInterview }: SectionProps & InterviewOpener) {
	const { t } = useLingui();
	const router = useRouter();
	const { colors, space } = useTheme();
	const { locale, timeZone, when, time, day } = useUserTime();
	const [followUpOpen, setFollowUpOpen] = useState(false);
	const [reminderOpen, setReminderOpen] = useState(false);
	const lanes = useApplicationLanes();
	const step = getNextStep(application, undefined, lanes.lanes, timeZone);
	const text = describeNextStep(step, application, locale, timeZone);
	const followUpDue = step.kind === "no-reply" || (step.kind === "follow-up" && step.overdue);
	const tab = step.kind === "interview" ? "prepare" : followUpDue ? "messages" : workspaceTabFor(application);
	const actionLabel = followUpDue
		? t`Draft a follow-up`
		: {
				fit: t`Prepare application`,
				apply: application.status === "saved" ? t`Prepare application` : t`Review application`,
				prepare: t`Prepare for interview`,
				debrief: t`Debrief interview`,
				messages: t`Prepare a reply`,
				saved: t`View saved work`,
			}[tab];
	const interview = step.kind === "interview" ? step.interview : null;
	const dated = step.kind === "interview" || step.kind === "follow-up";
	const target = interview ? interviewReminder(application, interview) : followUpReminder(application, timeZone);
	const zone = interview?.timezone && interview.timezone !== timeZone ? interview.timezone : null;
	const subtitle = interview
		? `${when(interview.at)}–${time(new Date(new Date(interview.at).getTime() + interview.durationMinutes * 60_000))} · ${timeZone}`
		: step.kind === "follow-up"
			? day(step.at)
			: "";

	const addToCalendar = () => {
		if (!dated) return;
		const title = `${text.title} · ${application.role}, ${application.company}`;
		void shareIcs(
			interview ? interviewEvent(interview, title) : followUpEvent(application.id, step.at, title),
			icsFileName(application.company, zonedParts(step.at, timeZone).date),
		).catch(() => showToast({ message: t`Couldn't share the calendar event. Try again.` }));
	};

	return (
		<Section title={t`Next step`}>
			<Card style={text.tone === "warn" ? { borderColor: colors.warn, backgroundColor: colors.warnSoft } : undefined}>
				<View style={{ gap: space.s3 }}>
					<View style={{ flexDirection: "row", gap: space.s3 }}>
						<Icon name={text.icon} />
						<View style={{ flex: 1, gap: space.s0 }}>
							<Text variant="label" color={text.tone === "warn" ? "warnText" : "ink"}>
								{text.title}
							</Text>
							{subtitle || text.sub ? <Text color="ink2">{subtitle || text.sub}</Text> : null}
							{zone && interview ? (
								<Text variant="callout" color="ink3">
									{`${time(interview.at, zone)} ${zone}`}
								</Text>
							) : null}
							{interview?.location ? (
								<Text variant="callout" color="ink3">
									{interview.location}
								</Text>
							) : null}
						</View>
					</View>
					<Button
						fullWidth
						icon="arrow-right"
						label={actionLabel}
						onPress={() => router.push(routes.application(application.id, tab))}
					/>
					{step.kind !== "closed" ? (
						<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s2 }}>
							{interview ? (
								<Button size="sm" variant="secondary" label={t`Edit`} onPress={() => onOpenInterview(interview)} />
							) : application.status !== "saved" ? (
								<Button
									size="sm"
									variant="secondary"
									label={t`Schedule an interview`}
									onPress={() => onOpenInterview(null)}
								/>
							) : null}
							{dated ? (
								<>
									<Button
										size="sm"
										variant="secondary"
										icon="bell"
										label={t`Reminder`}
										onPress={() => setReminderOpen(true)}
									/>
									<Button
										size="sm"
										variant="ghost"
										icon="calendar-plus"
										label={t`Add to calendar`}
										onPress={addToCalendar}
									/>
								</>
							) : null}
							<Button
								size="sm"
								variant="ghost"
								label={application.followUpAt ? t`Change the follow-up` : t`Set a follow-up`}
								onPress={() => setFollowUpOpen(true)}
							/>
						</View>
					) : null}
				</View>
			</Card>
			<FollowUpSheet application={application} open={followUpOpen} onClose={() => setFollowUpOpen(false)} />
			<ReminderSheet
				target={dated ? target : null}
				subtitle={subtitle}
				open={reminderOpen}
				onClose={() => setReminderOpen(false)}
				onShareIcs={addToCalendar}
			/>
		</Section>
	);
}

/** When it was sent: its first stage entry at Applied or beyond. */
function sentOn(application: Application) {
	const applied = PIPELINE.indexOf("applied");
	const entry = canonicalStageEntries(application)
		.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
		.find((item) => item.type === "stage" && PIPELINE.indexOf(item.stage) >= applied);
	return entry?.at ?? application.appliedAt;
}

/** WHAT YOU SENT: the linked resume and letter (linked is not the same as submitted), or ways to prepare them. */
type WhatYouSentProps = SectionProps & {
	/** Apply tab: a heading, the recorded submission line, and each row's current-draft actions (edit, download PDF). */
	drafts?: boolean | undefined;
};

export function WhatYouSent({ application, drafts = false }: WhatYouSentProps) {
	const { t } = useLingui();
	const { colors, size, space } = useTheme();
	const router = useRouter();
	const { utcDay } = useUserTime();
	const documents = useDocuments();
	const { createLetter } = useDetailMutations(application.id);
	const [menu, setMenu] = useState<"resume" | "letter" | null>(null);
	const [downloading, setDownloading] = useState<string | null>(null);
	const download = async (kind: "resume" | "letter", id: string, name: string) => {
		setDownloading(id);
		try {
			await shareDocumentPdf(kind, id, name);
		} catch {
			showToast({ message: t`Couldn't generate the PDF. Try again.` });
		} finally {
			setDownloading(null);
		}
	};
	const resume = documents.data?.find((item) => item.type === "resume" && item.id === application.resumeId);
	const letter = documents.data?.find((item) => item.type === "letter" && item.id === application.coverLetterId);
	const date = utcDay(sentOn(application));
	const { resumeId, coverLetterId, sentResumeVersionId, sentCoverLetterVersionId } = application;

	const writeLetter = () =>
		createLetter.mutate(
			{
				name: t`Cover letter — ${application.company}`.slice(0, 100),
				applicationId: application.id,
				...(resumeId ? { resumeId } : {}),
			},
			{
				onSuccess: (created) => router.push(routes.letter(created.id)),
				onError: () => showToast({ message: t`Couldn't create the letter. Try again.` }),
			},
		);

	// Current drafts stay editable after submission; the sent versions never change.
	const draftMenu = (kind: "resume" | "letter", id: string, name: string) =>
		drafts ? (
			<>
				<IconButton
					icon="dots-three"
					label={kind === "resume" ? t`Resume options` : t`Cover letter options`}
					size={20}
					color="ink2"
					onPress={() => setMenu(kind)}
				/>
				<Sheet
					open={menu === kind}
					onClose={() => setMenu(null)}
					title={kind === "resume" ? t`Resume options` : t`Cover letter options`}
				>
					<ListRow
						leading="pencil-simple"
						title={t`Edit current draft`}
						onPress={() => {
							setMenu(null);
							router.push(kind === "resume" ? routes.builder(id) : routes.letter(id));
						}}
					/>
					<ListRow
						leading="download-simple"
						title={downloading === id ? t`Generating PDF…` : t`Download current PDF`}
						disabled={downloading !== null}
						onPress={() => {
							setMenu(null);
							void download(kind, id, name);
						}}
					/>
				</Sheet>
			</>
		) : undefined;
	const body = (
		<>
			{drafts ? (
				<View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.s2 }}>
					<Icon name="check-circle" size={size.icon.meta} color={colors.accentText} />
					<Text variant="callout" color="ink2" style={{ flex: 1 }}>
						{t`Submission recorded ${date}. The sent versions never change; current drafts stay editable. This record does not confirm employer receipt.`}
					</Text>
				</View>
			) : null}
			{resumeId || coverLetterId ? (
				<Card style={{ padding: 0 }}>
					{resumeId ? (
						<ListRow
							leading="file-text"
							title={resume?.name ?? t`Linked resume`}
							subtitle={
								sentResumeVersionId
									? application.sentCheckScore !== null
										? t`Version sent ${date} · Check ${application.sentCheckScore}`
										: t`Version sent ${date}`
									: t`Linked · not sent yet`
							}
							chevron={!drafts}
							trailing={draftMenu("resume", resumeId, resume?.name ?? "resume")}
							accessibilityHint={sentResumeVersionId ? t`Opens the version you sent, read-only` : undefined}
							onPress={() =>
								router.push(
									sentResumeVersionId ? routes.history(resumeId, sentResumeVersionId) : routes.builder(resumeId),
								)
							}
						/>
					) : null}
					{coverLetterId ? (
						<ListRow
							leading="envelope-simple"
							title={letter?.name ?? t`Cover letter`}
							subtitle={sentCoverLetterVersionId ? t`Version sent ${date}` : t`Linked · not sent yet`}
							chevron={!drafts}
							trailing={draftMenu("letter", coverLetterId, letter?.name ?? "letter")}
							accessibilityHint={sentCoverLetterVersionId ? t`Opens the version you sent, read-only` : undefined}
							onPress={() => router.push(routes.letter(coverLetterId, "write", sentCoverLetterVersionId ?? undefined))}
						/>
					) : null}
				</Card>
			) : null}
			{!resumeId || !coverLetterId ? (
				<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s2 }}>
					{!resumeId ? (
						<Button
							size="sm"
							icon="copy"
							label={t`Prepare a resume`}
							onPress={() =>
								router.push(`${routes.new()}?step=copy&applicationId=${encodeURIComponent(application.id)}`)
							}
						/>
					) : null}
					{!coverLetterId ? (
						<Button
							size="sm"
							variant="secondary"
							icon="envelope-simple"
							label={t`Write a letter`}
							loading={createLetter.isPending}
							onPress={writeLetter}
						/>
					) : null}
				</View>
			) : null}
		</>
	);
	if (drafts)
		return (
			<View style={{ gap: space.s3 }}>
				<Text variant="heading" accessibilityRole="header">{t`What you sent`}</Text>
				{body}
			</View>
		);
	return (
		<Section title={application.status === "saved" ? t`Documents for this job` : t`What you sent`}>{body}</Section>
	);
}

type InlineFactProps = {
	label: string;
	value: string | null;
	/** Resolves once saved; a rejection keeps the typed text for another try. */
	onSave: (value: string | null) => Promise<unknown>;
	/** Required facts (role, company) can't be emptied. */
	required?: boolean | undefined;
	/** Rejects a value before saving, for example a link without http(s). */
	validate?: ((value: string) => string | null) | undefined;
	keyboardType?: "default" | "url" | undefined;
};

/** A fact that edits in place: tap to type, Done or leaving saves. The text stays until the save succeeds. */
function InlineFact({ label, value, onSave, required, validate, keyboardType = "default" }: InlineFactProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const [draft, setDraft] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const commit = async () => {
		// Done then blur both commit; one save at a time.
		if (draft === null || saving) return;
		const next = draft.trim() || null;
		const problem = next === null ? (required ? t`Enter a value.` : null) : validate ? validate(next) : null;
		if (problem) return setError(problem);
		if (next === (value ?? null)) return setDraft(null);
		setSaving(true);
		try {
			await onSave(next);
			setDraft(null);
			setError(null);
		} catch {
			setError(t`Couldn't save. Your text is still here; try again.`);
		} finally {
			setSaving(false);
		}
	};

	if (draft !== null)
		return (
			<TextField
				label={label}
				value={draft}
				autoFocus
				keyboardType={keyboardType}
				autoCapitalize={keyboardType === "url" ? "none" : "sentences"}
				returnKeyType="done"
				error={error ?? undefined}
				onChangeText={(text) => {
					setError(null);
					setDraft(text);
				}}
				editable={!saving}
				onSubmitEditing={() => void commit()}
				onBlur={() => void commit()}
			/>
		);
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={`${label}, ${value || "—"}`}
			onPress={() => setDraft(value ?? "")}
			style={{
				flexDirection: "row",
				justifyContent: "space-between",
				gap: space.s3,
				minHeight: 44,
				alignItems: "center",
			}}
		>
			<Text color="ink3">{label}</Text>
			<Text variant="label" numberOfLines={1} style={{ flexShrink: 1 }}>
				{value || "—"}
			</Text>
		</Pressable>
	);
}

const isHttpUrl = (value: string) => {
	try {
		const url = new URL(value);
		return url.protocol === "https:" || url.protocol === "http:";
	} catch {
		return false;
	}
};

/** FACTS: role, company, location, salary, source and posting link edit in place; Applied is the stage date. */
export function Facts({ application }: SectionProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const { date } = useUserTime();
	const { update } = useApplicationMutations();
	const save = (patch: Omit<Parameters<typeof update.mutate>[0], "id">) =>
		update.mutateAsync({ id: application.id, ...patch });

	return (
		<Section title={t`Facts`}>
			<Card>
				<View style={{ gap: space.s1 }}>
					<InlineFact label={t`Role`} value={application.role} required onSave={(role) => save({ role: role ?? "" })} />
					<InlineFact
						label={t`Company`}
						value={application.company}
						required
						onSave={(company) => save({ company: company ?? "" })}
					/>
					<InlineFact label={t`Location`} value={application.location} onSave={(location) => save({ location })} />
					<InlineFact label={t`Salary`} value={application.salary} onSave={(salary) => save({ salary })} />
					<InlineFact label={t`Source`} value={application.source} onSave={(source) => save({ source })} />
					<InlineFact
						label={t`Link`}
						value={application.sourceUrl}
						keyboardType="url"
						validate={(value) => (isHttpUrl(value) ? null : t`Use an http or https link.`)}
						onSave={(sourceUrl) => save({ sourceUrl })}
					/>
					<View style={{ flexDirection: "row", justifyContent: "space-between", minHeight: 44, alignItems: "center" }}>
						<Text color="ink3">{t`Applied`}</Text>
						<Text variant="label">{application.status === "saved" ? "—" : date(application.appliedAt)}</Text>
					</View>
				</View>
			</Card>
			<ChipInput
				label={t`Tags`}
				values={application.tags}
				placeholder={t`Add a tag`}
				onChange={(tags) =>
					update.mutate(
						{ id: application.id, tags: [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))] },
						{ onError: () => showToast({ message: t`Couldn't save the tags. Try again.` }) },
					)
				}
			/>
		</Section>
	);
}

export function Contacts({ application }: SectionProps) {
	const { t } = useLingui();
	const [open, setOpen] = useState(false);
	const [primary, ...others] = application.contacts;

	return (
		<Section title={t`Contacts`}>
			<Card style={{ padding: 0 }}>
				<ListRow
					leading="user-circle"
					title={primary ? (primary.type ? `${primary.name} · ${primary.type}` : primary.name) : t`No contacts yet.`}
					subtitle={others.length > 0 ? t`and ${others.length} more` : primary?.role || undefined}
					chevron
					accessibilityHint={t`Manage contacts`}
					onPress={() => setOpen(true)}
				/>
			</Card>
			<ContactsSheet application={application} open={open} onClose={() => setOpen(false)} />
		</Section>
	);
}

const NOTES_SAVE_DELAY_MS = 800;
const notesQueue = createNotesQueue(Storage);
// Partitioned like resume drafts (server + OAuth subject), so another account never sees or replays them.
const notesKey = async (applicationId: string) =>
	`reactive-resume:application-notes:${(await getDraftScope()) ?? JSON.stringify([getServer()])}:${applicationId}`;

/**
 * NOTES save a moment after typing stops, on blur and when leaving. Saves are serialized per application with the
 * latest text winning, and unsaved text is kept on the device (restored on the next visit) until a save succeeds.
 */
export function Notes({ application }: SectionProps) {
	const { t } = useLingui();
	const queryClient = useQueryClient();
	const id = application.id;
	const [key, setKey] = useState<string | null>(null);
	const [notes, setNotes] = useState(application.notes ?? "");
	const [failed, setFailed] = useState(false);
	const recovered = useRef(false);
	const [hasRecovered, setHasRecovered] = useState(false);
	// Typed but not handed to the queue yet.
	const unsent = useRef<string | null>(null);

	useEffect(() => {
		let live = true;
		void notesKey(id).then((resolved) => {
			if (!live) return;
			const kept = notesQueue.kept(resolved);
			if (kept !== null && unsent.current === null) {
				unsent.current = kept;
				recovered.current = kept !== (application.notes ?? "");
				setFailed(recovered.current);
				setHasRecovered(recovered.current);
				setNotes(kept);
			} else if (unsent.current !== null) notesQueue.keep(resolved, unsent.current);
			setKey(resolved);
		});
		return () => {
			live = false;
		};
	}, [id, application.notes]);

	const flush = useCallback(() => {
		const value = unsent.current;
		if (key === null || value === null || recovered.current) return;
		unsent.current = null;
		setFailed(false);
		notesQueue
			.save(key, value, async (text) => {
				if ((await notesKey(id)) !== key) throw new Error("Account changed");
				await client.applications.update({ id, notes: text.trim() ? text : null });
				void queryClient.invalidateQueries({ queryKey: orpc.applications.key() });
			})
			.catch(() => {
				setFailed(true);
				showToast({ message: t`Couldn't save the notes. Your text is still here.` });
			});
	}, [id, key, queryClient, t]);

	useEffect(() => {
		if (unsent.current === null) return;
		const timeout = setTimeout(flush, NOTES_SAVE_DELAY_MS);
		return () => clearTimeout(timeout);
	}, [notes, flush]);
	// Leaving mid-sentence still saves what was typed; the queue outlives this screen.
	useEffect(() => {
		const listener = AppState.addEventListener("change", (state) => {
			if (state !== "active") flush();
		});
		return () => {
			listener.remove();
			flush();
		};
	}, [flush]);

	return (
		<Section title={t`Notes`}>
			<TextArea
				label={t`Anything to remember about this job`}
				value={notes}
				minLines={4}
				onChangeText={(value) => {
					unsent.current = value;
					if (key !== null) notesQueue.keep(key, value);
					setNotes(value);
				}}
				onBlur={flush}
			/>
			{failed && hasRecovered && (
				<Text color="warnText">{t`Recovered an unsaved draft. Review it before saving over the current version.`}</Text>
			)}
			{failed ? (
				<>
					<Button
						variant="link"
						label={t`Retry save`}
						onPress={() => {
							recovered.current = false;
							setHasRecovered(false);
							unsent.current = notes;
							flush();
						}}
					/>
					{hasRecovered && (
						<Button
							variant="ghost"
							label={t`Use saved version`}
							onPress={() => {
								void client.applications
									.getById({ id })
									.then(async (server) => {
										if (key === null || (await notesKey(id)) !== key) return;
										notesQueue.discard(key);
										unsent.current = null;
										recovered.current = false;
										setHasRecovered(false);
										setNotes(server.notes ?? "");
										setFailed(false);
									})
									.catch(() =>
										showToast({ message: t`The server version couldn't be loaded. Your text is kept; try again.` }),
									);
							}}
						/>
					)}
				</>
			) : null}
		</Section>
	);
}

type DatedEntry = Exclude<ApplicationTimelineEntry, { type: "interview" }>;

/** TIMELINE: stage changes, notes and interviews, newest first; the entry anchoring the current stage stays. */
export function Timeline({ application, onOpenInterview }: SectionProps & InterviewOpener) {
	const { t } = useLingui();
	const { colors, radius, space } = useTheme();
	const { when, utcDay } = useUserTime();
	const { addNote, updateEntry, deleteEntry } = useDetailMutations(application.id);
	const [note, setNote] = useState("");
	const [editing, setEditing] = useState<DatedEntry | null>(null);
	const [deleting, setDeleting] = useState<ApplicationTimelineEntry | null>(null);
	const sorted = [...application.activity].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
	const lanes = useApplicationLanes();
	const anchorId = currentLaneEntry(application, lanes.lanes)?.id;
	const failed = () => showToast({ message: t`Couldn't update the timeline. Try again.` });
	const describe = (entry: ApplicationTimelineEntry) =>
		entry.type === "stage"
			? {
					dot: resolveLane(lanes.lanes, { status: entry.stage, laneId: entry.laneId }).color,
					text: t`Moved to ${getLaneHistoryLabel(lanes.lanes, entry)}`,
				}
			: entry.type === "note"
				? { dot: colors.ink3, text: entry.text }
				: {
						dot: colors.accent,
						text: [t`${interviewTypeLabel(entry.kind)} interview`, entry.location].filter(Boolean).join(" · "),
					};
	const submit = () => {
		const text = note.trim();
		if (!text || addNote.isPending) return;
		addNote.mutate({ id: application.id, text }, { onSuccess: () => setNote(""), onError: failed });
	};

	return (
		<Section title={t`Timeline`}>
			<View style={{ flexDirection: "row", alignItems: "flex-end", gap: space.s2 }}>
				<View style={{ flex: 1 }}>
					<TextField
						label={t`Add a note`}
						value={note}
						placeholder={t`Add a note…`}
						returnKeyType="send"
						editable={!addNote.isPending}
						onChangeText={setNote}
						onSubmitEditing={submit}
					/>
				</View>
				<Button
					variant="secondary"
					label={t`Add`}
					disabled={!note.trim()}
					loading={addNote.isPending}
					onPress={submit}
				/>
			</View>
			<Card style={{ padding: 0 }}>
				{sorted.map((entry) => {
					const { dot, text } = describe(entry);
					return (
						<ListRow
							key={entry.id}
							leading={<View style={{ width: 8, height: 8, borderRadius: radius.rSm, backgroundColor: dot }} />}
							title={text}
							subtitle={entry.type === "interview" ? when(entry.at) : utcDay(entry.at)}
							accessibilityHint={entry.type === "interview" ? t`Edit interview` : t`Edit entry`}
							onPress={() => (entry.type === "interview" ? onOpenInterview(entry) : setEditing(entry))}
							trailing={
								entry.id === anchorId ? null : (
									<IconButton icon="trash" size={18} label={t`Delete entry…`} onPress={() => setDeleting(entry)} />
								)
							}
						/>
					);
				})}
			</Card>
			<TimelineEntrySheet
				key={editing?.id ?? "none"}
				entry={editing}
				open={editing !== null}
				saving={updateEntry.isPending}
				onClose={() => setEditing(null)}
				onSave={(patch) =>
					editing &&
					updateEntry.mutate(
						{ id: application.id, entryId: editing.id, ...patch },
						{ onSuccess: () => setEditing(null), onError: failed },
					)
				}
				onDelete={
					editing && editing.id !== anchorId
						? () => {
								setDeleting(editing);
								setEditing(null);
							}
						: undefined
				}
			/>
			<ConfirmDialog
				open={deleting !== null}
				title={t`Delete this entry?`}
				message={t`It's removed from the timeline for good.`}
				confirmLabel={t`Delete entry`}
				destructive
				onCancel={() => setDeleting(null)}
				onConfirm={() => {
					if (deleting) deleteEntry.mutate({ id: application.id, entryId: deleting.id }, { onError: failed });
					setDeleting(null);
				}}
			/>
		</Section>
	);
}

/** Stored attachment URLs are same-origin uploads, often relative. */
const absoluteUrl = (url: string) => (url.startsWith("/") ? `${getServer()}${url}` : url);

/** ATTACHMENTS: the PDFs actually sent (≤ 10 MB each), apart from linked Reactive Resume documents. */
export function Attachments({ application }: SectionProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const { attach, removeDocument } = useDetailMutations(application.id);
	const [removing, setRemoving] = useState<AttachmentKind | null>(null);
	const busy = attach.isPending || removeDocument.isPending;
	const files = [
		{
			kind: "resume" as const,
			url: application.resumeFileUrl,
			name: application.resumeFileName || t`Resume file`,
			attachLabel: t`Attach a resume file (PDF)`,
		},
		{
			kind: "cover-letter" as const,
			url: application.coverLetterUrl,
			name: application.coverLetterName || t`Cover letter file`,
			attachLabel: t`Attach a cover letter (PDF)`,
		},
	];
	const problemText = {
		"not-pdf": t`Choose a PDF file. The selected file was not uploaded.`,
		"too-large": t`Choose a PDF smaller than 10 MB. The selected file was not uploaded.`,
		"unknown-size": t`This file's size couldn't be read. Choose another PDF.`,
	};

	const pick = async (kind: AttachmentKind) => {
		const result = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
		const asset = result.canceled ? null : result.assets[0];
		if (!asset) return;
		const copy = new File(asset.uri);
		try {
			const problem = attachmentProblem({ name: asset.name, size: asset.size ?? copy.size, mimeType: asset.mimeType });
			if (problem) return showToast({ message: problemText[problem] });
			await attach.mutateAsync({ kind, uri: asset.uri });
			showToast({ message: t`File attached` });
		} catch {
			showToast({ message: t`Couldn't upload the file. Try again.` });
		} finally {
			if (copy.exists) copy.delete();
		}
	};

	return (
		<Section title={t`Attachments`}>
			{files.map((file) =>
				file.url ? (
					<Card key={file.kind} style={{ padding: 0 }}>
						<ListRow
							leading="file-pdf"
							title={file.name}
							subtitle={t`PDF · tap to preview`}
							onPress={() => void openBrowserAsync(absoluteUrl(file.url ?? ""))}
							trailing={
								<IconButton icon="x" label={t`Remove file`} disabled={busy} onPress={() => setRemoving(file.kind)} />
							}
						/>
					</Card>
				) : (
					<Button
						key={file.kind}
						variant="secondary"
						fullWidth
						icon="upload-simple"
						label={file.attachLabel}
						loading={attach.isPending && attach.variables.kind === file.kind}
						disabled={busy}
						onPress={() => void pick(file.kind)}
					/>
				),
			)}
			<Text variant="callout" color="ink3" style={{ paddingHorizontal: space.s1 }}>
				{t`PDF only · up to 10 MB each. Linking a Reactive Resume enables AI match scoring and tailoring.`}
			</Text>
			<ConfirmDialog
				open={removing !== null}
				title={t`Remove this file?`}
				message={t`The application keeps its other details.`}
				confirmLabel={t`Remove file`}
				destructive
				onCancel={() => setRemoving(null)}
				onConfirm={() => {
					if (removing)
						removeDocument.mutate(
							{ id: application.id, kind: removing },
							{ onError: () => showToast({ message: t`Couldn't remove the file. Try again.` }) },
						);
					setRemoving(null);
				}}
			/>
		</Section>
	);
}

const DAY_MS = 86_400_000;

/** The workspace tab a stage opens on (web rule 7): Prepare before an interview, Debrief in the day after one. */
export function workspaceTabFor(application: Application, now = new Date()) {
	switch (application.status) {
		case "saved":
			return "apply";
		case "applied":
			return "apply";
		case "screening":
		case "interview": {
			const ends = application.activity
				.filter((entry) => entry.type === "interview")
				.map((entry) => new Date(entry.at).getTime() + entry.durationMinutes * 60_000);
			const upcoming = ends.some((end) => end >= now.getTime());
			const justEnded = ends.some((end) => end < now.getTime() && now.getTime() - end < DAY_MS);
			return !upcoming && justEnded ? "debrief" : "prepare";
		}
		case "offer":
			return "messages";
		case "closed":
			return "saved";
	}
}
