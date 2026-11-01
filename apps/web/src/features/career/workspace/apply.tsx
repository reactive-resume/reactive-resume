import type { Fact } from "../hooks";
import type { WorkspaceTabProps } from "./shell";
import type { CareerWorkspace } from "@reactive-resume/schema/career";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AnimatePresence } from "motion/react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { hasApplicationSubmission } from "@reactive-resume/schema/applications/data";
import { nextPreparationStep } from "@reactive-resume/schema/applications/preparation";
import { careerWorkspaceSchema } from "@reactive-resume/schema/career";
import { Button } from "@reactive-resume/ui/components/button";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { toast } from "@reactive-resume/ui/components/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@reactive-resume/ui/components/tooltip";
import { downloadWithAnchor, generateFilename } from "@reactive-resume/utils/file";
import { rewriteSummary } from "@reactive-resume/utils/string";
import { cn } from "@reactive-resume/utils/style";
import { DraftRecovery } from "../draft-recovery";
import {
	latest,
	useDebouncedSave,
	useDefaultProvider,
	useGenerate,
	useSavedItems,
	useSessionDraft,
	useWorkspace,
} from "../hooks";
import { CollapseRow, Swap, withUndo, Working, workingSteps } from "../shared";
import { AnswerLibrary } from "./answer-library";
import { AiNotice } from "./fit";
import { Preparation } from "./preparation";
import { SentDocuments } from "@/features/applications/components/detail/sent-documents";
import { useInvalidateApplications } from "@/features/applications/use-application-actions";
import { toastError } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

type Answer = CareerWorkspace["answers"][number];
type AnswerSnapshot = Pick<Answer, "answer" | "factIds">;
type CountUnit = "words" | "characters";

const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** A fact's chip label: its first few words. The tooltip has the whole fact. */
const shortLabel = (text: string) => {
	const words = text.split(/\s+/).filter(Boolean);
	return words.length > 4 ? `${words.slice(0, 4).join(" ")}…` : text;
};

/** The review checks, by their persisted checklist index. Submitting yourself (3) is moot once a submission is recorded. */
const checklistItems = (submitted: boolean) =>
	[
		t`Review the selected resume and cover letter in their editors.`,
		t`Check every claim, date and result against your experience.`,
		t`Review required form answers and remove unsupported claims.`,
		t`Submit through the employer's application page yourself.`,
	].slice(0, submitted ? 3 : 4);

