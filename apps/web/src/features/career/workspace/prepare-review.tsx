import type { Application } from "@/features/applications/types";
import type { Proposal, ProposalApplications } from "@reactive-resume/resume/proposals";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { applicationReviewSchema, type ApplicationReview } from "@reactive-resume/ai/application-review";
import { coverLetterTextToHtml } from "@reactive-resume/resume/cover-letter";
import { appliedApplications, applyResumeProposals, getProposalState } from "@reactive-resume/resume/proposals";
import { Button } from "@reactive-resume/ui/components/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@reactive-resume/ui/components/dialog";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Label } from "@reactive-resume/ui/components/label";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { useDefaultProvider, useSessionDraft, useWorkspace } from "../hooks";
import { ChangeSet } from "@/features/resume/editor/proposals/proposal-list";
import { getAccountGeneration } from "@/libs/auth/account-scope";
import { toastError } from "@/libs/error-message";
import { client } from "@/libs/orpc/client";

type Review = ApplicationReview;
type PrepareReviewProps = { application: Application; disabled: boolean };

/** Inline review uses guarded document updates, without opening or replacing another editor's dirty draft. */
export function PrepareReview({ application, disabled }: PrepareReviewProps) {
	const [open, setOpen] = useState(false);
	const connection = useDefaultProvider();
	if (!connection.provider) return null;
	return (
		<>
			<Button
				variant="link"
				className="h-auto w-fit gap-1.5 p-0 text-sm/5 text-accent-text"
				disabled={disabled}
				onClick={() => setOpen(true)}
			>
				<Icon name="sparkle" size={16} />
				<Trans>Prepare drafts</Trans>
			</Button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent closeLabel={t`Close`} className="max-h-[85svh] overflow-y-auto sm:max-w-[560px]">
					<ReviewForm application={application} disabled={disabled} onClose={() => setOpen(false)} />
				</DialogContent>
			</Dialog>
		</>
	);
}

