import type { Fact } from "../hooks";
import type { WorkspaceTabProps } from "./shell";
import type { CareerWorkspace } from "@reactive-resume/schema/career";
import { i18n } from "@lingui/core";
import { ph, plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AnimatePresence } from "motion/react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { answerLimit } from "@reactive-resume/schema/application-answers";
import { hasApplicationSubmission } from "@reactive-resume/schema/applications/data";
import { nextPreparationStep } from "@reactive-resume/schema/applications/preparation";
import { applicationReviewChecks } from "@reactive-resume/schema/applications/preparation";
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
import { CollapseRow, Swap, withUndo, GenerateNotice, Working, workingSteps, useCareerTime, useNow } from "../shared";
import { AnswerLibrary } from "./answer-library";
import { ApplicationPacketPanel } from "./application-packet";
import { AiNotice } from "./fit";
import { Preparation } from "./preparation";
import { PageHeader } from "@/components/calm/page";
import { SectionHeading } from "@/components/calm/section-heading";
import { Combobox } from "@/components/ui/combobox";
import { SentDocuments } from "@/features/applications/components/detail/sent-documents";
import { useInvalidateApplications } from "@/features/applications/use-application-actions";
import { getAccountGeneration } from "@/libs/auth/account-scope";
import { toastError } from "@/libs/error-message";
import { client, orpc, prepareRpc } from "@/libs/orpc/client";
import { invalidateMutationQueries } from "@/libs/query/client";

type Answer = CareerWorkspace["answers"][number];
type AnswerSnapshot = Pick<Answer, "answer" | "factIds" | "aiOperationIds">;
type CountUnit = "words" | "characters";

const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** A fact's chip label: its first few words. The tooltip has the whole fact. */
const shortLabel = (text: string) => {
	const words = text.split(/\s+/).filter(Boolean);
	return words.length > 4 ? `${words.slice(0, 4).join(" ")}…` : text;
};

/** The review checks, by their persisted checklist index. Submitting yourself (3) is moot once a submission is recorded. */
const checklistItems = () =>
	[
		t`Read the resume and letter once more in their editors`,
		t`Check every claim, date and result against your experience`,
		t`Review the form answers and remove anything you can't support`,
		t`Submit through the employer's application page yourself.`,
	] as const;