/** W4–W5: the written answers for the employer's form, and a checklist before submitting there yourself. */
export function ApplyTab({ application, version, go }: WorkspaceTabProps) {
	const saved = useSavedItems(application.id);
	const workspace = useWorkspace(application.id);
	const { data: facts } = useQuery(orpc.career.facts.queryOptions({ input: { applicationId: application.id } }));
	const readOnlyVersion = version?.data.kind === "answers" ? version.data : undefined;
	const recorded = saved.data?.find((item) => item.submission && item.data.kind === "answers");
	const candidate = recorded ?? (!hasApplicationSubmission(application) ? latest(saved.data, "answers") : undefined);
	const sentItem = candidate?.data.kind === "answers" ? { ...candidate, data: candidate.data } : undefined;
	// Removed questions wait out their Undo here; the workspace drops them when the toast closes.
	const [removed, setRemoved] = useState<string[]>([]);
	const [unit, setUnit] = useState<CountUnit>("words");
	const [submitting, setSubmitting] = useState(false);
	const [canSubmit, setCanSubmit] = useState(true);
	const drafts = useRef(new Map<string, () => Answer>());
	const registerDraft = useCallback((id: string, read: () => Answer) => {
		drafts.current.set(id, read);
		const updateValidity = () =>
			setCanSubmit(
				careerWorkspaceSchema.shape.answers.safeParse([...drafts.current.values()].map((value) => value())).success,
			);
		updateValidity();
		return () => {
			drafts.current.delete(id);
			updateValidity();
		};
	}, []);

	if (workspace.isPending || saved.isPending)
		return (
			<div className="grid gap-4">
				<Skeleton className="h-14 rounded-xl" />
				<Skeleton className="h-48 rounded-xl" />
			</div>
		);

	const live = workspace.data.answers;
	// Stored answers that aren't in the workspace (a saved version, or what was sent before this tab existed).
	const stored = readOnlyVersion ?? (live.length === 0 ? sentItem?.data : undefined);
	const shown: Answer[] = stored
		? stored.answers.map((answer, index) => ({ ...answer, id: `stored-${index}`, factIds: [] }))
		: live.filter((answer) => !removed.includes(answer.id));

	const saveAnswer = (id: string, patch: Partial<Answer>, accepted?: AnswerSnapshot) => {
		const answers = workspace.current().answers;
		const current = answers.find((answer) => answer.id === id);
		if (
			accepted &&
			(!current ||
				current.answer !== accepted.answer ||
				JSON.stringify(current.factIds) !== JSON.stringify(accepted.factIds))
		) {
			toast.add({ description: t`The answer changed since, so it wasn't restored.` });
			return Promise.resolve(false);
		}
		return workspace.save(
			{ answers: answers.map((answer) => (answer.id === id ? { ...answer, ...patch } : answer)) },
			accepted
				? { answers: answers.map((answer) => (answer.id === id ? { ...answer, ...accepted } : answer)) }
				: undefined,
		);
	};
	const currentAnswers = () => shown.map((answer) => drafts.current.get(answer.id)?.() ?? answer);
	const removeAnswer = (id: string) => {
		setRemoved((ids) => [...ids, id]);
		withUndo({
			description: t`Question removed`,
			commit: () => workspace.save({ answers: workspace.current().answers.filter((answer) => answer.id !== id) }),
			onUndo: () => setRemoved((ids) => ids.filter((item) => item !== id)),
		});
	};

	return (
		<div className="grid items-start gap-5 @3xl:grid-cols-[minmax(0,1fr)_280px] @5xl:grid-cols-[minmax(0,1fr)_320px]">
			{!version && (
				<div className="grid gap-4 @3xl:col-start-1">
					{hasApplicationSubmission(application) ? (
						<SentDocuments application={application} disabled={submitting} variant="workspace" />
					) : (
						<Preparation key={application.id} application={application} disabled={submitting} />
					)}
				</div>
			)}

			<Checklist
				application={application}
				answers={shown}
				currentAnswers={currentAnswers}
				readOnly={!!readOnlyVersion}
				canSubmit={canSubmit}
				submitting={submitting}
				onSubmittingChange={setSubmitting}
			/>

			<div className="grid gap-4 @3xl:col-start-1">
				{stored && !readOnlyVersion && (
					<div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-sunken px-3.5 py-2.5 text-sm">
						<span>
							{recorded ? (
								<Trans>These are the answers saved when you applied.</Trans>
							) : (
								<Trans>These are saved draft answers.</Trans>
							)}
						</span>
						<Button
							size="sm"
							variant="secondary"
							onClick={() =>
								workspace.save({
									answers: stored.answers.map((answer) => ({
										...answer,
										id: crypto.randomUUID(),
										factIds: [],
									})),
								})
							}
						>
							<Trans>Use these answers</Trans>
						</Button>
					</div>
				)}

				<div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
					<h2 id="application-answers" tabIndex={-1} className="text-base font-semibold">
						<Trans>Form answers</Trans>
					</h2>
					<Link to="/dashboard/settings/profile" className="text-sm underline">
						<Trans>Edit profile</Trans>
					</Link>
					{!version &&
						hasApplicationSubmission(application) &&
						(recorded ? (
							<Button
								size="sm"
								variant="ghost"
								className="-me-2.5"
								onClick={() => go("apply", { version: recorded.id })}
							>
								<Icon name="clock-counter-clockwise" size={16} />
								<Trans>View recorded answers</Trans>
							</Button>
						) : (
							<span className="text-[13px] text-ink-3">
								<Trans>No recorded answers are available.</Trans>
							</span>
						))}
				</div>
				{!stored && (
					<AnswerLibrary
						company={application.company}
						applicationId={application.id}
						disabled={submitting || live.length >= 30}
						onUse={(answer) =>
							workspace.save({ answers: [...workspace.current().answers, { ...answer, id: crypto.randomUUID() }] })
						}
					/>
				)}
				{shown.length > 0 && (
					<div>
						<AnimatePresence initial={false}>
							{shown.map((answer) => (
								<CollapseRow
									key={stored ? `${version?.id ?? sentItem?.id}:${answer.id}` : answer.id}
									className="pb-4 last:pb-0"
								>
									<AnswerCard
										answer={answer}
										facts={facts}
										applicationId={application.id}
										company={application.company}
										readOnly={stored !== undefined}
										disabled={submitting}
										registerDraft={registerDraft}
										onSave={(patch, accepted) => saveAnswer(answer.id, patch, accepted)}
										onRemove={() => removeAnswer(answer.id)}
										unit={unit}
										onToggleUnit={() => setUnit(unit === "words" ? "characters" : "words")}
									/>
								</CollapseRow>
							))}
						</AnimatePresence>
					</div>
				)}

				{!stored && (
					<>
						{shown.length > 0 && <AiNotice />}
						<button
							type="button"
							disabled={submitting || live.length >= 30}
							onClick={() =>
								workspace.save({
									answers: [
										...workspace.current().answers,
										{ id: crypto.randomUUID(), question: "", answer: "", factIds: [] },
									],
								})
							}
							className="touch-target flex h-9 items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-2 text-[13px] font-medium text-ink-2 transition-colors duration-quick hover:bg-hover hover:text-ink"
						>
							<Icon name="plus" size={16} />
							<Trans>Add a question from the form</Trans>
						</button>
						{live.length >= 30 && (
							<p className="text-xs text-ink-3">
								<Trans>You can keep up to 30 application questions.</Trans>
							</p>
						)}
					</>
				)}
			</div>
		</div>
	);
}

