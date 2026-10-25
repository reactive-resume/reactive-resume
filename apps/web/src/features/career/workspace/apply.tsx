import type { Fact } from "../hooks";
import type { WorkspaceTabProps } from "./shell";
import type { CareerWorkspace } from "@reactive-resume/schema/career";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence } from "motion/react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
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
import { cn } from "@reactive-resume/utils/style";
import { latest, useDebouncedSave, useDefaultProvider, useGenerate, useSavedItems, useWorkspace } from "../hooks";
import { CollapseRow, Swap, useCareerTime, withUndo, Working, workingSteps } from "../shared";
import { AiNotice } from "./fit";
import { useInvalidateApplications } from "@/features/applications/use-application-actions";
import { toastError } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

type Answer = CareerWorkspace["answers"][number];
type CountUnit = "words" | "characters";

const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** A fact's chip label: its first few words. The tooltip has the whole fact. */
const shortLabel = (text: string) => {
	const words = text.split(/\s+/).filter(Boolean);
	return words.length > 4 ? `${words.slice(0, 4).join(" ")}…` : text;
};

const checklistItems = () => [
	t`Review the selected resume and cover letter in their editors.`,
	t`Check every claim, date and result against your experience.`,
	t`Review required form answers and remove unsupported claims.`,
	t`Submit through the employer's application page yourself.`,
	t`Mark the application as applied to keep the versions you sent.`,
];

