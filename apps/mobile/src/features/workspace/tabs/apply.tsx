// Apply (web workspace/apply.tsx, W4–W5): the written answers for the employer's form, Draft/Tighten, and the
// checklist before submitting there yourself.
import type { Fact } from "../hooks";
import type { WorkspaceTabProps } from "../shell";
import type { SaveResult } from "../state";
import type { CareerWorkspace } from "@reactive-resume/schema/career";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { randomUUID } from "expo-crypto";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { hasApplicationSubmission } from "@reactive-resume/schema/applications/data";
import { careerWorkspaceSchema } from "@reactive-resume/schema/career";
import {
	clearDraft,
	latest,
	useAutosave,
	useDraft,
	useFacts,
	useGenerate,
	useSavedItems,
	useWorkspace,
	workspaceError,
} from "../hooks";
import { answersClipboard, answersDocument, countCharacters, countWords, diffWords, shortLabel } from "../logic";
import { Actions, AiNotice, Block, CheckRow, Progress, SaveError, useWorking, workingSteps } from "../parts";
import { Preparation } from "../preparation";
import { shareText } from "../share";
import { WorkspaceScreen } from "../shell";
import { dispatchForOrigin } from "../state";
import { orpc } from "@/api/client";
import { getDraftScope } from "@/draft";
import { useHasAIProvider } from "@/features/ai/providers";
import { useUserTime } from "@/features/application-detail/hooks";
import { WhatYouSent } from "@/features/application-detail/sections";
import { PriorNoResponse } from "@/features/applications/prior-no-response";
import { useInvalidateApplications } from "@/features/applications/queries";
import { withUndo } from "@/features/career/undo";
import { Banner, Button, Chip, IconButton, ListRow, Sheet, Skeleton, Text, TextArea, showToast, useTheme } from "@/ui";

type Answer = CareerWorkspace["answers"][number];
type CountUnit = "words" | "characters";

export function ApplyTab() {
	return <WorkspaceScreen tab="apply">{(props) => <Apply {...props} />}</WorkspaceScreen>;
}

function Apply({ application, version, go }: WorkspaceTabProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const { day } = useUserTime();
	const saved = useSavedItems(application.id);
	const workspace = useWorkspace(application.id);
	const facts = useFacts(application.id);
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

	if (workspace.isPending || saved.isPending) return <Skeleton height={space.s12 * 5} />;

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
		const origin = getDraftScope();
		withUndo({
			message: t`Question removed`,
			// `save` reports its own failure; rejecting here shows the question again.
			commit: () =>
				// Dropped if another account is signed in when the Undo window ends.
				dispatchForOrigin(origin, getDraftScope, async () => {
					const result = await workspace.save({
						answers: workspace.current().answers.filter((answer) => answer.id !== id),
					});
					if (!result.ok) throw new Error("Not removed");
				}),
			restore: () => setRemoved((ids) => ids.filter((item) => item !== id)),
			failed: () => undefined,
		});
	};
	const appliedOn = day(application.appliedAt);

	return (
		<View style={{ gap: space.s4 }}>
			{!version ? <Preparation application={application} disabled={submitting} /> : null}
			{!version && hasApplicationSubmission(application) ? (
				<>
					<WhatYouSent application={application} />
					{recorded ? (
						<Button
							variant="secondary"
							label={t`View recorded answers`}
							onPress={() => go("apply", { version: recorded.id })}
						/>
					) : (
						<Text color="ink2">{t`No recorded answers are available.`}</Text>
					)}
				</>
			) : null}
			{hasApplicationSubmission(application) ? (
				<Banner
					tone="info"
					icon="check-circle"
					title={t`Submission recorded on ${appliedOn}.`}
					message={t`Saved versions stay separate from later drafts. This record does not confirm employer receipt.`}
				/>
			) : null}

			{stored && !readOnlyVersion ? (
				<Banner
					tone="info"
					message={recorded ? t`These are the answers saved when you applied.` : t`These are saved draft answers.`}
					action={{
						label: t`Use these answers`,
						onPress: () =>
							workspace.save({
								answers: stored.answers.map((answer) => ({ ...answer, id: randomUUID(), factIds: [] })),
							}),
					}}
				/>
			) : null}

			<Text variant="heading" accessibilityRole="header">{t`Form answers`}</Text>
			{shown.map((answer) => (
				<AnswerCard
					key={stored ? `${version?.id ?? sentItem?.id}:${answer.id}` : answer.id}
					answer={answer}
					facts={facts.data}
					applicationId={application.id}
					readOnly={stored !== undefined}
					disabled={submitting}
					registerDraft={registerDraft}
					onSave={(patch) => saveAnswer(answer.id, patch)}
					fetchServer={() =>
						workspace.fetchConfirmed().then((data) => data.answers.find((item) => item.id === answer.id))
					}
					onRemove={() => removeAnswer(answer.id)}
					unit={unit}
					onToggleUnit={() => setUnit(unit === "words" ? "characters" : "words")}
				/>
			))}

			{!stored ? (
				<View style={{ gap: space.s2 }}>
					{shown.length > 0 ? <AiNotice /> : null}
					<Button
						variant="secondary"
						fullWidth
						icon="plus"
						label={t`Add a question from the form`}
						disabled={submitting || live.length >= 30}
						onPress={() =>
							workspace.save({
								answers: [...workspace.current().answers, { id: randomUUID(), question: "", answer: "", factIds: [] }],
							})
						}
					/>
					{live.length >= 30 ? (
						<Text variant="callout" color="ink3">
							{t`You can keep up to 30 application questions.`}
						</Text>
					) : null}
				</View>
			) : null}

			<Checklist
				application={application}
				answers={shown}
				currentAnswers={currentAnswers}
				readOnly={!!readOnlyVersion}
				canSubmit={canSubmit}
				submitting={submitting}
				onSubmittingChange={setSubmitting}
			/>
		</View>
	);
}

