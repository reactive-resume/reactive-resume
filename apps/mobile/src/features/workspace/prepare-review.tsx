import type { Application } from "@/features/applications/types";
import type { Proposal, ProposalApplications } from "@reactive-resume/resume/proposals";
import { useLingui } from "@lingui/react/macro";
import { randomUUID } from "expo-crypto";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { applicationReviewSchema, type ApplicationReview } from "@reactive-resume/ai/application-review";
import { coverLetterTextToHtml } from "@reactive-resume/resume/cover-letter";
import { appliedApplications, applyResumeProposals, getProposalState } from "@reactive-resume/resume/proposals";
import { useDraft, useWorkspace, workspaceError } from "./hooks";
import { client } from "@/api/client";
import { getAccountScope } from "@/auth/session";
import { ChangeSet } from "@/features/assistant/messages";
import { Button, Text, TextArea, showToast, useTheme } from "@/ui";
type Review = ApplicationReview;
type PrepareReviewProps = { application: Application; disabled: boolean };

/** Inline review uses guarded document updates, without opening or replacing another editor's dirty draft. */
export function PrepareReview({ application, disabled }: PrepareReviewProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const workspace = useWorkspace(application.id);
	const questions = useDraft(`prepare-questions:${application.id}`, "");
	const reviewDraft = useDraft<Review | null>(`prepare-review:${application.id}`, null);
	const parsedReview = applicationReviewSchema.nullable().safeParse(reviewDraft.value);
	const review = parsedReview.success ? parsedReview.data : null;
	const setReview = (update: Review | null | ((value: Review | null) => Review | null)) =>
		reviewDraft.setValue((previous) => {
			const parsed = applicationReviewSchema.nullable().safeParse(previous);
			return typeof update === "function" ? update(parsed.success ? parsed.data : null) : update;
		});
	const [decisions, setDecisions] = useState<ProposalApplications>({});
	const [busy, setBusy] = useState(false);
	const [stoppable, setStoppable] = useState(false);
	const [undo, setUndo] = useState<(() => Promise<void>) | null>(null);
	const controller = useRef<AbortController | null>(null);
	const generation = getAccountScope();
	useEffect(
		() => () => {
			controller.current?.abort();
		},
		[application.id, generation],
	);
	const current = () => generation === getAccountScope();
	const run = async (action: (signal: AbortSignal) => Promise<void>, stop = false) => {
		if (controller.current || !current() || disabled) return false;
		const abort = new AbortController();
		controller.current = abort;
		setBusy(true);
		setStoppable(stop);
		try {
			await action(abort.signal);
			return true;
		} catch (error) {
			if (!abort.signal.aborted && current())
				showToast({ message: workspaceError(error, t`Couldn't complete this action. Try again.`) });
			return false;
		} finally {
			if (controller.current === abort) {
				controller.current = null;
				if (current()) setBusy(false);
			}
		}
	};
	const pasted = questions.value
		.split(/\n\s*\n/)
		.map((question) => question.trim())
		.filter(Boolean);
	const valid = pasted.length <= 5 && pasted.every((question) => question.length <= 2000);
	const prepare = () =>
		run(async (signal) => {
			await workspace.settled();
			const result = await client.applications.ai.prepare({ id: application.id, questions: pasted }, { signal });
			if (!current() || controller.current?.signal.aborted) return;
			setReview(result);
			setDecisions({});
			setUndo(null);
		}, true);
	const accept = (chosen: readonly Proposal[]) =>
		run(async () => {
			if (!review) return;
			const before = review.resume;
			const data = structuredClone(before.data);
			const result = applyResumeProposals(data, chosen, decisions);
			if (!result.applied.length) return;
			const applied = appliedApplications(result.applied);
			const saved = await client.resume.update({
				id: before.id,
				data,
				expectedUpdatedAt: before.updatedAt,
				proposalApplications: applied,
				proposalSafety: "v1",
			});
			if (!current()) return;
			setReview({ ...review, resume: { ...before, ...saved } });
			setDecisions({ ...decisions, ...applied });
			setUndo(() => async () => {
				const restored = await client.resume.update({
					id: before.id,
					data: before.data,
					aiOperationIds: before.aiOperationIds ?? [],
					expectedUpdatedAt: saved.updatedAt,
					proposalApplications: Object.fromEntries(result.applied.map((proposal) => [proposal.id, false])),
					proposalSafety: "v1",
				});
				if (current()) {
					setReview((value) => (value ? { ...value, resume: { ...before, ...restored } } : value));
					setDecisions(decisions);
					setUndo(null);
				}
			});
		});
	const decide = (
		set: Review["sets"][number],
		changed: readonly Proposal[],
		status: "pending" | "rejected",
		text?: string,
	) =>
		run(async () => {
			if (!review?.threadId) return;
			await client.agent.messages.setEditStatus({
				threadId: review.threadId,
				messageId: set.messageId,
				toolCallId: set.toolCallId,
				edits: changed.map((proposal) => ({
					id: proposal.id,
					status,
					...(text === undefined ? {} : { text, after: proposal.after }),
				})),
			});
			const conversation = await client.agent.threads.get({ id: review.threadId });
			if (!current()) return;
			// A fresh full review is needed after rewording, so this surface cannot accept obsolete wording.
			const edited = conversation.messages
				.flatMap((message) => message.parts)
				.find(
					(part) => part.type === "tool-propose_edits" && "toolCallId" in part && part.toolCallId === set.toolCallId,
				) as { output?: { edits: typeof set.edits } } | undefined;
			setReview({
				...review,
				sets: review.sets.map((item) =>
					item === set && edited?.output ? { ...item, edits: edited.output.edits } : item,
				),
			});
			setDecisions(
				Object.fromEntries(Object.entries(decisions).filter(([id]) => !changed.some((proposal) => proposal.id === id))),
			);
		});
	const keepLetter = () =>
		run(async () => {
			if (!review?.letter) return;
			const draft = review.letter;
			const before = draft.document;
			const saved = await client.coverLetters.update({
				id: before.id,
				expectedRevision: before.revision,
				content: coverLetterTextToHtml(review.letter.text),
				aiOperationIds: review.letter.aiOperationIds,
				proposalSafety: "v1",
			});
			if (!current()) return;
			setReview({ ...review, letter: null });
			setUndo(() => async () => {
				const restored = await client.coverLetters.update({
					id: before.id,
					expectedRevision: saved.revision,
					content: before.content,
					aiOperationIds: before.aiOperationIds ?? [],
					proposalSafety: "v1",
				});
				if (current()) {
					setReview((value) =>
						value ? { ...value, letter: { ...draft, document: { ...before, revision: restored.revision } } } : value,
					);
					setUndo(null);
				}
			});
		});
	const keepAnswer = (index: number) =>
		run(async () => {
			if (!review) return;
			const item = review.answers[index];
			if (!item) return;
			const before = (await workspace.settled()).answers;
			const answer = { id: randomUUID(), question: item.question, ...item.answer };
			if (!(await workspace.save({ answers: [...before, answer] }, { answers: before })).ok) return;
			if (!current()) return;
			setReview({ ...review, answers: review.answers.filter((_, position) => position !== index) });
			setUndo(() => async () => {
				const latest = (await workspace.settled()).answers;
				if (JSON.stringify(latest.find((value) => value.id === answer.id)) !== JSON.stringify(answer))
					throw new Error(t`The answer changed since, so it wasn't restored.`);
				if (
					(await workspace.save({ answers: latest.filter((value) => value.id !== answer.id) }, { answers: latest })).ok
				) {
					if (current()) setUndo(null);
				}
			});
		});
	return (
		<View style={{ gap: space.s3 }}>
			<Text variant="heading">{t`Prepare application`}</Text>
			<Text>{t`Review tailoring proposals, a letter draft and answers together. Nothing is submitted to the employer.`}</Text>
			<TextArea
				label={t`Form questions (optional)`}
				value={questions.value}
				onChangeText={questions.setValue}
				editable={!busy}
			/>
			<Text variant="caption">{t`Separate questions with a blank line. Up to five questions, 2,000 characters each.`}</Text>
			{!valid && <Text>{t`Separate questions with a blank line. Up to five questions, 2,000 characters each.`}</Text>}
			<Button
				label={busy ? t`Preparing…` : t`Prepare drafts for review`}
				disabled={
					busy ||
					disabled ||
					review !== null ||
					!valid ||
					!application.resumeId ||
					(!application.jobDescription && !application.requirements.length)
				}
				onPress={() => void prepare()}
			/>
			{busy && stoppable && <Button variant="secondary" label={t`Stop`} onPress={() => controller.current?.abort()} />}
			{undo && <Button variant="secondary" label={t`Undo`} disabled={busy} onPress={() => void run(undo)} />}
			{review && (
				<>
					{review.failed.length > 0 && (
						<Text>
							{t`Some drafts couldn't finish. Keep completed drafts before trying again.`} {review.failed.join(", ")}
						</Text>
					)}
					<Button
						variant="secondary"
						label={t`Discard`}
						disabled={busy}
						onPress={() => {
							setReview(null);
							setUndo(null);
						}}
					/>
					<Text variant="heading">{t`Resume proposals`}</Text>
					{review.sets.length === 0 && <Text>{t`No edits proposed.`}</Text>}
					{review.sets.map((set) => {
						const proposals: Proposal[] = set.edits.map((edit) => ({
							...edit,
							source: "assistant",
							aiOperationIds: set.aiOperationIds,
						}));
						return (
							<ChangeSet
								key={set.toolCallId}
								resumeId={review.resume.id}
								title={set.title}
								proposals={proposals}
								states={proposals.map((proposal) => getProposalState(review.resume.data, proposal, decisions))}
								locked={
									busy ||
									disabled ||
									review.resume.isLocked ||
									set.revoked === true ||
									set.tailoredFor !== application.id
								}
								onAccept={(chosen) => void accept(chosen)}
								onReject={(chosen) => void decide(set, chosen, "rejected")}
								onRestore={(chosen) => void decide(set, chosen, "pending")}
								onEdit={async (proposal, text) => {
									if (!(await decide(set, [proposal], "pending", text)))
										throw new Error(t`Couldn't save that change. Try again.`);
								}}
								requirements={set.requirements ?? []}
								factText={() => null}
							/>
						);
					})}
					{review.letter && (
						<View style={{ gap: space.s2 }}>
							<Text variant="heading">{t`Letter draft`}</Text>
							<TextArea
								label={t`Letter draft`}
								value={review.letter.text}
								editable={!busy}
								onChangeText={(text) =>
									setReview({ ...review, letter: review.letter ? { ...review.letter, text } : null })
								}
							/>
							<Button
								label={t`Keep letter`}
								disabled={busy || disabled || !review.letter.text.trim()}
								onPress={() => void keepLetter()}
							/>
						</View>
					)}
					{review.answers.map((item, index) => (
						<View key={item.question} style={{ gap: space.s2 }}>
							<Text>{item.question}</Text>
							<TextArea
								label={item.question}
								value={item.answer.answer}
								maxLength={6000}
								editable={!busy}
								onChangeText={(text) =>
									setReview({
										...review,
										answers: review.answers.map((answer, position) =>
											position === index ? { ...answer, answer: { ...answer.answer, answer: text } } : answer,
										),
									})
								}
							/>
							{item.note && <Text>{item.note}</Text>}
							<Button
								label={t`Keep answer`}
								disabled={busy || disabled || !item.answer.answer.trim()}
								onPress={() => void keepAnswer(index)}
							/>
						</View>
					))}
				</>
			)}
		</View>
	);
}