/** W4–W5: the written answers for the employer's form, and a checklist before submitting there yourself. */
export function ApplyTab({ application, version }: WorkspaceTabProps) {
	const { day } = useCareerTime();
	const saved = useSavedItems(application.id);
	const workspace = useWorkspace(application.id);
	const { data: facts } = useQuery(orpc.career.facts.queryOptions({ input: { applicationId: application.id } }));
	const readOnlyVersion = version?.data.kind === "answers" ? version.data : undefined;
	const sentItem = latest(saved.data, "answers");
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

	const saveAnswer = (id: string, patch: Partial<Answer>) =>
		workspace.save({
			answers: workspace.current().answers.map((answer) => (answer.id === id ? { ...answer, ...patch } : answer)),
		});
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
			<div className="grid gap-4">
				{application.status !== "saved" && (
					<p className="flex gap-2.5 rounded-xl bg-accent-soft px-4 py-3 text-[13px] leading-[18px] text-accent-text">
						<Icon name="check-circle" size={18} className="mt-px shrink-0" />
						<span>
							<Trans>
								<strong className="font-semibold">Submitted on {day(application.appliedAt)}.</strong> The versions you
								sent are kept in Saved. Edits here don't change what {application.company} received.
							</Trans>
						</span>
					</p>
				)}

				{stored && !readOnlyVersion && (
					<div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-sunken px-3.5 py-2.5 text-sm">
						<span>
							<Trans>These are the answers saved when you applied.</Trans>
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
										readOnly={stored !== undefined}
										disabled={submitting}
										registerDraft={registerDraft}
										onSave={(patch) => saveAnswer(answer.id, patch)}
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

			<Checklist
				application={application}
				answers={shown}
				currentAnswers={currentAnswers}
				readOnly={!!readOnlyVersion}
				canSubmit={canSubmit}
				submitting={submitting}
				onSubmittingChange={setSubmitting}
			/>
		</div>
	);
}

type AnswerCardProps = {
	answer: Answer;
	facts: Fact[] | undefined;
	applicationId: string;
	readOnly: boolean;
	disabled: boolean;
	registerDraft: (id: string, read: () => Answer) => () => void;
	onSave: (patch: Partial<Answer>) => void;
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
	readOnly,
	disabled,
	registerDraft,
	onSave,
	onRemove,
	unit,
	onToggleUnit,
}: AnswerCardProps) {
	const [text, setText] = useState(answer.answer);
	const [question, setQuestion] = useState(answer.question);
	useLayoutEffect(
		() => registerDraft(answer.id, () => ({ ...answer, question, answer: text })),
		[answer, question, text, registerDraft],
	);
	const [editingQuestion, setEditingQuestion] = useState(answer.question === "");
	// Edit question focuses the field as its menu closes; the menu would otherwise take focus back and end the edit.
	const questionField = useRef<HTMLTextAreaElement>(null);
	const [proposal, setProposal] = useState<{ text: string; factIds: string[] } | null>(null);
	const generate = useGenerate(applicationId);
	const { provider } = useDefaultProvider();
	const flushAnswer = useDebouncedSave(disabled || readOnly ? answer.answer : text, answer.answer, (value) =>
		onSave({ answer: value }),
	);
	const flushQuestion = useDebouncedSave(disabled || readOnly ? answer.question : question, answer.question, (value) =>
		onSave({ question: value }),
	);

	const words = countWords(text);
	const characters = [...text].length;
	const backing = answer.factIds.flatMap((id) => facts?.find((fact) => fact.id === id) ?? []);
	const empty = !text.trim();

	const ask = async () => {
		const result = await generate.run({ task: "answer", question: question.trim(), answer: text }).catch(() => null);
		if (result?.answer) setProposal(result.answer);
	};

	return (
		<section className="grid gap-3 rounded-xl border border-line bg-surface p-4">
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
							<Button
								size="sm"
								variant="secondary"
								disabled={disabled}
								onClick={() => {
									setText(proposal.text);
									onSave({ answer: proposal.text, factIds: proposal.factIds });
									setProposal(null);
								}}
							>
								<Icon name="check" size={16} />
								<Trans>Accept</Trans>
							</Button>
							<Button size="sm" variant="ghost" onClick={() => setProposal(null)}>
								<Trans>Skip</Trans>
							</Button>
						</div>
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

/** "Before you submit": five ticks stored with the application, copy/download, and Mark as applied before submission. */
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
	const submit = useMutation(orpc.career.submitApplication.mutationOptions());
	const items = checklistItems();
	const ticked = workspace.data.checklist;
	const submitted = application.status !== "saved";
	const done = items.filter((_, index) => ticked.includes(index)).length;
	const written = answers.filter((answer) => answer.answer.trim());

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
			await submit.mutateAsync({ applicationId: application.id, answers, expectedAnswers: currentWorkspace.answers });
			queryClient.setQueryData(orpc.career.workspace.queryKey({ input: { applicationId: application.id } }), {
				...currentWorkspace,
				answers,
			});
			// The ticks as they are now, not as they were when the button was pressed.
			const current = queryClient.getQueryData(
				orpc.career.workspace.queryKey({ input: { applicationId: application.id } }),
			)?.checklist;
			workspace.save({ checklist: [...new Set([...(current ?? ticked), items.length - 1])] });
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
		<aside className="grid gap-3.5 rounded-xl border border-line bg-surface p-4">
			<div className="flex items-baseline justify-between gap-3">
				<h2 className="text-sm font-semibold">
					<Trans>Before you submit</Trans>
				</h2>
				<span className="font-mono text-xs font-medium text-ink-2">{t`${done} of ${items.length}`}</span>
			</div>
			<div
				role="progressbar"
				aria-label={t`Checklist progress`}
				aria-valuemin={0}
				aria-valuemax={items.length}
				aria-valuenow={done}
				className="h-1.5 overflow-hidden rounded-sm bg-line"
			>
				<div
					className="h-full rounded-sm bg-accent transition-[width] duration-standard ease-enter"
					style={{ width: `${(done / items.length) * 100}%` }}
				/>
			</div>
			<ul className="grid gap-2.5">
				{items.map((label, index) =>
					!submitted && !readOnly && index === items.length - 1 ? (
						<li key={label}>
							<Button className="w-full" disabled={!canSubmit} loading={submitting} onClick={() => void markApplied()}>
								<Trans>Mark as applied</Trans>
							</Button>
						</li>
					) : (
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
					),
				)}
			</ul>
			{!canSubmit && !readOnly && (
				<p role="alert" className="text-xs text-danger-text">
					<Trans>
						Shorten questions to 2,000 characters and answers to 6,000 characters before marking this applied.
					</Trans>
				</p>
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
			<p className="text-xs leading-[17px] text-ink-3">
				<Trans>You submit on the employer's site yourself. Marking it applied keeps the exact versions you sent.</Trans>
			</p>
		</aside>
	);
}