/** W4–W5: the written answers for the employer's form, and a checklist before submitting there yourself. */
export function ApplyTab({ application, version, go }: WorkspaceTabProps) {
	const queryClient = useQueryClient();
	const documents = useQuery(orpc.documents.list.queryOptions({ input: { trashed: false } }));
	const saved = useSavedItems(application.id);
	const workspace = useWorkspace(application.id);
	const { data: facts } = useQuery(orpc.career.facts.queryOptions({ input: { applicationId: application.id } }));
	const readOnlyVersion = version?.data.kind === "answers" ? version.data : undefined;
	const recorded = saved.data?.find((item) => item.submission && item.data.kind === "answers");
	const reviewed =
		saved.data?.find((item) => item.id === workspace.data?.submissionReview?.answerVersionId) ?? recorded;
	const candidate = recorded ?? (!hasApplicationSubmission(application) ? latest(saved.data, "answers") : undefined);
	const sentItem = candidate?.data.kind === "answers" ? { ...candidate, data: candidate.data } : undefined;
	// Removed questions wait out their Undo here; the workspace drops them when the toast closes.
	const [removed, setRemoved] = useState<string[]>([]);
	const removing = useRef(new Set<string>());
	const [unit, setUnit] = useState<CountUnit>("words");
	const [submitting, setSubmitting] = useState(false);
	const [canSubmit, setCanSubmit] = useState(true);
	const [writtenDrafts, setWrittenDrafts] = useState<ReadonlyMap<string, boolean>>(new Map());
	const drafts = useRef(new Map<string, () => Answer>());
	const registerDraft = useCallback((id: string, read: () => Answer) => {
		drafts.current.set(id, read);
		const updateValidity = () => {
			const answers = [...drafts.current.values()].map((value) => value());
			setCanSubmit(careerWorkspaceSchema.shape.answers.safeParse(answers).success);
			setWrittenDrafts((previous) => {
				const next = new Map(answers.map((answer) => [answer.id, Boolean(answer.answer.trim())]));
				return next.size === previous.size && [...next].every(([key, value]) => previous.get(key) === value)
					? previous
					: next;
			});
		};
		updateValidity();
		return () => {
			drafts.current.delete(id);
			updateValidity();
		};
	}, []);

	if (workspace.isPending || saved.isPending)
		return (
			<div className="grid gap-4">
				<PageHeader title={t`Apply`} />
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
				JSON.stringify(current.factIds) !== JSON.stringify(accepted.factIds) ||
				JSON.stringify(current.aiOperationIds ?? []) !== JSON.stringify(accepted.aiOperationIds ?? []))
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
		const generation = getAccountGeneration();
		const key = JSON.stringify([generation, application.id, id]);
		if (removing.current.has(key)) return;
		removing.current.add(key);
		const current = () => generation === getAccountGeneration();
		const reconcile = async () => {
			removing.current.delete(key);
			await workspace.settled();
			if (!current()) return;
			const queryKey = orpc.career.workspace.queryKey({ input: { applicationId: application.id } });
			void invalidateMutationQueries(queryClient, queryKey);
			await queryClient.cancelQueries({ queryKey });
			if (!current()) return;
			await queryClient.invalidateQueries({ queryKey, refetchType: "all" }, { throwOnError: true });
			if (current()) setRemoved((ids) => ids.filter((item) => item !== id));
		};
		const failed = () => {
			if (!current()) return;
			toast.add({
				type: "error",
				description: t`Couldn't save that change. Check your connection and try again.`,
				actionProps: {
					children: t`Retry`,
					onClick: () => {
						void reconcile().catch(failed);
					},
				},
			});
		};
		withUndo({
			description: t`Question removed`,
			onReady: () => setRemoved((ids) => [...ids, id]),
			prepare: async () => {
				const value = await workspace.settled();
				if (!current()) throw new DOMException("", "AbortError");
				const expected = value.answers.find((answer) => answer.id === id);
				if (!expected) throw new Error("Answer no longer available");
				return prepareRpc(client.career.deleteWorkspaceAnswer, { applicationId: application.id, id, expected });
			},
			onPrepareError: () => {
				failed();
				void reconcile().catch(failed);
			},
			commit: (result) => result.catch(failed).then(() => reconcile().catch(failed)),
			onUndo: () => reconcile().catch(failed),
		});
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

	const answerCount = shown.filter((answer) =>
		stored ? answer.answer.trim() : (writtenDrafts.get(answer.id) ?? Boolean(answer.answer.trim())),
	).length;
	const addQuestion = (
		<button
			type="button"
			disabled={submitting || live.length >= 30}
			onClick={() =>
				workspace.save({
					answers: [...workspace.current().answers, { id: crypto.randomUUID(), question: "", answer: "", factIds: [] }],
				})
			}
			className="touch-target relative flex h-7 w-fit items-center justify-center gap-1.5 rounded-sm border border-dashed border-line-2 px-2.5 text-[13px]/[18px] font-medium text-ink-3 transition-colors duration-quick hover:bg-hover hover:text-ink"
		>
			<Icon name="plus" size={16} />
			<Trans>Add a question</Trans>
		</button>
	);
	const steps = ["posting", "resume", "tailor", "letter", "answers", "review"] as const;
	const next = nextPreparationStep(application, workspace.data, documents.data);
	const stepIndex = steps.indexOf(next as (typeof steps)[number]);
	const stepLabels = {
		posting: t`Save the job posting`,
		resume: t`Choose a base resume`,
		tailor: t`Tailor and review your resume`,
		letter: t`Write a cover letter if required`,
		answers: t`Write and review your form answers`,
		review: t`Review readiness and record your submission`,
	};
	return (
		<div>
			<PageHeader
				title={t`Apply`}
				className="[&>div]:min-h-9"
				actions={
					application.sourceUrl && (
						<a
							href={application.sourceUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex h-9 items-center gap-2 px-3.5 text-sm font-medium text-ink-2"
						>
							<Icon name="arrow-square-out" />
							<Trans>Open the posting</Trans>
						</a>
					)
				}
			/>
			{stepIndex >= 0 && !version && (
				<div className="flex flex-wrap items-center gap-3 pt-2">
					<div className="flex h-1 w-36 gap-1" role="img" aria-label={t`Step ${stepIndex + 1} of 6`}>
						{steps.map((step, index) => (
							<span
								key={step}
								className={cn(
									"h-full flex-1 rounded-full",
									index < stepIndex ? "bg-ink-3" : index === stepIndex ? "bg-ink" : "bg-line",
								)}
							/>
						))}
					</div>
					<span className="text-[13px]/[18px] text-ink-2">
						{t`Step ${stepIndex + 1} of 6`} · {stepLabels[steps[stepIndex] ?? "posting"]}
					</span>
				</div>
			)}
			<div className="grid items-start gap-x-10 gap-y-0 @3xl:grid-cols-[minmax(0,1fr)_320px]">
				{!version && (
					<div className="grid gap-0 @3xl:col-start-1">
						{hasApplicationSubmission(application) ? (
							<SentDocuments application={application} disabled={submitting} variant="workspace" />
						) : (
							<>
								<Preparation key={application.id} application={application} disabled={submitting} />
							</>
						)}
					</div>
				)}

				<Checklist
					application={application}
					answerCount={
						shown.filter((answer) =>
							stored ? answer.answer.trim() : (writtenDrafts.get(answer.id) ?? Boolean(answer.answer.trim())),
						).length
					}
					currentAnswers={currentAnswers}
					readOnly={!!readOnlyVersion}
					versionId={readOnlyVersion ? version?.id : undefined}
					canSubmit={canSubmit}
					submitting={submitting}
					onSubmittingChange={setSubmitting}
				/>

				<div className="grid gap-0 @3xl:col-start-1">
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

					<SectionHeading
						id="application-answers"
						tabIndex={-1}
						className="pt-7"
						note={t`${answerCount} of ${shown.length} written`}
						action={
							!stored && (
								<AnswerLibrary
									company={application.company}
									applicationId={application.id}
									disabled={submitting || live.length >= 30}
									onUse={(answer) =>
										workspace.save({
											answers: [...workspace.current().answers, { ...answer, id: crypto.randomUUID() }],
										})
									}
								/>
							)
						}
					>
						<Trans>Form answers</Trans>
					</SectionHeading>
					{!version &&
						hasApplicationSubmission(application) &&
						(reviewed ? (
							<Button
								size="sm"
								variant="ghost"
								className="-me-2.5"
								onClick={() => go("apply", { version: reviewed.id })}
							>
								<Icon name="clock-counter-clockwise" size={16} />
								<Trans>View recorded answers</Trans>
							</Button>
						) : (
							<span className="text-[13px] text-ink-3">
								<Trans>No recorded answers are available.</Trans>
							</span>
						))}

					{shown.length > 0 && (
						<div>
							<AnimatePresence initial={false}>
								{shown.map((answer, index) => (
									<CollapseRow
										key={stored ? `${version?.id ?? sentItem?.id}:${answer.id}` : answer.id}
										className={index === 0 ? "[&>section]:pt-1.5" : ""}
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
							{shown.length > 0 && (
								<AiNotice
									needs={<Trans>Drafting answers needs AI.</Trans>}
									works={<Trans>Your application profile and the checklist work without it.</Trans>}
								/>
							)}
							{answerCount === 0 && addQuestion}
							{live.length >= 30 && (
								<p className="text-xs text-ink-3">
									<Trans>You can keep up to 30 application questions.</Trans>
								</p>
							)}
						</>
					)}
					{answerCount > 0 && (
						<div className="flex flex-wrap items-center gap-2 pt-3.5">
							{!stored && addQuestion}
							<span className="flex-1" />
							<Button variant="ghost" size="sm" disabled={answerCount === 0} onClick={() => void copy()}>
								<Icon name="copy" size={16} />
								<Trans>Copy answers</Trans>
							</Button>
							<DropdownMenu>
								<DropdownMenuTrigger render={<Button variant="ghost" size="sm" disabled={answerCount === 0} />}>
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
					)}
					{!version && (
						<div className="mt-5">
							<ApplicationPacketPanel application={application} />
							<Link to="/dashboard/settings/profile" className="mt-2 inline-block text-[13px] text-ink-3 underline">
								<Trans>Edit profile</Trans>
							</Link>
						</div>
					)}
				</div>
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
		() => (readOnly ? undefined : registerDraft(answer.id, () => ({ ...answer, question, answer: text }))),
		[answer, question, text, registerDraft, readOnly],
	);
	const [editingQuestion, setEditingQuestion] = useState(answer.question === "");
	// Edit question focuses the field as its menu closes; the menu would otherwise take focus back and end the edit.
	const questionField = useRef<HTMLTextAreaElement>(null);
	// A draft or tightening, with the answer it was written from: Accept saves it, and Undo restores that answer.
	const [proposal, setProposal] = useState<{
		text: string;
		factIds: string[];
		note?: string | null;
		aiOperationIds?: string[] | undefined;
		before: { text: string; factIds: string[]; aiOperationIds: string[] };
	} | null>(null);
	// The answer as it reads now, for a toast's Undo that runs after later renders.
	const current = useRef({ text, question, factIds: answer.factIds, aiOperationIds: answer.aiOperationIds ?? [] });
	useLayoutEffect(() => {
		current.current = { text, question, factIds: answer.factIds, aiOperationIds: answer.aiOperationIds ?? [] };
	});
	const previousSaved = useRef({ text: answer.answer, question: answer.question });
	useLayoutEffect(() => {
		// A refetch is not a local edit to autosave. Keep only text the user changed since the last saved copy.
		if (previousSaved.current.text !== answer.answer && current.current.text === previousSaved.current.text)
			setText(answer.answer);
		if (
			previousSaved.current.question !== answer.question &&
			current.current.question === previousSaved.current.question
		)
			setQuestion(answer.question);
		previousSaved.current = { text: answer.answer, question: answer.question };
	}, [answer.answer, answer.question, setText, setQuestion]);
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

	// While a draft waits for Accept, the count is the draft's, so its fit against the form's limit shows first.
	const counted = proposal?.text ?? text;
	const words = countWords(counted);
	const characters = [...counted].length;
	const was = proposal ? (unit === "words" ? countWords(text) : [...text].length) : null;
	const backing = answer.factIds.flatMap((id) => facts?.find((fact) => fact.id === id) ?? []);
	const empty = !text.trim();

	const ask = async () => {
		// Save the current question even when Draft is clicked before blur.
		flushQuestion();
		const before = { text, factIds: answer.factIds, aiOperationIds: answer.aiOperationIds ?? [] };
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
		const aiOperationIds = [...new Set([...chosen.before.aiOperationIds, ...(chosen.aiOperationIds ?? [])])];
		const saved = onSave({ answer: chosen.text, factIds: chosen.factIds, aiOperationIds });
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
								{
									answer: chosen.before.text,
									factIds: chosen.before.factIds,
									aiOperationIds: chosen.before.aiOperationIds,
								},
								{ answer: chosen.text, factIds: chosen.factIds, aiOperationIds },
							);
							if (restored && current.current.text === chosen.text) setText(chosen.before.text);
						},
					},
				}),
		);
	};
	const limit = answerLimit(question);
	const measured = (value: string) => (limit?.kind === "characters" ? [...value].length : countWords(value));
	const shownLimit = limit && limit.kind === unit ? limit.max : null;
	const over = shownLimit !== null && (unit === "words" ? words : characters) > shownLimit;
	const stale = proposal !== null && text !== proposal.before.text;

	return (
		<section className="grid gap-2 border-b border-line pt-3.5 pb-4">
			<DraftRecovery {...textDraft} />
			<DraftRecovery {...questionDraft} />
			<div className="flex items-center gap-2">
				{editingQuestion && !readOnly ? (
					<Textarea
						// What people paste or write here can be in any language: its own text sets the direction.
						dir="auto"
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
						className="field-sizing-content min-h-0 w-full min-w-0 flex-1 resize-none px-2.5 py-1.5 text-[15px] leading-[22px] font-medium"
					/>
				) : (
					// Same box as the field it replaces: swapping must not move Draft out from under the pointer.
					<h2 className="min-w-0 flex-1 text-[15px] leading-[22px] font-medium">{question}</h2>
				)}
				{/* Forms limit words or characters; the count switches between them, for every question at once. */}
				<Tooltip>
					<TooltipTrigger
						render={
							<button
								type="button"
								onClick={onToggleUnit}
								className={cn(
									"touch-target relative shrink-0 rounded-sm font-mono text-xs leading-4 font-medium text-ink-3 transition-colors duration-quick hover:text-ink",
									over && "text-warn-text hover:text-warn-text",
								)}
							/>
						}
					>
						{/* The question's own limit, when it states one in this unit: "174 of 150 words". */}
						{shownLimit
							? unit === "words"
								? t`${ph({ words: i18n.number(words) })} of ${ph({ shownLimit: i18n.number(shownLimit) })} words`
								: t`${ph({ characters: i18n.number(characters) })} of ${ph({ shownLimit: i18n.number(shownLimit) })} characters`
							: unit === "words"
								? plural(words, { one: "# word", other: "# words" })
								: plural(characters, { one: "# character", other: "# characters" })}
						{was !== null && ` · ${t`was ${was}`}`}
					</TooltipTrigger>
					<TooltipContent>{unit === "words" ? t`Count characters` : t`Count words`}</TooltipContent>
				</Tooltip>
				{!readOnly && (
					<AnswerLibrary
						company={company}
						applicationId={applicationId}
						current={{ ...answer, question, answer: text }}
						disabled={disabled}
						renderActions={(open) => (
							<DropdownMenu>
								<DropdownMenuTrigger
									render={
										<IconButton
											icon="dots-three"
											label={t`Question options`}
											disabled={disabled}
											size="icon-sm"
											iconSize={16}
											className="shrink-0 text-ink-2"
										/>
									}
								/>
								<DropdownMenuContent align="end" finalFocus={questionField}>
									<DropdownMenuItem onClick={() => setEditingQuestion(true)}>
										<Icon name="pencil-simple" size={18} />
										<Trans>Edit question</Trans>
									</DropdownMenuItem>
									<DropdownMenuItem
										disabled={disabled || !question.trim() || !text.trim()}
										onClick={() => open("save")}
									>
										<Icon name="bookmark-simple" size={18} />
										<Trans>Save for other applications</Trans>
									</DropdownMenuItem>
									<DropdownMenuItem disabled={disabled} onClick={() => open("list")}>
										<Icon name="books" size={18} />
										<Trans>Use a saved answer</Trans>
									</DropdownMenuItem>
									<DropdownMenuItem variant="destructive" onClick={onRemove}>
										<Icon name="trash" size={18} />
										<Trans>Remove question</Trans>
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						)}
						onUse={(value) => {
							setText(value.answer);
							setQuestion(value.question);
							textDraft.accept();
							questionDraft.accept();
							onSave(value);
						}}
					/>
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
						{proposal.note && (
							<p role="status" className="flex gap-1.5 rounded-md bg-warn-soft px-3 py-2 text-xs text-warn-text">
								<Icon name="warning-circle" size={16} className="shrink-0" />
								<Trans>Check before accepting: {proposal.note}</Trans>
							</p>
						)}
						{stale && (
							<p role="alert" className="flex gap-1.5 rounded-md bg-danger-soft px-3 py-2 text-xs text-danger-text">
								<Icon name="warning-circle" size={16} className="shrink-0" />
								<Trans>Your answer changed while this was drafted. Draft again to review the newer version.</Trans>
							</p>
						)}
						<div className="flex flex-wrap items-center gap-1.5">
							<Button size="sm" variant="secondary" disabled={disabled || stale} onClick={() => accept(proposal)}>
								<Icon name="check" size={16} />
								<Trans>Accept</Trans>
							</Button>
							<Button size="sm" variant="ghost" onClick={() => setProposal(null)}>
								<Trans>Reject</Trans>
							</Button>
							{limit && (
								<span
									className={cn(
										"ms-auto text-xs tabular-nums",
										measured(proposal.text) > limit.max ? "text-warn-text" : "text-ink-3",
									)}
								>
									{limit.kind === "characters"
										? t`${i18n.number(measured(proposal.text))} of ${i18n.number(limit.max)} characters`
										: t`${i18n.number(measured(proposal.text))} of ${i18n.number(limit.max)} words`}
								</span>
							)}
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
						// What people paste or write here can be in any language: its own text sets the direction.
						dir="auto"
						value={text}
						maxLength={6000}
						disabled={disabled}
						aria-label={question || t`Answer`}
						placeholder={t`Write your answer, or draft one from your Knowledge.`}
						onChange={(event) => setText(event.target.value)}
						onBlur={flushAnswer}
						className="min-h-16 resize-none px-3 py-2.5 text-sm leading-[22px] pointer-coarse:text-base"
					/>
				)}
			</Swap>

			<div className="flex items-center gap-3">
				<Tooltip>
					<TooltipTrigger
						render={<span className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px]/[18px] text-ink-3" />}
					>
						{backing.length ? (
							<>
								<Icon name="link-simple-horizontal" size={14} />
								{plural(backing.length, {
									one: "Backed by # fact in your Knowledge",
									other: "Backed by # facts in your Knowledge",
								})}
							</>
						) : (
							<Trans>No facts linked yet</Trans>
						)}
					</TooltipTrigger>
					{backing.length > 0 && (
						<TooltipContent className="grid max-w-sm gap-1">
							{backing.map((fact) => (
								<span key={fact.id}>{fact.text}</span>
							))}
						</TooltipContent>
					)}
				</Tooltip>
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
			{!readOnly && !proposal && <GenerateNotice generate={generate} onRetry={() => void ask()} className="w-fit" />}
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
	answerCount: number;
	currentAnswers: () => Answer[];
	readOnly: boolean;
	versionId: string | undefined;
	canSubmit: boolean;
	submitting: boolean;
	onSubmittingChange: (value: boolean) => void;
};