type AnswerCardProps = {
	answer: Answer;
	facts: Fact[] | undefined;
	applicationId: string;
	company: string;
	readOnly: boolean;
	disabled: boolean;
	registerDraft: (id: string, read: () => Answer) => () => void;
	onSave: (patch: Partial<Answer>, accepted?: AnswerSnapshot) => Promise<boolean>;
	onRemove: () => void;
	unit: CountUnit;
	onToggleUnit: () => void;
};

/**
 * One form question: autosaving answer, its length in words or characters, backing facts, and Draft/Tighten. Its
 * menu edits the question or removes it (with Undo).
 */
function AnswerCard({
	answer,
	facts,
	applicationId,
	company,
	readOnly,
	disabled,
	registerDraft,
	onSave,
	onRemove,
	unit,
	onToggleUnit,
}: AnswerCardProps) {
	const textDraft = useSessionDraft(
		readOnly ? null : `answer:${applicationId}:${answer.id}`,
		answer.answer,
		(value) => (typeof value === "string" ? value : undefined),
		true,
	);
	const questionDraft = useSessionDraft(
		readOnly ? null : `question:${applicationId}:${answer.id}`,
		answer.question,
		(value) => (typeof value === "string" ? value : undefined),
		true,
	);
	const { value: text, setValue: setText } = textDraft;
	const { value: question, setValue: setQuestion } = questionDraft;
	useLayoutEffect(
		() => registerDraft(answer.id, () => ({ ...answer, question, answer: text })),
		[answer, question, text, registerDraft],
	);
	const [editingQuestion, setEditingQuestion] = useState(answer.question === "");
	// Edit question focuses the field as its menu closes; the menu would otherwise take focus back and end the edit.
	const questionField = useRef<HTMLTextAreaElement>(null);
	// A draft or tightening, with the answer it was written from: Accept saves it, and Undo restores that answer.
	const [proposal, setProposal] = useState<{
		text: string;
		factIds: string[];
		before: { text: string; factIds: string[] };
	} | null>(null);
	// The answer as it reads now, for a toast's Undo that runs after later renders.
	const current = useRef({ text, factIds: answer.factIds });
	useLayoutEffect(() => {
		current.current = { text, factIds: answer.factIds };
	});
	const previousSaved = useRef(answer.answer);
	useLayoutEffect(() => {
		// A refetch is not a local edit to autosave. Keep only text the user changed since the last saved copy.
		if (previousSaved.current !== answer.answer && current.current.text === previousSaved.current)
			setText(answer.answer);
		previousSaved.current = answer.answer;
	}, [answer.answer, setText]);
	const generate = useGenerate(applicationId);
	const { provider } = useDefaultProvider();
	const flushAnswer = useDebouncedSave(
		disabled || readOnly || textDraft.restored ? answer.answer : text,
		answer.answer,
		(value) => onSave({ answer: value }),
	);
	const flushQuestion = useDebouncedSave(
		disabled || readOnly || questionDraft.restored ? answer.question : question,
		answer.question,
		(value) => onSave({ question: value }),
	);

	const words = countWords(text);
	const characters = [...text].length;
	const backing = answer.factIds.flatMap((id) => facts?.find((fact) => fact.id === id) ?? []);
	const empty = !text.trim();

	const ask = async () => {
		const before = { text, factIds: answer.factIds };
		const result = await generate.run({ task: "answer", question: question.trim(), answer: text }).catch(() => null);
		if (!result?.answer) return;
		// Written from an older copy: offering it would replace what the user typed since.
		if (current.current.text !== before.text) {
			toast.add({ description: t`Your answer changed while the draft was written. Draft again to use it.` });
			return;
		}
		setProposal({ ...result.answer, before });
	};

	const accept = (chosen: NonNullable<typeof proposal>) => {
		setText(chosen.text);
		textDraft.accept();
		const saved = onSave({ answer: chosen.text, factIds: chosen.factIds });
		setProposal(null);
		void saved.then(
			(ok) =>
				ok &&
				toast.add({
					description: t`Answer replaced`,
					actionProps: {
						children: t`Undo`,
						onClick: async () => {
							// Only while the answer is still the accepted one: later typing (here or on another device) stays.
							const now = current.current;
							if (now.text !== chosen.text) {
								toast.add({ description: t`The answer changed since, so it wasn't restored.` });
								return;
							}
							const restored = await onSave(
								{ answer: chosen.before.text, factIds: chosen.before.factIds },
								{ answer: chosen.text, factIds: chosen.factIds },
							);
							if (restored && current.current.text === chosen.text) setText(chosen.before.text);
						},
					},
				}),
		);
	};

	return (
		<section className="grid gap-3 rounded-xl border border-line bg-surface p-4">
			<DraftRecovery {...textDraft} />
			<DraftRecovery {...questionDraft} />
			<div className="flex items-start gap-3">
				{editingQuestion && !readOnly ? (
					<Textarea
						// oxlint-disable-next-line jsx-a11y/no-autofocus -- opened by the user's click on Add a question or Edit question
						autoFocus
						ref={questionField}
						rows={1}
						value={question}
						maxLength={2000}
						disabled={disabled}
						aria-label={t`Question from the form`}
						placeholder={t`Paste the question from the form`}
						onChange={(event) => setQuestion(event.target.value)}
						onFocus={(event) => event.currentTarget.setSelectionRange(question.length, question.length)}
						onKeyDown={(event) => {
							// A question is one line of the form; Enter finishes it.
							if (event.key === "Enter") {
								event.preventDefault();
								event.currentTarget.blur();
							}
						}}
						onBlur={() => {
							flushQuestion();
							if (question.trim()) setEditingQuestion(false);
						}}
						className="field-sizing-content min-h-0 w-full min-w-0 flex-1 resize-none px-2.5 py-1.5 text-[15px] leading-[22px] font-semibold"
					/>
				) : (
					<h2 className="min-w-0 flex-1 text-[15px] leading-[22px] font-semibold">{question}</h2>
				)}
				{/* Forms limit words or characters; the count switches between them, for every question at once. */}
				<Tooltip>
					<TooltipTrigger
						render={
							<button
								type="button"
								onClick={onToggleUnit}
								className="shrink-0 rounded-sm font-mono text-xs leading-[22px] font-medium text-ink-2 transition-colors duration-quick hover:text-ink"
							/>
						}
					>
						{unit === "words"
							? plural(words, { one: "# word", other: "# words" })
							: plural(characters, { one: "# character", other: "# characters" })}
					</TooltipTrigger>
					<TooltipContent>{unit === "words" ? t`Count characters` : t`Count words`}</TooltipContent>
				</Tooltip>
				{!readOnly && (
					<DropdownMenu>
						<DropdownMenuTrigger
							render={
								<IconButton
									icon="dots-three"
									label={t`Question options`}
									disabled={disabled}
									size="icon-sm"
									className="-my-1 -me-1.5 shrink-0 text-ink-2"
								/>
							}
						/>
						<DropdownMenuContent align="end" finalFocus={questionField}>
							<DropdownMenuItem onClick={() => setEditingQuestion(true)}>
								<Icon name="pencil-simple" size={18} />
								<Trans>Edit question</Trans>
							</DropdownMenuItem>
							<DropdownMenuItem variant="destructive" onClick={onRemove}>
								<Icon name="trash" size={18} />
								<Trans>Remove question</Trans>
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				)}
			</div>

			<Swap id={proposal ? "diff" : "text"}>
				{proposal ? (
					<div className="grid gap-2.5">
						<ChangeSummary before={proposal.before.text} after={proposal.text} />
						<p className="rounded-md border border-line-2 bg-raised px-3.5 py-3 text-sm leading-[22px]">
							{diffWords(text, proposal.text).map((part, index) => (
								<span
									key={index}
									className={cn(
										part.type === "removed" && "text-ink-3 line-through",
										part.type === "added" && "rounded-md bg-accent-soft text-accent-text",
									)}
								>
									{part.text}{" "}
								</span>
							))}
						</p>
						<div className="flex gap-1.5">
							<Button size="sm" variant="secondary" disabled={disabled} onClick={() => accept(proposal)}>
								<Icon name="check" size={16} />
								<Trans>Accept</Trans>
							</Button>
							<Button size="sm" variant="ghost" onClick={() => setProposal(null)}>
								<Trans>Skip</Trans>
							</Button>
						</div>
						{proposal.factIds.length > 0 && (
							<p className="text-xs text-ink-3">
								{t`Uses: ${proposal.factIds
									.map((id) => facts?.find((fact) => fact.id === id)?.text)
									.filter(Boolean)
									.map((value) => shortLabel(value ?? ""))
									.join(" · ")}`}
							</p>
						)}
					</div>
				) : readOnly ? (
					<p className="rounded-md border border-line bg-raised px-3.5 py-3 text-sm leading-[22px] whitespace-pre-wrap text-ink-2">
						{text}
					</p>
				) : (
					<Textarea
						value={text}
						maxLength={6000}
						disabled={disabled}
						aria-label={question || t`Answer`}
						placeholder={t`Write your answer, or draft one from your Knowledge.`}
						onChange={(event) => setText(event.target.value)}
						onBlur={flushAnswer}
						className="min-h-[88px] px-3.5 py-3 text-sm leading-[22px] pointer-coarse:text-base"
					/>
				)}
			</Swap>

			{!readOnly && (
				<AnswerLibrary
					company={company}
					applicationId={applicationId}
					current={{ ...answer, question, answer: text }}
					disabled={disabled}
					onUse={(value) => {
						setText(value.answer);
						setQuestion(value.question);
						textDraft.accept();
						questionDraft.accept();
						onSave(value);
					}}
				/>
			)}
			<div className="flex items-start gap-3">
				{backing.length > 0 && (
					<div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
						<span className="me-1 text-xs text-ink-3">
							<Trans>Backed by</Trans>
						</span>
						{backing.map((fact) => (
							<Tooltip key={fact.id}>
								<TooltipTrigger
									render={
										<span className="inline-flex h-6 items-center gap-1 rounded-sm border border-line px-2 text-xs text-ink-2" />
									}
								>
									<Icon name="link-simple-horizontal" size={14} />
									{shortLabel(fact.text)}
								</TooltipTrigger>
								<TooltipContent>{fact.text}</TooltipContent>
							</Tooltip>
						))}
					</div>
				)}
				{!readOnly && !proposal && provider && (
					<Button
						size="sm"
						variant="ghost"
						className="ms-auto shrink-0"
						loading={generate.isPending}
						disabled={disabled || !question.trim()}
						onClick={() => void ask()}
					>
						{!generate.isPending && <Icon name="sparkle" size={16} />}
						{generate.isPending ? (
							<Working steps={workingSteps(empty ? "answer" : "tighten")} />
						) : empty ? (
							<Trans>Draft</Trans>
						) : (
							<Trans>Tighten</Trans>
						)}
					</Button>
				)}
			</div>
		</section>
	);
}