type AnswerCardProps = {
	answer: Answer;
	facts: Fact[] | undefined;
	applicationId: string;
	readOnly: boolean;
	disabled: boolean;
	registerDraft: (id: string, read: () => Answer) => () => void;
	/** Resolves once the server confirmed it, or with why it failed. */
	onSave: (patch: Partial<Answer>) => Promise<SaveResult>;
	/** This answer in a freshly fetched, server-confirmed workspace (undefined when it was removed there). */
	fetchServer: () => Promise<Answer | undefined>;
	onRemove: () => void;
	unit: CountUnit;
	onToggleUnit: () => void;
};

/** One form question: autosaving answer, its length in words or characters, backing facts, and Draft/Tighten. */
function AnswerCard({
	answer,
	facts,
	applicationId,
	readOnly,
	disabled,
	registerDraft,
	onSave,
	fetchServer,
	onRemove,
	unit,
	onToggleUnit,
}: AnswerCardProps) {
	const { t } = useLingui();
	const { colors, radius, space } = useTheme();
	// Typed text stays on the device until the server has it, so a failed save survives leaving the tab.
	const draftName = readOnly ? null : `answer:${applicationId}:${answer.id}`;
	const answerDraft = useDraft(draftName && `${draftName}:answer`, answer.answer);
	const questionDraft = useDraft(draftName && `${draftName}:question`, answer.question);
	const text = answerDraft.value;
	const question = questionDraft.value;
	const setText = answerDraft.setValue;
	const setQuestion = questionDraft.setValue;
	useLayoutEffect(
		() => registerDraft(answer.id, () => ({ ...answer, question, answer: text })),
		[answer, question, text, registerDraft],
	);
	const [editingQuestion, setEditingQuestion] = useState(answer.question === "");
	const [menu, setMenu] = useState(false);
	const [proposal, setProposal] = useState<{ text: string; factIds: string[] } | null>(null);
	const generate = useGenerate(applicationId);
	const provider = useHasAIProvider().defaultProvider;
	const answerSave = useAutosave(
		disabled || readOnly ? answer.answer : text,
		answer.answer,
		(value) => onSave({ answer: value }),
		answerDraft,
		() => fetchServer().then((server) => server?.answer ?? ""),
	);
	const questionSave = useAutosave(
		disabled || readOnly ? answer.question : question,
		answer.question,
		(value) => onSave({ question: value }),
		questionDraft,
		() => fetchServer().then((server) => server?.question ?? ""),
	);
	const empty = !text.trim();
	const aiLabel = useWorking(
		generate.isPending,
		workingSteps(empty ? "answer" : "tighten"),
		empty ? t`Draft` : t`Tighten`,
	);

	const words = countWords(text);
	const characters = countCharacters(text);
	const backing = answer.factIds.flatMap((id) => facts?.find((fact) => fact.id === id) ?? []);

	const ask = async () => {
		const result = await generate.run({ task: "answer", question: question.trim(), answer: text }).catch(() => null);
		if (result?.answer) setProposal(result.answer);
	};

	return (
		<Block
			title={editingQuestion && !readOnly ? undefined : question}
			trailing={
				<>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel={unit === "words" ? t`Count characters` : t`Count words`}
						onPress={onToggleUnit}
						hitSlop={8}
					>
						<Text variant="mono" color="ink2">
							{unit === "words"
								? plural(words, { one: "# word", other: "# words" })
								: plural(characters, { one: "# character", other: "# characters" })}
						</Text>
					</Pressable>
					{!readOnly ? (
						<IconButton
							icon="dots-three"
							label={t`Question options`}
							disabled={disabled}
							onPress={() => setMenu(true)}
						/>
					) : null}
				</>
			}
		>
			{editingQuestion && !readOnly ? (
				<TextArea
					label={t`Question from the form`}
					value={question}
					minLines={1}
					maxLength={2000}
					autoFocus
					editable={!disabled}
					placeholder={t`Paste the question from the form`}
					onChangeText={setQuestion}
					onBlur={() => {
						questionSave.flush();
						if (question.trim()) setEditingQuestion(false);
					}}
				/>
			) : null}

			{proposal ? (
				<View style={{ gap: space.s2 }}>
					<Text
						style={{
							padding: space.s3,
							borderRadius: radius.rMd,
							borderWidth: 1,
							borderColor: colors.line2,
							backgroundColor: colors.raised,
						}}
					>
						{diffWords(text, proposal.text).map((part, index) => (
							<Text
								key={index}
								color={part.type === "removed" ? "ink3" : part.type === "added" ? "accentText" : "ink"}
								style={
									part.type === "removed"
										? { textDecorationLine: "line-through" }
										: part.type === "added"
											? { backgroundColor: colors.accentSoft }
											: null
								}
							>
								{part.text}{" "}
							</Text>
						))}
					</Text>
					<Actions>
						<Button
							variant="secondary"
							size="sm"
							icon="check"
							label={t`Accept`}
							disabled={disabled}
							onPress={() => {
								const accepted = proposal.text;
								setText(accepted);
								void onSave({ answer: accepted, factIds: proposal.factIds }).then(
									(result) => result.ok && answerDraft.clear(accepted),
								);
								setProposal(null);
							}}
						/>
						<Button variant="ghost" size="sm" label={t`Skip`} onPress={() => setProposal(null)} />
					</Actions>
				</View>
			) : readOnly ? (
				<Text color="ink2">{text}</Text>
			) : (
				<TextArea
					label={question || t`Answer`}
					value={text}
					maxLength={6000}
					editable={!disabled}
					helper={t`Write your answer, or draft one from your Knowledge.`}
					onChangeText={setText}
					onBlur={answerSave.flush}
				/>
			)}
			<SaveError autosave={questionSave} />
			<SaveError autosave={answerSave} />

			{backing.length > 0 ? (
				<View style={{ gap: space.s1 }}>
					<Text variant="caption" color="ink3">
						{t`Backed by`}
					</Text>
					<Actions>
						{backing.map((fact) => (
							<Chip key={fact.id} label={shortLabel(fact.text)} onPress={() => showToast({ message: fact.text })} />
						))}
					</Actions>
				</View>
			) : null}
			{!readOnly && !proposal && provider ? (
				<Button
					variant="ghost"
					size="sm"
					icon="sparkle"
					label={aiLabel}
					loading={generate.isPending}
					disabled={disabled || !question.trim()}
					onPress={() => void ask()}
				/>
			) : null}

			<Sheet open={menu} onClose={() => setMenu(false)} title={t`Question options`}>
				<ListRow
					title={t`Edit question`}
					leading="pencil-simple"
					onPress={() => {
						setMenu(false);
						setEditingQuestion(true);
					}}
				/>
				<ListRow
					title={t`Remove question`}
					leading="trash"
					destructive
					onPress={() => {
						setMenu(false);
						onRemove();
					}}
				/>
			</Sheet>
		</Block>
	);
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
	const { t } = useLingui();
	const { space } = useTheme();
	const queryClient = useQueryClient();
	const invalidate = useInvalidateApplications();
	const workspace = useWorkspace(application.id);
	const submit = useMutation(orpc.career.submitApplication.mutationOptions());
	const [download, setDownload] = useState(false);
	const submitted = hasApplicationSubmission(application);
	const items = [
		t`Review the selected resume and cover letter in their editors.`,
		t`Check every claim, date and result against your experience.`,
		t`Review required form answers and remove unsupported claims.`,
		t`Submit through the employer's application page yourself.`,
		t`Mark the application as applied to keep the versions you sent.`,
	].slice(0, submitted ? 3 : undefined);
	const ticked = workspace.data.checklist;
	const done = items.filter((_, index) => ticked.includes(index)).length;
	const written = answers.filter((answer) => answer.answer.trim());
	const total = items.length;
	const title = `${application.role} · ${application.company}`;

	const toggle = (index: number, on: boolean) => {
		const current = workspace.current().checklist;
		workspace.save({ checklist: on ? [...new Set([...current, index])] : current.filter((item) => item !== index) });
	};

	const copy = async () => {
		await Clipboard.setStringAsync(answersClipboard(currentAnswers()));
		showToast({ message: t`Answers copied` });
	};

	const share = async (format: "md" | "txt") => {
		setDownload(false);
		try {
			await shareText(
				`${application.company} answers.${format}`,
				answersDocument(title, currentAnswers(), format),
				format === "md" ? "text/markdown" : "text/plain",
				format === "md" ? "net.daringfireball.markdown" : "public.plain-text",
			);
		} catch {
			showToast({ message: t`Couldn't share the answers. Try again.` });
		}
	};

	const markApplied = async () => {
		if (readOnly || submitting) return;
		const answersNow = currentAnswers();
		if (!careerWorkspaceSchema.shape.answers.safeParse(answersNow).success) return;
		onSubmittingChange(true);
		try {
			const currentWorkspace = await workspace.settled();
			await submit.mutateAsync({
				applicationId: application.id,
				answers: answersNow,
				expectedAnswers: currentWorkspace.answers,
				expectedDocuments: { resumeId: application.resumeId, coverLetterId: application.coverLetterId },
			});
			queryClient.setQueryData(workspace.queryKey, { ...currentWorkspace, answers: answersNow });
			// The server confirmed these exact texts, so their device drafts can go (newer edits stay).
			for (const answer of answersNow) {
				clearDraft(`answer:${application.id}:${answer.id}:answer`, answer.answer);
				clearDraft(`answer:${application.id}:${answer.id}:question`, answer.question);
			}
			showToast({ message: t`Marked as applied. The versions you sent are kept.` });
		} catch (error) {
			showToast({ message: workspaceError(error, t`Couldn't mark it as applied. Try again.`) });
		} finally {
			onSubmittingChange(false);
			void invalidate();
			void queryClient.invalidateQueries({ queryKey: orpc.career.savedItems.key() });
		}
	};

	return (
		<Block
			title={submitted ? t`Content review` : t`Before you submit`}
			trailing={<Text variant="mono" color="ink2">{t`${done} of ${total}`}</Text>}
		>
			{!submitted && !readOnly ? <PriorNoResponse company={application.company} excludeId={application.id} /> : null}
			<Progress value={done / total} label={t`Checklist progress`} />
			<View>
				{items.map((label, index) =>
					application.status === "saved" && !readOnly && index === items.length - 1 ? (
						<View key={label} style={{ paddingTop: space.s2 }}>
							<Button
								fullWidth
								label={t`Mark as applied`}
								disabled={!canSubmit}
								loading={submitting}
								onPress={() => void markApplied()}
							/>
						</View>
					) : (
						<CheckRow
							key={label}
							label={label}
							checked={ticked.includes(index)}
							disabled={readOnly || submitting}
							onChange={(on) => toggle(index, on)}
						/>
					),
				)}
			</View>
			{!submitted && !canSubmit && !readOnly ? (
				<Text variant="callout" color="dangerText" accessibilityRole="alert">
					{t`Shorten questions to 2,000 characters and answers to 6,000 characters before marking this applied.`}
				</Text>
			) : null}
			<Actions>
				<Button
					variant="secondary"
					size="sm"
					icon="copy"
					label={t`Copy answers`}
					disabled={written.length === 0}
					onPress={() => void copy()}
				/>
				<Button
					variant="ghost"
					size="sm"
					icon="download-simple"
					label={t`Download`}
					disabled={written.length === 0}
					onPress={() => setDownload(true)}
				/>
			</Actions>
			<Text variant="caption" color="ink3">
				{submitted
					? t`Submission is recorded. Review checks only reflect what you checked yourself.`
					: t`You submit on the employer's site yourself. Marking it applied keeps the exact versions you sent.`}
			</Text>
			<Sheet open={download} onClose={() => setDownload(false)} title={t`Download`}>
				<ListRow title={t`Markdown (.md)`} leading="file-text" onPress={() => void share("md")} />
				<ListRow title={t`Plain text (.txt)`} leading="file-text" onPress={() => void share("txt")} />
			</Sheet>
		</Block>
	);
}