/** Manual content checks survive submission; submission actions follow the application record. */
function Checklist({
	application,
	answerCount,
	currentAnswers,
	readOnly,
	versionId,
	canSubmit,
	submitting,
	onSubmittingChange,
}: ChecklistProps) {
	const queryClient = useQueryClient();
	const invalidate = useInvalidateApplications();
	const workspace = useWorkspace(application.id);
	const { data: documents } = useQuery(orpc.documents.list.queryOptions({ input: { trashed: false } }));
	const submit = useMutation(orpc.career.submitApplication.mutationOptions());
	const time = useCareerTime();
	const now = useNow();
	const selectDocument = useMutation({
		...orpc.applications.update.mutationOptions(),
		onSuccess: () => invalidate(application.id),
		onError: (error) => toastError(error, t`Couldn't save that change. Try again.`),
	});

	const review = applicationReviewChecks(application, workspace.data);
	const { submitted, checklist: ticked } = review;
	const labels = [...checklistItems()];
	labels[3] = t`Submit on ${application.company}'s application page yourself`;
	const recordedVersion =
		!readOnly || (versionId !== undefined && versionId === workspace.data.submissionReview?.answerVersionId);
	const items = recordedVersion ? review.indices.map((index) => ({ index, label: labels[index] })) : [];
	const done = items.filter(({ index }) => ticked.includes(index)).length;
	// Recording the submission is the one emphasised action only once preparation has nothing left to guide.
	const resumeName =
		documents?.find((document) => document.type === "resume" && document.id === application.resumeId)?.name ??
		(application.resumeFileUrl ? application.resumeFileName || t`Resume file` : null);
	const letterName =
		documents?.find((document) => document.type === "letter" && document.id === application.coverLetterId)?.name ??
		(application.coverLetterUrl ? application.coverLetterName || t`Cover letter file` : null);
	const names = [resumeName, letterName].filter((name): name is string => name !== null);
	const records = [
		...(names.length > 0 ? names : [t`no documents`]),
		plural(answerCount, { one: "# answer", other: "# answers" }),
	];

	const toggle = (index: number, on: boolean) => {
		const current = workspace.current().checklist;
		workspace.save({ checklist: on ? [...new Set([...current, index])] : current.filter((item) => item !== index) });
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
			await queryClient.invalidateQueries({
				queryKey: orpc.career.workspace.queryKey({ input: { applicationId: application.id } }),
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
			className="mt-6 grid gap-3.5 rounded-xl border border-line bg-surface p-5 @3xl:sticky @3xl:top-6 @3xl:col-start-2 @3xl:row-span-2 @3xl:row-start-1 @3xl:self-start"
		>
			<div className="flex items-baseline justify-between gap-3">
				<h2 className="flex-1 t-label">
					<Trans>Before you send</Trans>
				</h2>
				{!submitted && !readOnly && (
					<span className="font-mono text-xs/4 font-medium text-ink-3 tabular-nums">{t`${ph({ done: i18n.number(done) })} of ${i18n.number(items.length)}`}</span>
				)}
			</div>
			<ul className="grid gap-2.5">
				{items.map(({ label, index }) => (
					<li key={label}>
						<label
							className={cn(
								"flex cursor-pointer gap-2.5 text-[13px] leading-[18px] transition-colors duration-quick",
								ticked.includes(index) ? "text-ink-2" : "text-ink",
							)}
						>
							<Checkbox
								className="mt-px"
								checked={ticked.includes(index)}
								disabled={readOnly || submitted || submitting}
								onCheckedChange={(checked) => toggle(index, checked)}
							/>
							{label}
						</label>
					</li>
				))}
			</ul>
			{application.status === "saved" && !submitted && !readOnly && (
				<div className="grid border-t border-line pt-3.5">
					<p className="pb-1 text-[13px]/[18px] text-ink-2">
						<Trans>Recorded as sent</Trans>
					</p>
					{(["resume", "letter"] as const).map((kind) => (
						<div key={kind} className="flex h-[30px] items-center gap-2">
							<Icon name={kind === "resume" ? "file-text" : "envelope-simple"} size={16} className="text-ink-3" />
							<label className="sr-only" htmlFor={`record-${application.id}-${kind}`}>
								{kind === "resume" ? t`Resume recorded as sent` : t`Letter recorded as sent`}
							</label>
							<Combobox
								id={`record-${application.id}-${kind}`}
								value={kind === "resume" ? application.resumeId : application.coverLetterId}
								options={(documents ?? [])
									.filter((document) => document.type === kind)
									.map((document) => ({ value: document.id, label: document.name }))}
								placeholder={t`None selected`}
								disabled={submitting || selectDocument.isPending}
								onValueChange={(value) =>
									selectDocument.mutate({
										id: application.id,
										...(kind === "resume" ? { resumeId: value } : { coverLetterId: value }),
									})
								}
								className="h-[30px] min-w-0 flex-1 border-transparent bg-transparent p-0 text-[13px]/[18px] font-normal shadow-none"
							/>
						</div>
					))}
					<p className="flex h-[30px] items-center gap-2 text-[13px]/[18px]">
						<Icon name="pencil-line" size={16} className="text-ink-3" />
						<span className="flex-1">
							{plural(answerCount, { one: "# written answer", other: "# written answers" })}
						</span>
					</p>
					<p className="flex h-[30px] items-center gap-2 text-[13px]/[18px]">
						<Icon name="calendar-blank" size={16} className="text-ink-3" />
						<span className="flex-1">{t`Today, ${time.date(now)}`}</span>
						<Icon name="caret-down" size={16} className="text-ink-3" />
					</p>
				</div>
			)}

			{application.status === "saved" && !submitted && !readOnly && (
				<div className="grid gap-3.5">
					<Button
						className="w-full"
						variant="primary"
						disabled={!canSubmit}
						loading={submitting}
						onClick={() => void markApplied()}
					>
						<Trans>Mark as applied</Trans>
					</Button>
					{canSubmit ? (
						<p className="text-xs/4 text-ink-3">
							<Trans>These versions are kept as sent and never change. Your drafts stay editable.</Trans>
							<span className="sr-only">
								<Trans>Records {records.join(" · ")} as sent. You submit on the employer's site yourself.</Trans>
							</span>
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
			{(submitted || readOnly) && (
				<p className="text-xs leading-[17px] text-ink-3">
					{recordedVersion && review.recorded ? (
						<Trans>Review checks recorded at first submission.</Trans>
					) : (
						<Trans>Historical review checks unavailable.</Trans>
					)}
				</p>
			)}
		</aside>
	);
}