type ChangeSummaryProps = { before: string; after: string };

/** One line above the diff: how much shorter, and which of the user's sentences go or new ones come in. */
function ChangeSummary({ before, after }: ChangeSummaryProps) {
	if (!before.trim()) return null;
	const { words, removed, added } = rewriteSummary(before, after);
	const difference = -words;
	const parts = [
		difference > 0
			? plural(difference, { one: "Shorter by # word", other: "Shorter by # words" })
			: difference < 0
				? plural(-difference, { one: "Longer by # word", other: "Longer by # words" })
				: t`Same length`,
		...(removed > 0
			? [
					plural(removed, {
						one: "changes or removes # of your sentences",
						other: "changes or removes # of your sentences",
					}),
				]
			: []),
		...(added > 0 ? [plural(added, { one: "# new or reworded sentence", other: "# new or reworded sentences" })] : []),
	];
	return (
		<p className={cn("text-xs", removed > 0 ? "text-warn-text" : "text-ink-3")}>
			{parts.join(" · ")}
			{removed > 0 && ` ${t`Check that nothing you wrote yourself is lost.`}`}
		</p>
	);
}

type DiffPart = { type: "same" | "removed" | "added"; text: string };

/**
 * Word-level diff by longest common subsequence. ponytail: O(words²) table, fine for form answers (≤ ~1,000 words);
 * swap in a Myers diff if answers grow far past that.
 */
