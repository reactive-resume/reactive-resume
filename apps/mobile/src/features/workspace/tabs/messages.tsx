// Messages (web workspace/messages.tsx, W15–W17): paste what the employer wrote, read it, reply yourself, and apply
// the changes it implies only if you choose.
import type { SavedData, SavedItem } from "../hooks";
import type { WorkspaceTabProps } from "../shell";
import type { SaveResult } from "../state";
import { plural, t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { ORPCError } from "@orpc/client";
import { useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import { replyPlaceholders } from "@reactive-resume/schema/applications/reply";
import { savedStageIn, stageBaselinesFor } from "@reactive-resume/schema/applications/stage-baselines";
import { offerTermKeys } from "@reactive-resume/schema/career-offer";
import { formatDateOnly } from "@reactive-resume/utils/timezone";
import { latest, useAutosave, useDraft, useGenerate, useSavedItems, useWorkspace } from "../hooks";
import { isFixedChange, needsSubmission, openChanges } from "../logic";
import {
	Actions,
	AiNotice,
	Block,
	CheckRow,
	Pill,
	SaveError,
	GenerateNotice,
	useWorking,
	workingSteps,
} from "../parts";
import { WorkspaceScreen } from "../shell";
import { createPendingRegistry, dispatchForOrigin } from "../state";
import { client, orpc } from "@/api/client";
import { getAccountScope, useSession } from "@/auth/session";
import { getDraftScope } from "@/draft";
import { useHasAIProvider } from "@/features/ai/providers";
import { useUserTime } from "@/features/application-detail/hooks";
import { useApplicationLanes } from "@/features/applications/lane-queries";
import { getLaneLabel, resolveLane } from "@/features/applications/lanes";
import { describeNextStep, getNextStep } from "@/features/applications/next-step";
import { stageScope, useInvalidateApplications } from "@/features/applications/queries";
import { listedApplication, offerHintFor, useOfferHints } from "@/features/applications/stage-actions";
import { formatMoney } from "@/features/career/offer-compare";
import { OfferEntry } from "@/features/career/offer-entry";
import { useReminders } from "@/features/reminders";
import { Banner, Button, Icon, Sheet, Skeleton, Text, TextArea, showToast, useTheme } from "@/ui";

type ReplyItem = SavedItem & { data: SavedData<"reply"> };

// The longest message kept from a paste (web messages).
const MAX_MESSAGE = 20_000;

const periodLabel = (period: "year" | "month" | "hour") =>
	({
		year: t`per year`,
		month: t`per month`,
		hour: t`per hour`,
	})[period];

/** Applies waiting on their Undo toast, by server and reply id; they outlive the Messages screen. */
const replyApplies = createPendingRegistry<{ changes: number[]; at: Date }>();

export function MessagesTab() {
	return <WorkspaceScreen tab="messages">{(props) => <Messages {...props} />}</WorkspaceScreen>;
}

function Messages({ application, version, now }: WorkspaceTabProps) {
	const { space } = useTheme();
	const router = useRouter();
	// "Add the offer's terms" from a move to Offer opens the offer form at once.
	const { offer } = useLocalSearchParams<{ offer?: string }>();
	const saved = useSavedItems(application.id);
	const workspace = useWorkspace(application.id);
	const readOnly = version?.data.kind === "reply";
	const reply = (readOnly ? version : latest(saved.data, "reply")) as ReplyItem | undefined;

	if (workspace.isPending || saved.isPending) return <Skeleton height={space.s12 * 3} />;

	return (
		<View style={{ gap: space.s4 }}>
			{!readOnly ? (
				<OfferEntry
					application={application}
					initialOpen={offer === "new"}
					onDone={() => router.setParams({ offer: undefined })}
				/>
			) : null}
			<PasteBox
				key={`paste-${version?.id ?? "live"}`}
				application={application}
				initial={readOnly ? (reply?.data.message ?? "") : workspace.data.message || (reply?.data.message ?? "")}
				readOnly={readOnly}
				onSave={(message) => workspace.save({ message })}
				fetchServer={() => workspace.fetchConfirmed().then((data) => data.message)}
			/>
			{reply ? <ReplyCard key={reply.id} reply={reply} application={application} readOnly={readOnly} /> : null}
			{reply && reply.data.changes.length > 0 ? (
				<ProposalCard
					key={`changes-${reply.id}`}
					reply={reply}
					application={application}
					now={now}
					readOnly={readOnly}
				/>
			) : null}
		</View>
	);
}

type PasteBoxProps = {
	application: WorkspaceTabProps["application"];
	initial: string;
	readOnly: boolean;
	onSave: (message: string) => Promise<SaveResult>;
	/** The message in a freshly fetched, server-confirmed workspace. */
	fetchServer: () => Promise<string>;
};

/** W15: the employer's message, kept with the application, and "Read it for me". */
function PasteBox({ application, initial, readOnly, onSave, fetchServer }: PasteBoxProps) {
	const { t, i18n } = useLingui();
	const { space } = useTheme();
	// Kept on the device until the server has it, so a failed save survives leaving the tab.
	const draft = useDraft(readOnly ? null : `message:${application.id}`, initial, true);
	const message = draft.value;
	const generate = useGenerate(application.id);
	const provider = useHasAIProvider().defaultProvider;
	const autosave = useAutosave(readOnly ? initial : message, initial, onSave, draft, fetchServer);
	const label = useWorking(generate.isPending, workingSteps("reply"), t`Read it for me`);
	const read = () => void generate.run({ task: "reply", message: message.trim() }).catch(() => undefined);
	const company = application.company;

	return (
		<View style={{ gap: space.s3 }}>
			<TextArea
				label={t`Paste a message from ${company}`}
				value={message}
				maxLength={MAX_MESSAGE}
				maxLines={12}
				editable={!readOnly}
				// A longer paste is cut at the limit: say so, rather than drop the rest silently (web messages).
				helper={
					message.length >= MAX_MESSAGE
						? t`Only the first ${i18n.number(MAX_MESSAGE)} characters are kept.`
						: t`Paste the email or message, without the signature.`
				}
				onChangeText={draft.setValue}
				onBlur={autosave.flush}
			/>
			<SaveError autosave={autosave} />
			{!readOnly ? (
				<View style={{ gap: space.s2 }}>
					<AiNotice task="reply" application={application} />
					<Button
						variant="secondary"
						label={t`Save message without AI`}
						disabled={!message.trim()}
						onPress={() => void autosave.flush()}
					/>
					{provider ? (
						<Button
							variant="secondary"
							icon="sparkle"
							label={label}
							loading={generate.isPending}
							disabled={!message.trim()}
							onPress={read}
						/>
					) : null}
					<GenerateNotice generate={generate} onRetry={read} />
				</View>
			) : null}
		</View>
	);
}

type ReplyCardProps = { reply: ReplyItem; application: WorkspaceTabProps["application"]; readOnly: boolean };

/** W16: what they're asking, what isn't confirmed, and a reply to edit and send yourself. */
function ReplyCard({ reply, application, readOnly }: ReplyCardProps) {
	const { t, i18n } = useLingui();
	const { colors, space } = useTheme();
	const [scope] = useState(getAccountScope);
	const invalidate = useInvalidateApplications();
	const copying = useRef(false);
	const [logging, setLogging] = useState(false);
	const reminders = useReminders(application.id);
	const clearFollowUpReminder = async (): Promise<boolean> => {
		if (!scope || scope !== getAccountScope()) return false;
		try {
			await reminders.turnOff({ kind: "follow-up", applicationId: application.id });
			return scope === getAccountScope();
		} catch {
			if (scope === getAccountScope())
				showToast({
					message: t`Couldn't clear the follow-up reminder. It may still notify you.`,
					action: { label: t`Retry`, onPress: () => void clearFollowUpReminder() },
				});
			return false;
		}
	};
	const clearReminder = useEffectEvent(() => {
		if (!application.followUpAt) void clearFollowUpReminder();
	});
	useEffect(() => clearReminder(), [application.id, application.followUpAt, scope]);
	const generate = useGenerate(application.id);
	const provider = useHasAIProvider().defaultProvider;
	const draft = useDraft(`reply:${reply.id}`, reply.data.reply);
	const text = readOnly ? reply.data.reply : draft.value;
	const placeholders = replyPlaceholders(text);
	// The employer's language is the default; this is the explicit way back to the user's interface language.
	const languageName = new Intl.DisplayNames([i18n.locale], { type: "language" }).of(i18n.locale) ?? i18n.locale;
	const rewrite = () =>
		void generate.run({ task: "reply", message: reply.data.message, replyLocale: i18n.locale }).catch(() => undefined);

	const copy = async (log = false) => {
		if ((log && !application.replyVersion) || copying.current || !scope || scope !== getAccountScope()) return;
		copying.current = true;
		setLogging(log);
		let copied = false;
		try {
			if (!(await Clipboard.setStringAsync(text))) throw new Error("Clipboard unavailable");
			copied = true;
			if (scope !== getAccountScope()) return;
			if (log && application.replyVersion) {
				await client.applications.logReply(
					{ id: application.id, expectedVersion: application.replyVersion },
					{ context: { scope } },
				);
				if (scope !== getAccountScope()) return;
				const cleared = await clearFollowUpReminder();
				if (scope !== getAccountScope()) return;
				await invalidate();
				if (!cleared || scope !== getAccountScope()) return;
			}
			showToast({ message: log ? t`Reply copied and logged as replied` : t`Reply copied` });
		} catch {
			if (scope !== getAccountScope()) return;
			if (copied) void invalidate();
			showToast({
				message: copied
					? t`Reply copied. Logging wasn't confirmed. Check the timeline before trying again.`
					: t`Couldn't copy the reply. Nothing was logged. Try again.`,
			});
		} finally {
			copying.current = false;
			setLogging(false);
		}
	};

	return (
		<Block title={reply.data.title}>
			{reply.data.asks.map((ask) => (
				<View key={ask} style={{ flexDirection: "row", gap: space.s2 }}>
					<Icon name="check" size={18} color={colors.accentText} />
					<Text style={{ flex: 1 }}>{ask}</Text>
				</View>
			))}
			{reply.data.unconfirmed.map((open) => (
				<View key={open} style={{ flexDirection: "row", gap: space.s2 }}>
					<Icon name="question" size={18} color={colors.warnText} />
					<Text style={{ flex: 1 }}>{open}</Text>
				</View>
			))}
			{reply.data.reply ? (
				<>
					<TextArea
						label={t`Suggested reply · edit before sending`}
						value={text}
						editable={!readOnly}
						maxLength={4000}
						onChangeText={draft.setValue}
					/>
					{placeholders.length > 0 ? (
						<View accessibilityLiveRegion="polite" style={{ gap: space.s1 }}>
							<Text color="warnText">{t`Replace these placeholders before sending:`}</Text>
							{placeholders.map((placeholder) => (
								<Text key={placeholder} color="warnText" style={{ backgroundColor: colors.warnSoft }}>
									{placeholder}
								</Text>
							))}
						</View>
					) : null}
					<Actions>
						<Button variant="secondary" size="sm" icon="copy" label={t`Copy reply`} onPress={() => void copy()} />
						{!readOnly && application.status !== "saved" && application.status !== "closed" ? (
							<Button
								variant="secondary"
								size="sm"
								label={t`Copy and log as replied`}
								disabled={!application.replyVersion}
								loading={logging}
								onPress={() => void copy(true)}
							/>
						) : null}
						{!readOnly && provider ? (
							<Button
								variant="ghost"
								size="sm"
								label={t`Write a new reply in ${languageName}`}
								loading={generate.isPending}
								onPress={rewrite}
							/>
						) : null}
					</Actions>
					{!readOnly ? <GenerateNotice generate={generate} onRetry={rewrite} /> : null}
					<Text variant="caption" color="ink3">
						{t`You send it from your own email.`}
					</Text>
					{!readOnly && application.status !== "saved" && application.status !== "closed" ? (
						<Text variant="caption" color="ink3">
							{t`Log only when you have replied. This records contact and clears the application's follow-up and its reminder; it sends no message and keeps interview reminders.`}{" "}
							{!application.replyVersion
								? t`Update the server to enable reply logging. Copy reply is still available.`
								: null}
						</Text>
					) : null}
				</>
			) : null}
		</Block>
	);
}

type ProposalCardProps = {
	reply: ReplyItem;
	application: WorkspaceTabProps["application"];
	now: Date;
	readOnly: boolean;
};

/**
 * W16–W17: changes the message implies, each one ticked by default. Nothing changes until Apply; Apply saves at once,
 * and its toast's Undo reverses exactly what it changed while nothing else has changed it since.
 */
function ProposalCard({ reply, application, now, readOnly }: ProposalCardProps) {
	const { t, i18n } = useLingui();
	const { when, day, timeZone } = useUserTime();
	const queryClient = useQueryClient();
	const invalidate = useInvalidateApplications();
	const session = useSession();
	const workspace = useWorkspace(application.id);
	const changes = reply.data.changes;
	const [ticked, setTicked] = useState<number[]>(() => openChanges(changes, application.status));
	const [confirming, setConfirming] = useState<number[] | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const pendingKey = `${session.server}:${reply.id}`;
	const appliedNow = useSyncExternalStore(replyApplies.subscribe, () => replyApplies.get(pendingKey));
	const applied =
		appliedNow ??
		(reply.data.applied ? { changes: reply.data.applied.changes, at: new Date(reply.data.applied.at) } : null);
	const selected = applied ? applied.changes : ticked;
	const contact = application.contacts[0]?.name.split(" ")[0];
	const lanes = useApplicationLanes();
	const offerHints = useOfferHints();
	const current =
		application.followUpNote ||
		describeNextStep(
			getNextStep(application, now, lanes.lanes, timeZone, offerHintFor(offerHints, application.id)),
			application,
			i18n.locale,
			timeZone,
		).title;
	const from = getLaneLabel(resolveLane(lanes.lanes, application));

	const describe = (change: (typeof changes)[number], index: number) => {
		switch (change.type) {
			case "stage": {
				const stage =
					change.stage === application.status ? from : getLaneLabel(resolveLane(lanes.lanes, { status: change.stage }));
				if (change.stage === application.status)
					// Applied, the stage is now the one it moved to: say so, rather than "stays".
					return applied?.changes.includes(index)
						? { title: t`Moved to ${stage}`, detail: "" }
						: { title: t`Stage stays ${stage}`, detail: t`No change needed. It's already at ${stage}.` };
				if (application.status === "saved")
					return {
						title: t`Mark as applied and move to ${stage}`,
						detail: t`Asks you to confirm the answers and documents, then records them as sent and moves it.`,
					};
				return { title: t`Move to ${stage}`, detail: t`Moves the application from ${from}.` };
			}
			// One change carries the next step and, when a reply is due, its reminder.
			case "follow-up": {
				const note = change.note;
				if (!change.at) return { title: t`Next step: ${note}`, detail: t`Replaces “${current}” on the application.` };
				const at = when(change.at);
				return {
					title: t`Follow up on ${at}`,
					// The date is the application's next step, shown with it in Applications; it doesn't schedule a reminder.
					detail: note
						? t`Next step: ${note}. Sets the application's follow-up date.`
						: t`Sets the application's follow-up date, in case you haven't heard back by then.`,
				};
			}
			case "offer": {
				const offer = reply.data.offer;
				const terms =
					offer === null
						? []
						: offerTermKeys(offer).map((key) =>
								key === "base"
									? t`Base ${formatMoney(i18n.locale, offer.currency, offer.base ?? 0)} ${periodLabel(offer.period)}`
									: key === "variable"
										? t`Bonus ${formatMoney(i18n.locale, offer.currency, offer.variable ?? 0)}${
												offer.variableConditions ? ` (${offer.variableConditions})` : ""
											}`
										: key === "equity"
											? t`Equity ${offer.equity}`
											: key === "startDate"
												? t`Starts ${formatDateOnly(offer.startDate ?? "", i18n.locale)}`
												: t`Respond by ${day(offer.respondBy ?? "")}`,
							);
				return {
					title: t`Save these offer terms to compare`,
					detail: terms.length
						? t`${terms.join(" · ").replace(/[\s.。]+$/u, "")}. Opens in Career → Offers.`
						: t`No terms were extracted. Opens in Career → Offers.`,
				};
			}
		}
	};

	const offer = reply.data.offer;
	const unknown = t`Not stated`;
	const amount = (value: number | null) =>
		offer && value !== null ? formatMoney(i18n.locale, offer.currency, value) : unknown;
	const terms: Array<[string, string]> = offer
		? [
				[t`Offer type`, offer.version === "written" ? t`Written offer` : t`Verbal offer`],
				[t`Currency`, offer.currency],
				[t`Pay period`, offer.period === "year" ? t`Per year` : offer.period === "month" ? t`Per month` : t`Per hour`],
				[t`Base salary`, amount(offer.base)],
				[t`Bonus`, amount(offer.variable)],
				[t`Bonus conditions`, offer.variableConditions || unknown],
				[t`Equity`, offer.equity || unknown],
				[t`Where you work`, offer.location || unknown],
				[t`Office days a week`, offer.officeDays === null ? unknown : String(offer.officeDays)],
				[t`Leave`, offer.leave || unknown],
				[t`Learning budget`, amount(offer.learning)],
				[t`Other benefits`, offer.other || unknown],
				[t`Respond by`, offer.respondBy ? when(offer.respondBy) : unknown],
			]
		: [];

	const followUp = changes.find((change, index) => change.type === "follow-up" && applied?.changes.includes(index));
	const count = ticked.length;

	const refresh = () =>
		Promise.all([
			invalidate(),
			queryClient.invalidateQueries({ queryKey: orpc.career.savedItems.key() }),
			queryClient.invalidateQueries({ queryKey: orpc.career.schedules.key() }),
		]);
	const reason = (error: unknown, fallback: string) =>
		error instanceof ORPCError && error.message ? error.message : fallback;

	// Saved before it shows as applied: leaving the app right after can't lose it. Undo is the server's reverse.
	const onApply = async () => {
		const chosen = ticked;
		// A move from Saved needs the receipt the user confirmed. Nothing is written until that confirmation.
		if (chosen.some((index) => needsSubmission(changes[index], application.status))) {
			setConfirming(chosen);
			return;
		}
		const origin = getDraftScope();
		const scope = stageScope();
		// One apply per reply at a time, even after leaving and reopening the tab.
		if (!replyApplies.start(pendingKey, { changes: chosen, at: new Date() })) return;
		const saved = stageBaselinesFor(queryClient).write(
			scope,
			application.id,
			listedApplication(queryClient, application.id),
		);
		try {
			const dispatched = await dispatchForOrigin(origin, getDraftScope, async () => {
				const answer = await client.career.applyReply({ id: reply.id, changes: chosen });
				if ((await origin) !== (await getDraftScope())) return;
				saved(savedStageIn(answer, application.id));
				await refresh();
			});
			if (dispatched === "cancelled" || (await origin) !== (await getDraftScope())) return;
		} catch (error) {
			showToast({ message: reason(error, t`Couldn't update the application. Nothing was changed; try again.`) });
			return;
		} finally {
			saved(undefined);
			replyApplies.finish(pendingKey);
		}
		showToast({
			message: t`Application updated`,
			action: {
				label: t`Undo`,
				onPress: () => {
					const reverted = stageBaselinesFor(queryClient).write(
						scope,
						application.id,
						listedApplication(queryClient, application.id),
					);
					void dispatchForOrigin(origin, getDraftScope, async () => {
						const answer = await client.career.undoReply({ id: reply.id });
						if ((await origin) !== (await getDraftScope())) return;
						reverted(savedStageIn(answer, application.id));
						await refresh();
					})
						.catch((error: unknown) =>
							showToast({ message: reason(error, t`Couldn't undo the update. The application is unchanged.`) }),
						)
						.finally(() => reverted(undefined));
				},
			},
		});
	};

	const confirmedAnswers = workspace.current().answers.filter((answer) => answer.answer.trim()).length;
	const confirmedDocuments = [
		...(application.resumeId ? [t`the linked resume`] : []),
		...(application.coverLetterId ? [t`the linked cover letter`] : []),
	];
	const records =
		confirmedAnswers || confirmedDocuments.length
			? t`Records ${[
					...(confirmedAnswers
						? [plural(confirmedAnswers, { one: "# written answer", other: "# written answers" })]
						: []),
					...confirmedDocuments,
				].join(", ")} as sent, and moves this application. You submit on the employer's site yourself.`
			: t`No documents or answers are linked. This records the application as sent, and moves it. You submit on the employer's site yourself.`;

	const confirmSubmission = async () => {
		if (!confirming) return;
		setSubmitting(true);
		const saved = stageBaselinesFor(queryClient).write(
			stageScope(),
			application.id,
			listedApplication(queryClient, application.id),
		);
		const origin = getDraftScope();
		try {
			const current = await workspace.settled();
			await dispatchForOrigin(origin, getDraftScope, async () => {
				const result = await client.career.applyReply({
					id: reply.id,
					changes: confirming,
					submission: {
						answers: current.answers,
						expectedAnswers: current.answers,
						expectedDocuments: { resumeId: application.resumeId, coverLetterId: application.coverLetterId },
					},
				});
				saved(savedStageIn(result, application.id));
			});
			setConfirming(null);
			await Promise.all([
				invalidate(),
				queryClient.invalidateQueries({ queryKey: orpc.career.savedItems.key() }),
				queryClient.invalidateQueries({ queryKey: orpc.career.schedules.key() }),
			]);
			showToast({ message: t`Marked as applied and moved. You submit on the employer's site yourself.` });
		} catch {
			// The single transaction rolled back: still Saved, nothing recorded.
			showToast({ message: t`Couldn't confirm the application move. Reload this application before retrying.` });
		} finally {
			saved(undefined);
			setSubmitting(false);
		}
	};

	return (
		<Block
			title={t`Proposed changes`}
			trailing={
				<Pill
					tone={applied ? "accent" : readOnly ? "plain" : "info"}
					label={
						applied
							? t({ message: "Applied", context: "A proposed change has been applied" })
							: readOnly
								? t`Not applied`
								: t`Waiting for you`
					}
				/>
			}
		>
			{changes.map((change, index) => {
				const { title, detail } = describe(change, index);
				const fixed = isFixedChange(change, application.status);
				return (
					<CheckRow
						key={`${reply.id}-change-${index}`}
						label={title}
						detail={detail}
						checked={fixed || selected.includes(index)}
						disabled={fixed || applied !== null || readOnly}
						onChange={(on) => setTicked((rows) => (on ? [...rows, index] : rows.filter((row) => row !== index)))}
					/>
				);
			})}

			{offer && changes.some((change) => change.type === "offer") ? (
				<View style={{ gap: 8 }}>
					<Text variant="label">
						<Trans>Offer terms</Trans>
					</Text>
					{terms.map(([label, value]) => (
						<View key={label}>
							<Text variant="caption" color="ink3">
								{label}
							</Text>
							<Text selectable>{value}</Text>
						</View>
					))}
				</View>
			) : null}

			{/* Only a message about scheduling can tempt adding an interview from an unconfirmed time. */}
			{reply.data.unconfirmed.length > 0 && !changes.some((change) => change.type === "offer") ? (
				<Text variant="caption" color="ink3">
					{contact
						? t`Confirm the time with ${contact} before adding a new interview.`
						: t`Confirm the time before adding a new interview.`}
				</Text>
			) : null}

			{!readOnly ? (
				applied ? (
					<Banner
						tone="info"
						icon="check-circle"
						message={
							followUp?.type === "follow-up" && followUp.at
								? t`Applied. Follow-up set for ${day(followUp.at)}.`
								: t`Applied. The application is updated.`
						}
					/>
				) : (
					<Button
						fullWidth
						disabled={count === 0}
						label={
							count === 0 ? t`Nothing to apply` : plural(count, { one: "Apply # change", other: "Apply # changes" })
						}
						onPress={() => void onApply()}
					/>
				)
			) : null}

			<Sheet
				open={confirming !== null}
				onClose={() => (submitting ? undefined : setConfirming(null))}
				title={t`Mark as applied and move it?`}
			>
				<View style={{ gap: 12, paddingHorizontal: 16 }}>
					<Text color="ink2">{records}</Text>
					<Button
						fullWidth
						label={t`Mark as applied and move`}
						loading={submitting}
						onPress={() => void confirmSubmission()}
					/>
					<Button
						fullWidth
						variant="secondary"
						label={t`Cancel`}
						disabled={submitting}
						onPress={() => setConfirming(null)}
					/>
				</View>
			</Sheet>
		</Block>
	);
}