function ReviewForm({ application, disabled, onClose }: PrepareReviewProps & { onClose: () => void }) {
	const workspace = useWorkspace(application.id);
	const { provider: connection } = useDefaultProvider();
	const questions = useSessionDraft(`prepare-questions:${application.id}`, "", (value) =>
		typeof value === "string" ? value : undefined,
	);
	const reviewDraft = useSessionDraft<Review | null>(`prepare-review:${application.id}`, null, (value) => {
		const parsed = applicationReviewSchema.nullable().safeParse(value);
		return parsed.success ? parsed.data : undefined;
	});
	const review = reviewDraft.value;
	const setReview = reviewDraft.setValue;
	const [decisions, setDecisions] = useState<ProposalApplications>({});
	const [keptAnswers, setKeptAnswers] = useState<Review["answers"]>([]);
	const [busy, setBusy] = useState(false);
	const [stoppable, setStoppable] = useState(false);
	const [undo, setUndo] = useState<(() => Promise<void>) | null>(null);
	const controller = useRef<AbortController | null>(null);
	const generation = getAccountGeneration();
	useEffect(
		() => () => {
			controller.current?.abort();
		},
		[application.id, generation],
	);
	const current = () => generation === getAccountGeneration();
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
			if (!abort.signal.aborted && current()) toastError(error, t`Couldn't complete this action. Try again.`);
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
			setKeptAnswers([]);
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
			const answer = { id: crypto.randomUUID(), question: item.question, ...item.answer };
			if (!(await workspace.save({ answers: [...before, answer] }, { answers: before }))) return;
			if (!current()) return;
			setReview({ ...review, answers: review.answers.filter((_, position) => position !== index) });
			setKeptAnswers((kept) => [...kept, item]);
			setUndo(() => async () => {
				const latest = (await workspace.settled()).answers;
				if (JSON.stringify(latest.find((value) => value.id === answer.id)) !== JSON.stringify(answer))
					throw new Error(t`The answer changed since, so it wasn't restored.`);
				if (await workspace.save({ answers: latest.filter((value) => value.id !== answer.id) }, { answers: latest })) {
					if (current()) {
						setReview((value) => (value ? { ...value, answers: [...value.answers, item] } : value));
						setKeptAnswers((kept) => kept.filter((value) => value !== item));
						setUndo(null);
					}
				}
			});
		});
	return (
		<section aria-label={t`Prepare application`} className="grid gap-4">
			<DialogHeader>
				<DialogTitle>{review ? t`Prepare application` : t`Prepare drafts`}</DialogTitle>
			</DialogHeader>
			{!review && (
				<>
					<p className="text-sm text-ink-2">
						<Trans>
							Review tailoring proposals, a letter draft and answers together. Nothing is submitted to the employer.
						</Trans>
					</p>
					<Label htmlFor={`prepare-questions-${application.id}`}>
						<Trans>Questions from the employer's form · optional</Trans>
					</Label>
					<Textarea
						id={`prepare-questions-${application.id}`}
						className="resize-none"
						placeholder={t`For example: Why do you want this role?`}
						value={questions.value}
						onChange={(event) => questions.setValue(event.target.value)}
						disabled={busy}
					/>
					<p className="text-xs text-ink-2">
						<Trans>Separate questions with a blank line. Up to five questions, 2,000 characters each.</Trans>
					</p>
					{!valid && (
						<p role="alert">
							<Trans>Separate questions with a blank line. Up to five questions, 2,000 characters each.</Trans>
						</p>
					)}
					{connection && (
						<p className="t-small text-ink-3">
							<Trans>
								Sends the posting, your linked resume and Knowledge to {connection.label}. Your provider may charge.
							</Trans>
						</p>
					)}
					<DialogFooter>
						<Button variant="ghost" onClick={onClose}>
							<Trans>Cancel</Trans>
						</Button>
						<Button
							disabled={
								busy
									? !stoppable
									: disabled ||
										review !== null ||
										!valid ||
										!application.resumeId ||
										(!application.jobDescription && !application.requirements.length)
							}
							onClick={() => (busy && stoppable ? controller.current?.abort() : void prepare())}
						>
							{!busy && <Icon name="sparkle" size={18} />}
							{busy && stoppable ? t`Stop` : busy ? t`Preparing…` : t`Prepare drafts`}
						</Button>
						{undo && (
							<Button variant="secondary" disabled={busy} onClick={() => void run(undo)}>
								<Trans>Undo</Trans>
							</Button>
						)}
					</DialogFooter>
				</>
			)}
			{review && (
				<>
					<p className="t-small text-ink-2">{t`Drafts for ${application.company} · ${application.role}, made by ${connection?.label ?? ""}. Nothing is sent to the employer.`}</p>
					{review.failed.length > 0 && (
						<p role="status">
							<Trans>Some drafts couldn't finish. Keep completed drafts before trying again.</Trans>{" "}
							{[
								...new Set(
									review.failed.map((failure) =>
										failure === "tailoring"
											? t`Resume proposals`
											: failure === "letter"
												? t`Letter draft`
												: t`Form questions (optional)`,
									),
								),
							].join(", ")}
						</p>
					)}
					<details className="border-y border-line py-3">
						<summary className="flex cursor-pointer items-center gap-3">
							<Icon name="file-text" />
							<span className="flex-1">
								{plural(
									review.sets.reduce((count, set) => count + set.edits.length, 0),
									{ one: "Resume · # proposed edit", other: "Resume · # proposed edits" },
								)}
							</span>
							{review.threadId && (
								<Link
									to="/builder/$resumeId"
									params={{ resumeId: review.resume.id }}
									search={{ assistant: review.threadId, applicationId: application.id }}
									className="t-small text-accent-text"
								>
									<Trans>Review edits</Trans>
								</Link>
							)}
						</summary>

						{review.assistantText && <p className="text-sm whitespace-pre-line">{review.assistantText}</p>}
						{review.threadId && (
							<Link
								to="/builder/$resumeId"
								params={{ resumeId: review.resume.id }}
								search={{ assistant: review.threadId, applicationId: application.id }}
							>
								<Trans>Open AI assistant</Trans>
							</Link>
						)}
						{review.sets.length === 0 && (
							<p>
								<Trans>No edits proposed.</Trans>
							</p>
						)}
						{review.sets.map((set) => {
							const proposals: Proposal[] = set.edits.map((edit) => ({
								...edit,
								source: "assistant",
								aiOperationIds: set.aiOperationIds,
							}));
							return (
								<ChangeSet
									key={set.toolCallId}
									compact
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
								/>
							);
						})}
					</details>
					{review.letter && (
						<div className="grid gap-2 border-b border-line pb-4">
							<h3 className="font-medium">
								<Trans>Letter draft</Trans>
							</h3>
							<Textarea
								aria-label={t`Letter draft`}
								className="min-h-20 resize-none border-transparent bg-sunken text-[13px]/[18px] shadow-none"
								value={review.letter.text}
								disabled={busy}
								onChange={(event) =>
									setReview({
										...review,
										letter: review.letter ? { ...review.letter, text: event.target.value } : null,
									})
								}
							/>
							<div className="flex items-center gap-3">
								<Button
									variant="secondary"
									size="sm"
									disabled={busy || disabled || !review.letter.text.trim()}
									onClick={() => void keepLetter()}
								>
									<Trans>Keep letter</Trans>
								</Button>
								<Button
									variant="ghost"
									size="sm"
									disabled={busy}
									onClick={() => setReview({ ...review, letter: null })}
								>
									<Trans>Discard</Trans>
								</Button>
								<span className="ms-auto t-small text-ink-3">
									{plural(review.letter.text.trim().split(/\s+/).filter(Boolean).length, {
										one: "# word",
										other: "# words",
									})}
								</span>
							</div>
						</div>
					)}
					{review.answers.map((item, index) => (
						<div key={`${index}:${item.question}`} className="grid gap-2 border-b border-line pb-4">
							<h3 className="font-medium">{item.question}</h3>
							<Textarea
								aria-label={item.question}
								className="min-h-20 resize-none border-transparent bg-sunken text-[13px]/[18px] shadow-none"
								value={item.answer.answer}
								maxLength={6000}
								disabled={busy}
								onChange={(event) =>
									setReview({
										...review,
										answers: review.answers.map((answer, position) =>
											position === index
												? { ...answer, answer: { ...answer.answer, answer: event.target.value } }
												: answer,
										),
									})
								}
							/>
							{item.note && <p role="note">{item.note}</p>}
							<div className="flex items-center gap-3">
								<Button
									variant="secondary"
									size="sm"
									disabled={busy || disabled || !item.answer.answer.trim()}
									onClick={() => void keepAnswer(index)}
								>
									<Trans>Keep answer</Trans>
								</Button>
								<Button
									variant="ghost"
									size="sm"
									disabled={busy}
									onClick={() =>
										setReview({ ...review, answers: review.answers.filter((_, position) => position !== index) })
									}
								>
									<Trans>Discard</Trans>
								</Button>
							</div>
						</div>
					))}

					{keptAnswers.map((item, index) => (
						<div key={`kept:${index}`} className="grid gap-2 border-b border-line pb-4">
							<h3 className="font-medium">{item.question}</h3>
							<p className="rounded-lg bg-sunken px-3 py-2 text-[13px]/[18px]">{item.answer.answer}</p>
							<span className="flex items-center gap-1.5 t-small text-ink-3">
								<Icon name="check" size={16} />
								<Trans>Kept</Trans>
							</span>
						</div>
					))}
					<DialogFooter className="justify-between">
						<Button
							variant="ghost"
							disabled={busy}
							onClick={() => {
								setReview(null);
								setUndo(null);
							}}
						>
							<Icon name="arrow-clockwise" />
							<Trans>Prepare again</Trans>
						</Button>
						{undo && (
							<Button variant="secondary" disabled={busy} onClick={() => void run(undo)}>
								<Trans>Undo</Trans>
							</Button>
						)}
						<Button disabled={busy} onClick={onClose}>
							<Trans>Done</Trans>
						</Button>
					</DialogFooter>
				</>
			)}
		</section>
	);
}