function diffWords(before: string, after: string): DiffPart[] {
	const a = before.split(/\s+/).filter(Boolean);
	const b = after.split(/\s+/).filter(Boolean);
	const width = b.length + 1;
	const table = new Uint16Array((a.length + 1) * width);
	for (let i = a.length - 1; i >= 0; i--)
		for (let j = b.length - 1; j >= 0; j--)
			table[i * width + j] =
				a[i] === b[j]
					? (table[(i + 1) * width + j + 1] ?? 0) + 1
					: Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);

	const parts: DiffPart[] = [];
	const push = (type: DiffPart["type"], word: string) => {
		const last = parts.at(-1);
		if (last?.type === type) last.text += ` ${word}`;
		else parts.push({ type, text: word });
	};
	let i = 0;
	let j = 0;
	while (i < a.length || j < b.length) {
		if (i < a.length && j < b.length && a[i] === b[j]) {
			push("same", a[i] ?? "");
			i++;
			j++;
		} else if (
			j < b.length &&
			(i >= a.length || (table[i * width + j + 1] ?? 0) >= (table[(i + 1) * width + j] ?? 0))
		) {
			push("added", b[j] ?? "");
			j++;
		} else {
			push("removed", a[i] ?? "");
			i++;
		}
	}
	return parts;
}

