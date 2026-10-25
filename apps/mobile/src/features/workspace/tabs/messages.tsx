// Messages (web workspace/messages.tsx, W15–W17): paste what the employer wrote, read it, reply yourself, and apply
// the changes it implies only if you choose.
import type { SavedData, SavedItem } from "../hooks";
import type { WorkspaceTabProps } from "../shell";
import type { SaveResult } from "../state";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import { latest, useAutosave, useDraft, useGenerate, useSavedItems, useWorkspace } from "../hooks";
import { isFixedChange, openChanges } from "../logic";
import { AiNotice, Block, CheckRow, Pill, SaveError, useWorking, workingSteps } from "../parts";
import { WorkspaceScreen } from "../shell";
import { createPendingRegistry, dispatchForOrigin } from "../state";
import { client, orpc } from "@/api/client";
import { useSession } from "@/auth/session";
import { getDraftScope } from "@/draft";
import { useHasAIProvider } from "@/features/ai/providers";
import { useUserTime } from "@/features/application-detail/hooks";
import { describeNextStep, getNextStep } from "@/features/applications/next-step";
import { useInvalidateApplications } from "@/features/applications/queries";
import { getStageLabel } from "@/features/applications/stages";
import { formatMoney } from "@/features/career/offer-compare";
import { withUndo } from "@/features/career/undo";
import { Banner, Button, Icon, Skeleton, Text, TextArea, showToast, useTheme } from "@/ui";

type ReplyItem = SavedItem & { data: SavedData<"reply"> };

/** Applies waiting on their Undo toast, by server and reply id; they outlive the Messages screen. */
const replyApplies = createPendingRegistry<{ changes: number[]; at: Date }>();

export function MessagesTab() {
	return <WorkspaceScreen tab="messages">{(props) => <Messages {...props} />}</WorkspaceScreen>;
}