type ChecklistProps = {
	application: WorkspaceTabProps["application"];
	answers: Answer[];
	currentAnswers: () => Answer[];
	readOnly: boolean;
	canSubmit: boolean;
	submitting: boolean;
	onSubmittingChange: (value: boolean) => void;
};

/** Manual content checks survive submission; submission actions follow the application record. */
function Checklist({
	application,
	answers,
	currentAnswers,
	readOnly,
	canSubmit,
	submitting,
	onSubmittingChange,
}: ChecklistProps) {
	const queryClient = useQueryClient();
	const invalidate = useInvalidateApplications();
	const workspace = useWorkspace(application.id);
	const { data: documents } = useQuery(orpc.documents.list.queryOptions({ input: { trashed: false } }));
	const submit = useMutation(orpc.career.submitApplication.mutationOptions());
	const submitted = hasApplicationSubmission(application);
	const items = checklistItems(submitted);
	const ticked = workspace.data.checklist;
	const done = items.filter((_, index) => ticked.includes(index)).length;
	const written = answers.filter((answer) => answer.answer.trim());
	// Recording the submission is the one emphasised action only once preparation has nothing left to guide.
	const primary = nextPreparationStep(application, workspace.data, documents) === "review";
	const resumeName =
		documents?.find((document) => document.type === "resume" && document.id === application.resumeId)?.name ??
		(application.resumeFileUrl ? application.resumeFileName || t`Resume file` : null);
	const letterName =
		documents?.find((document) => document.type === "letter" && document.id === application.coverLetterId)?.name ??
		(application.coverLetterUrl ? application.coverLetterName || t`Cover letter file` : null);
	const names = [resumeName, letterName].filter((name): name is string => name !== null);
	const records = [
		...(names.length > 0 ? names : [t`no documents`]),
		plural(written.length, { one: "# answer", other: "# answers" }),
	];

	const toggle = (index: number, on: boolean) => {
		const current = workspace.current().checklist;
		workspace.save({ checklist: on ? [...new Set([...current, index])] : current.filter((item) => item !== index) });
	};

	const copy = async () => {
		const written = currentAnswers().filter((answer) => answer.answer.trim());
		await navigator.clipboard.writeText(written.map((answer) => `${answer.question}\n${answer.answer}`).join("\n\n"));
		toast.add({ description: t`Answers copied` });
	};

	const download = (format: "md" | "txt") => {
		const written = currentAnswers().filter((answer) => answer.answer.trim());
		const body =
			format === "md"
				? [
						`# ${application.role} · ${application.company}`,
						...written.map((answer) => `## ${answer.question}\n\n${answer.answer}`),
					].join("\n\n")
				: [
						`${application.role} · ${application.company}`,
						...written.map((answer) => `${answer.question}\n\n${answer.answer}`),
					].join("\n\n\n");
		downloadWithAnchor(
			new Blob([`${body}\n`], { type: format === "md" ? "text/markdown" : "text/plain" }),
			generateFilename(`${application.company} answers`, format),
		);
	};

	const markApplied = async () => {
		if (readOnly || submitting) return;
		const answers = currentAnswers();
		if (!careerWorkspaceSchema.shape.answers.safeParse(answers).success) return;
		onSubmittingChange(true);
		try {
			const currentWorkspace = await workspace.settled();
			await submit.mutateAsync({
				applicationId: application.id,
				answers,
				expectedAnswers: currentWorkspace.answers,
				expectedDocuments: { resumeId: application.resumeId, coverLetterId: application.coverLetterId },
			});
			queryClient.setQueryData(orpc.career.workspace.queryKey({ input: { applicationId: application.id } }), {
				...currentWorkspace,
				answers,
			});
			toast.add({ description: t`Marked as applied. The versions you sent are kept.` });
		} catch (error) {
			toastError(error, t`Couldn't mark it as applied. Try again.`, { allowServerMessage: true });
		} finally {
			onSubmittingChange(false);
			invalidate(application.id);
			void queryClient.invalidateQueries({ queryKey: orpc.career.savedItems.key() });
		}
	};

	return (
		<aside
			id="application-readiness"
			tabIndex={-1}
			className="grid gap-3.5 rounded-xl border border-line bg-surface p-4 @3xl:sticky @3xl:top-6 @3xl:col-start-2 @3xl:row-span-2 @3xl:row-start-1 @3xl:self-start"
		>
			<div className="flex items-baseline justify-between gap-3">
				<h2 className="text-sm font-semibold">
					<Trans>Review checks</Trans>
				</h2>
				<span className="text-xs text-ink-2 tabular-nums">{t`${done} of ${items.length}`}</span>
			</div>
			<ul className="grid gap-2.5">
				{items.map((label, index) => (
					<li key={label}>
						<label className="flex cursor-pointer gap-2.5 text-[13px] leading-[19px]">
							<Checkbox
								className="mt-px"
								checked={ticked.includes(index)}
								disabled={readOnly || submitting}
								onCheckedChange={(checked) => toggle(index, checked)}
							/>
							<span
								className={cn("transition-colors duration-quick", ticked.includes(index) ? "text-ink-2" : "text-ink")}
							>
								{label}
							</span>
						</label>
					</li>
				))}
			</ul>
			{application.status === "saved" && !readOnly && (
				<div className="grid gap-2 border-t border-line pt-3.5">
					<Button
						className="w-full"
						variant={primary ? "primary" : "secondary"}
						disabled={!canSubmit}
						loading={submitting}
						onClick={() => void markApplied()}
					>
						<Trans>Mark as applied</Trans>
					</Button>
					{canSubmit ? (
						<p className="text-xs leading-[17px] text-ink-3">
							<Trans>Records {records.join(" · ")} as sent. You submit on the employer's site yourself.</Trans>
						</p>
					) : (
						<p role="alert" className="text-xs text-danger-text">
							<Trans>
								Shorten questions to 2,000 characters and answers to 6,000 characters before marking this applied.
							</Trans>
						</p>
					)}
				</div>
			)}
			<div className="flex flex-wrap gap-1.5 border-t border-line pt-3.5">
				<Button variant="secondary" size="sm" disabled={written.length === 0} onClick={() => void copy()}>
					<Icon name="copy" size={16} />
					<Trans>Copy answers</Trans>
				</Button>
				<DropdownMenu>
					<DropdownMenuTrigger render={<Button variant="ghost" size="sm" disabled={written.length === 0} />}>
						<Icon name="download-simple" size={16} />
						<Trans>Download</Trans>
					</DropdownMenuTrigger>
					<DropdownMenuContent>
						<DropdownMenuItem onClick={() => download("md")}>
							<Trans>Markdown (.md)</Trans>
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => download("txt")}>
							<Trans>Plain text (.txt)</Trans>
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
			{submitted && (
				<p className="text-xs leading-[17px] text-ink-3">
					<Trans>Review checks only reflect what you checked yourself.</Trans>
				</p>
			)}
		</aside>
	);
}