function Messages({ application, version, now }: WorkspaceTabProps) {
	const { space } = useTheme();
	const saved = useSavedItems(application.id);
	const workspace = useWorkspace(application.id);
	const readOnly = version?.data.kind === "reply";
	const reply = (readOnly ? version : latest(saved.data, "reply")) as ReplyItem | undefined;

	if (workspace.isPending || saved.isPending) return <Skeleton height={space.s12 * 3} />;

	return (
		<View style={{ gap: space.s4 }}>
			<PasteBox
				key={`paste-${version?.id ?? "live"}`}
				application={application}
				initial={readOnly ? (reply?.data.message ?? "") : workspace.data.message || (reply?.data.message ?? "")}
				readOnly={readOnly}
				onSave={(message) => workspace.save({ message })}
				fetchServer={() => workspace.fetchConfirmed().then((data) => data.message)}
			/>
			{reply ? <ReplyCard key={reply.id} reply={reply} readOnly={readOnly} /> : null}
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
	const { t } = useLingui();
	const { space } = useTheme();
	// Kept on the device until the server has it, so a failed save survives leaving the tab.
	const draft = useDraft(readOnly ? null : `message:${application.id}`, initial);
	const message = draft.value;
	const generate = useGenerate(application.id);
	const provider = useHasAIProvider().defaultProvider;
	const autosave = useAutosave(readOnly ? initial : message, initial, onSave, draft, fetchServer);
	const label = useWorking(generate.isPending, workingSteps("reply"), t`Read it for me`);
	const company = application.company;

	return (
		<View style={{ gap: space.s3 }}>
			<TextArea
				label={t`Paste a message from ${company}`}
				value={message}
				maxLength={20_000}
				editable={!readOnly}
				helper={t`Paste the email or message, without the signature.`}
				onChangeText={draft.setValue}
				onBlur={autosave.flush}
			/>
			<SaveError autosave={autosave} />
			{!readOnly ? (
				<View style={{ gap: space.s2 }}>
					<AiNotice />
					{provider ? (
						<Button
							variant="secondary"
							icon="sparkle"
							label={label}
							loading={generate.isPending}
							disabled={!message.trim()}
							onPress={() => void generate.run({ task: "reply", message: message.trim() }).catch(() => undefined)}
						/>
					) : null}
				</View>
			) : null}
		</View>
	);
}

type ReplyCardProps = { reply: ReplyItem; readOnly: boolean };

/** W16: what they're asking, what isn't confirmed, and a reply to edit and send yourself. */
function ReplyCard({ reply, readOnly }: ReplyCardProps) {
	const { t } = useLingui();
	const { colors, space } = useTheme();
	const draft = useDraft(`reply:${reply.id}`, reply.data.reply);
	const text = readOnly ? reply.data.reply : draft.value;

	const copy = async () => {
		await Clipboard.setStringAsync(text);
		showToast({ message: t`Reply copied` });
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
					<Button variant="secondary" size="sm" icon="copy" label={t`Copy reply`} onPress={() => void copy()} />
					<Text variant="caption" color="ink3">
						{t`You send it from your own email.`}
					</Text>
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
 * W16–W17: changes the message implies, each one ticked by default. Nothing changes until Apply; Apply shows at once
 * and commits when its Undo toast closes.
 */
function ProposalCard({ reply, application, now, readOnly }: ProposalCardProps) {
	const { t, i18n } = useLingui();
	const { when, day, timeZone } = useUserTime();
	const queryClient = useQueryClient();
	const invalidate = useInvalidateApplications();
	const session = useSession();
	const changes = reply.data.changes;
	const [ticked, setTicked] = useState<number[]>(() => openChanges(changes, application.status));
	const pendingKey = `${session.server}:${reply.id}`;
	const appliedNow = useSyncExternalStore(replyApplies.subscribe, () => replyApplies.get(pendingKey));
	const applied =
		appliedNow ??
		(reply.data.applied ? { changes: reply.data.applied.changes, at: new Date(reply.data.applied.at) } : null);
	const selected = applied ? applied.changes : ticked;
	const contact = application.contacts[0]?.name.split(" ")[0];
	const current =
		application.followUpNote ||
		describeNextStep(getNextStep(application, now), application, i18n.locale, timeZone).title;
	const from = getStageLabel(application.status);

	const describe = (change: (typeof changes)[number]) => {
		switch (change.type) {
			case "stage": {
				const stage = getStageLabel(change.stage);
				if (change.stage === application.status)
					return { title: t`Stage stays ${stage}`, detail: t`No change needed. It's already at ${stage}.` };
				if (application.status === "saved")
					return { title: t`Move to ${stage}`, detail: t`Mark it as applied in Apply first.` };
				return { title: t`Move to ${stage}`, detail: t`Moves the application from ${from}.` };
			}
			// One change carries the next step and, when a reply is due, its reminder.
			case "follow-up": {
				const note = change.note;
				if (!change.at) return { title: t`Next step: ${note}`, detail: t`Replaces “${current}” on the application.` };
				const at = when(change.at);
				return {
					title: t`Follow up on ${at}`,
					detail: note
						? t`Next step: ${note}. Adds a reminder to Today.`
						: t`Adds a reminder to Today if you haven't heard back by then.`,
				};
			}
			case "offer": {
				const offer = reply.data.offer;
				const summary = offer
					? [offer.base === null ? "" : formatMoney(i18n.locale, offer.currency, offer.base), offer.location]
							.filter(Boolean)
							.join(" · ")
					: "";
				return {
					title: t`Save these offer terms to compare`,
					detail: summary ? t`${summary}. Opens in Career → Offers.` : t`Opens in Career → Offers.`,
				};
			}
		}
	};

	const followUp = changes.find((change, index) => change.type === "follow-up" && applied?.changes.includes(index));
	const count = ticked.length;

	const onApply = () => {
		const chosen = ticked;
		// One pending apply per reply, even after leaving and reopening the tab: Undo always cancels that one.
		if (!replyApplies.start(pendingKey, { changes: chosen, at: new Date() })) return;
		// The account that pressed Apply; the commit is dropped if another one is signed in by then.
		const origin = getDraftScope();
		withUndo({
			message: t`Application updated`,
			restore: () => replyApplies.finish(pendingKey),
			failed: () => showToast({ message: t`Couldn't update the application. Nothing was changed; try again.` }),
			// The client, not this screen's mutation: the commit may run after the screen is gone.
			commit: async () => {
				try {
					await dispatchForOrigin(origin, getDraftScope, async () => {
						await client.career.applyReply({ id: reply.id, changes: chosen });
						await Promise.all([
							invalidate(),
							queryClient.invalidateQueries({ queryKey: orpc.career.savedItems.key() }),
							queryClient.invalidateQueries({ queryKey: orpc.career.schedules.key() }),
						]);
					});
				} finally {
					replyApplies.finish(pendingKey);
				}
			},
		});
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
				const { title, detail } = describe(change);
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
						onPress={onApply}
					/>
				)
			) : null}
		</Block>
	);
}
