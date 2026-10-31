import type { RouterOutput } from "@/libs/orpc/client";
import type { AnswerEvidence } from "@reactive-resume/schema/application-answers";
import type { CareerWorkspace } from "@reactive-resume/schema/career";
import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import {
	answerRelevance,
	answerScopeAllows,
	reviewedAnswerEvidence,
} from "@reactive-resume/schema/application-answers";
import { Button } from "@reactive-resume/ui/components/button";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import { Dialog, DialogContent, DialogTitle } from "@reactive-resume/ui/components/dialog";
import { Input } from "@reactive-resume/ui/components/input";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { toast } from "@reactive-resume/ui/components/toast";
import { downloadWithAnchor } from "@reactive-resume/utils/file";
import { toastError } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

type SavedAnswer = RouterOutput["career"]["answers"]["list"][number];
type Answer = CareerWorkspace["answers"][number];
type AnswerLibraryProps = {
	applicationId: string;
	company: string;
	current?: Answer | undefined;
	disabled: boolean;
	onUse: (answer: Pick<Answer, "question" | "answer" | "factIds">) => void;
};
type Mode = "list" | "save" | "edit" | "reuse" | "delete";
const scopeLabel = (scope: SavedAnswer["scope"]) =>
	scope === "reusable" ? t`All employers` : scope === "employer" ? t`This employer` : t`This application`;

export function AnswerLibrary({ applicationId, company, current, disabled, onUse }: AnswerLibraryProps) {
	const { i18n } = useLingui();
	const fieldId = useId();
	const queryClient = useQueryClient();
	const library = useQuery({ ...orpc.career.answers.list.queryOptions({ input: { applicationId } }), staleTime: 0 });
	const [mode, setMode] = useState<Mode | null>(null);
	const facts = useQuery({ ...orpc.career.facts.queryOptions({ input: { applicationId } }), enabled: mode !== null });
	const stories = useQuery({
		...orpc.career.stories.queryOptions({ input: { applicationId } }),
		enabled: mode !== null,
	});
	const save = useMutation(orpc.career.answers.save.mutationOptions());
	const reuse = useMutation(orpc.career.answers.reuse.mutationOptions());
	const remove = useMutation(orpc.career.answers.delete.mutationOptions());
	const [selected, setSelected] = useState<SavedAnswer | null>(null);
	const [query, setQuery] = useState("");
	const [question, setQuestion] = useState("");
	const [answer, setAnswer] = useState("");
	const [scope, setScope] = useState<SavedAnswer["scope"]>("employer");
	const [source, setSource] = useState<SavedAnswer["source"]>("application");
	const [factIds, setFactIds] = useState<string[]>([]);
	const [storyIds, setStoryIds] = useState<string[]>([]);
	const [reviewEvidence, setReviewEvidence] = useState<AnswerEvidence[]>([]);
	const [reviewed, setReviewed] = useState(false);
	const [noEmployerWording, setNoEmployerWording] = useState(false);
	const busy = save.isPending || reuse.isPending || remove.isPending;
	const change = (action: () => void) => {
		action();
		setReviewed(false);
		setNoEmployerWording(false);
	};
	const open = (next: Mode, row: SavedAnswer | null = null) => {
		setSelected(row);
		setQuestion(row?.question ?? current?.question ?? "");
		setAnswer(row?.answer ?? current?.answer ?? "");
		setFactIds(row?.factIds ?? current?.factIds ?? []);
		setStoryIds(row?.storyIds ?? []);
		setScope(row?.scope ?? "employer");
		setSource(row?.source ?? "application");
		setReviewed(false);
		setNoEmployerWording(false);
		setQuery(current?.question ?? "");
		setMode(next);
	};
	const run = async (action: () => Promise<void>) => {
		try {
			await action();
		} catch (error) {
			toastError(error, t`Couldn't update saved answers. Try again.`, { allowServerMessage: true });
		}
	};
	const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.career.answers.list.key() });
	const submit = () =>
		run(async () => {
			if (mode === "reuse" && selected) {
				const result = await reuse.mutateAsync({
					id: selected.id,
					expectedRevision: selected.revision,
					applicationId,
					answer,
					reviewed: true,
				});
				onUse({ question: current?.question || selected.question, answer: result.text, factIds: result.factIds });
			} else {
				await save.mutateAsync({
					...(mode === "edit" && selected ? { id: selected.id, expectedRevision: selected.revision } : {}),
					applicationId,
					question,
					answer,
					scope,
					source,
					factIds,
					storyIds,
					expectedEvidence: reviewEvidence,
					reviewed: true,
					noEmployerWording,
				});
				await refresh();
				toast.add({ description: t`Reviewed answer saved` });
			}
			setMode(null);
		});
	const availableFacts = (facts.data ?? []).filter(
		(fact) => fact.status === "active" && (scope === "application" || fact.applicationId === null),
	);
	const availableStories = (stories.data ?? []).filter(
		(story) =>
			(scope === "application" || story.applicationId === null) &&
			story.data.factIds.every((id) => availableFacts.some((fact) => fact.id === id)),
	);
	const missingFacts = factIds.filter((id) => !availableFacts.some((fact) => fact.id === id));
	const missingStories = storyIds.filter((id) => !availableStories.some((story) => story.id === id));
	const rows = (library.data ?? [])
		.map((row) => ({
			row,
			score: Math.max(
				answerRelevance(row.question, query),
				query && row.answer.toLocaleLowerCase().includes(query.toLocaleLowerCase()) ? 1 : 0,
			),
		}))
		.filter(({ score }) => score > 0)
		.sort((a, b) => b.score - a.score);
	const relevant = current?.question
		? (library.data?.filter((row) => row.canReuse && answerRelevance(row.question, current.question) >= 0.3).length ??
			0)
		: 0;
	const confirmReview = (checked: boolean) => {
		setReviewEvidence(reviewedAnswerEvidence(facts.data ?? [], stories.data ?? [], factIds, storyIds));
		setReviewed(checked);
	};
	const toggle = (ids: string[], id: string) => (ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]);
	const title =
		mode === "list"
			? t`Use a saved answer`
			: mode === "reuse"
				? t`Review for this application`
				: mode === "delete"
					? t`Delete saved answer`
					: t`Save for other applications`;

	return (
		<>
			<div className="flex flex-wrap gap-2">
				{current && (
					<Button
						size="sm"
						variant="ghost"
						disabled={disabled || !current.question.trim() || !current.answer.trim()}
						onClick={() => open("save")}
					>
						<Trans>Save for other applications</Trans>
					</Button>
				)}
				<Button size="sm" variant="secondary" disabled={disabled} onClick={() => open("list")}>
					<Trans>Use a saved answer</Trans>
				</Button>
				{relevant > 0 && (
					<span className="self-center text-xs text-ink-2">
						{plural(relevant, { one: "# relevant reviewed answer", other: "# relevant reviewed answers" })}
					</span>
				)}
			</div>
			<Dialog
				open={mode !== null}
				onOpenChange={(value) => {
					if (!value && !busy) setMode(null);
				}}
			>
				<DialogContent aria-labelledby={`${fieldId}-title`} closeLabel={t`Close`} className="sm:max-w-xl">
					<DialogTitle id={`${fieldId}-title`}>{title}</DialogTitle>
					<p>{t`Current employer: ${company}`}</p>
					{mode === "list" ? (
						<div className="grid gap-4">
							<Input
								aria-label={t`Search saved answers`}
								placeholder={t`Search saved answers`}
								value={query}
								onChange={(event) => setQuery(event.target.value)}
							/>
							<Button
								variant="ghost"
								size="sm"
								disabled={!library.data?.length}
								onClick={() =>
									downloadWithAnchor(
										new Blob([JSON.stringify(library.data, null, 2)], { type: "application/json" }),
										"reviewed-answers.json",
									)
								}
							>
								<Trans>Export saved answers</Trans>
							</Button>
							{library.isPending && (
								<p role="status">
									<Trans>Loading saved answers…</Trans>
								</p>
							)}
							{library.isError && (
								<Button onClick={() => void library.refetch()}>
									<Trans>Retry</Trans>
								</Button>
							)}
							{!library.isPending && rows.length === 0 && (
								<p>
									<Trans>No matching saved answers. Clear the search to see all answers.</Trans>
								</p>
							)}
							{rows.map(({ row }) => (
								<section key={row.id} className="grid gap-2 rounded-lg border border-line p-3">
									<h3 className="font-semibold">{row.question}</h3>
									<p className="whitespace-pre-wrap">{row.answer}</p>
									<p className="text-xs text-ink-2">
										{scopeLabel(row.scope)} · {row.employer} · {t`Last reviewed`}:{" "}
										{i18n.date(row.reviewedAt, { dateStyle: "medium", timeStyle: "short" })}
									</p>
									{row.stale ? (
										<p role="status" className="text-danger-text">
											<Trans>Evidence changed or was removed. Edit and review before reuse.</Trans>
										</p>
									) : (
										row.evidence.length > 0 &&
										!library.isFetching && (
											<p className="text-xs">
												<Trans>Linked evidence unchanged since review</Trans>
											</p>
										)
									)}
									{!answerScopeAllows(row, { id: applicationId, company }) && (
										<p>
											<Trans>Restricted to its employer or application.</Trans>
										</p>
									)}
									<div className="flex flex-wrap gap-2">
										<Button size="sm" disabled={!row.canReuse || library.isFetching} onClick={() => open("reuse", row)}>
											<Trans>Review and use</Trans>
										</Button>
										<Button
											size="sm"
											variant="secondary"
											disabled={!answerScopeAllows(row, { id: applicationId, company }) || library.isFetching}
											onClick={() => open("edit", row)}
										>
											<Trans>Edit saved answer</Trans>
										</Button>
										<Button
											size="sm"
											variant="ghost"
											onClick={() =>
												void run(async () => {
													await navigator.clipboard.writeText(row.answer);
													toast.add({ description: t`Answer copied` });
												})
											}
										>
											<Trans>Copy</Trans>
										</Button>
										<Button size="sm" variant="ghost" onClick={() => open("delete", row)}>
											<Trans>Delete</Trans>
										</Button>
									</div>
								</section>
							))}
						</div>
					) : mode === "delete" ? (
						<>
							<p>
								<Trans>Delete this library answer? Application drafts and submitted copies are kept.</Trans>
							</p>
							<Button
								loading={busy}
								onClick={() =>
									void run(async () => {
										if (!selected) return;
										await remove.mutateAsync({ id: selected.id, expectedRevision: selected.revision });
										await refresh();
										setMode("list");
									})
								}
							>
								<Trans>Delete saved answer</Trans>
							</Button>
						</>
					) : (
						<fieldset disabled={busy} className="grid gap-3">
							<p className="text-sm text-ink-2">
								<Trans>
									Review wording, employer context and every claim. Saving does not confirm Knowledge facts or send data
									to AI.
								</Trans>
							</p>
							{selected && (
								<p>
									{t`Source employer`}: {selected.employer}
								</p>
							)}
							{mode !== "reuse" ? (
								<label htmlFor={`${fieldId}-question`} className="grid gap-1">
									<Trans>Question</Trans>
									<Textarea
										id={`${fieldId}-question`}
										value={question}
										maxLength={2000}
										onChange={(event) => change(() => setQuestion(event.target.value))}
									/>
								</label>
							) : (
								<h3>{current?.question || question}</h3>
							)}
							<label htmlFor={`${fieldId}-answer`} className="grid gap-1">
								<Trans>Answer</Trans>
								<Textarea
									id={`${fieldId}-answer`}
									value={answer}
									maxLength={6000}
									onChange={(event) => change(() => setAnswer(event.target.value))}
								/>
							</label>
							<p className="text-xs">{t`${answer.split(/\s+/).filter(Boolean).length} words · ${[...answer].length} characters`}</p>
							{mode === "reuse" && (
								<div className="grid gap-2 text-sm text-ink-2">
									{(facts.data ?? [])
										.filter((fact) => selected?.evidence.some((ref) => ref.kind === "fact" && ref.id === fact.id))
										.map((fact) => (
											<p key={fact.id}>{fact.text}</p>
										))}
									{(stories.data ?? [])
										.filter((story) => selected?.storyIds.includes(story.id))
										.map((story) => (
											<p key={story.id}>
												{[
													story.data.title,
													story.data.situation,
													story.data.task,
													story.data.action,
													story.data.result,
													story.data.reflection,
												]
													.filter(Boolean)
													.join("\n")}
											</p>
										))}
								</div>
							)}
							{mode !== "reuse" && (
								<>
									<label htmlFor={`${fieldId}-scope`} className="grid gap-1">
										<Trans>Reuse scope</Trans>
										<NativeSelect
											id={`${fieldId}-scope`}
											value={scope}
											onChange={(event) => change(() => setScope(event.target.value as SavedAnswer["scope"]))}
										>
											{(["application", "employer", "reusable"] as const).map((value) => (
												<option key={value} value={value}>
													{scopeLabel(value)}
												</option>
											))}
										</NativeSelect>
									</label>
									<label htmlFor={`${fieldId}-source`} className="grid gap-1">
										<Trans>Answer source</Trans>
										<NativeSelect
											id={`${fieldId}-source`}
											value={source}
											onChange={(event) => change(() => setSource(event.target.value as SavedAnswer["source"]))}
										>
											<option value="manual">{t`Written manually`}</option>
											<option value="application">{t`Application answer`}</option>
											<option value="ai-assisted">{t`AI-assisted draft`}</option>
										</NativeSelect>
									</label>
									<p>
										<Trans>Supporting Knowledge facts and stories</Trans>
									</p>
									{availableFacts.map((fact) => (
										<label key={fact.id} htmlFor={`${fieldId}-fact-${fact.id}`} className="flex gap-2">
											<Checkbox
												id={`${fieldId}-fact-${fact.id}`}
												checked={factIds.includes(fact.id)}
												onCheckedChange={() => change(() => setFactIds(toggle(factIds, fact.id)))}
											/>
											{fact.text}
										</label>
									))}
									{availableStories.map((story) => (
										<label key={story.id} htmlFor={`${fieldId}-story-${story.id}`} className="flex gap-2">
											<Checkbox
												id={`${fieldId}-story-${story.id}`}
												checked={storyIds.includes(story.id)}
												onCheckedChange={() => change(() => setStoryIds(toggle(storyIds, story.id)))}
											/>
											{story.data.title}
											<span className="text-xs whitespace-pre-wrap">
												{[
													story.data.situation,
													story.data.task,
													story.data.action,
													story.data.result,
													story.data.reflection,
												]
													.filter(Boolean)
													.join("\n")}
											</span>
										</label>
									))}
									{missingFacts.map((id) => (
										<Button
											key={id}
											variant="secondary"
											onClick={() => change(() => setFactIds(factIds.filter((value) => value !== id)))}
										>{t`Remove unavailable fact reference`}</Button>
									))}
									{missingStories.map((id) => (
										<Button
											key={id}
											variant="secondary"
											onClick={() => change(() => setStoryIds(storyIds.filter((value) => value !== id)))}
										>{t`Remove unavailable story reference`}</Button>
									))}
									{scope === "reusable" && (
										<label htmlFor={`${fieldId}-employer`} className="flex gap-2">
											<Checkbox
												id={`${fieldId}-employer`}
												checked={noEmployerWording}
												onCheckedChange={setNoEmployerWording}
											/>
											<Trans>I removed employer-specific wording and reviewed reuse across employers.</Trans>
										</label>
									)}
								</>
							)}
							<label htmlFor={`${fieldId}-review`} className="flex gap-2">
								<Checkbox id={`${fieldId}-review`} checked={reviewed} onCheckedChange={confirmReview} />
								<Trans>I reviewed this answer, its evidence and the application context.</Trans>
							</label>
							<Button
								loading={busy}
								disabled={
									!reviewed ||
									!answer.trim() ||
									!question.trim() ||
									(mode !== "reuse" &&
										(facts.isPending ||
											stories.isPending ||
											facts.isError ||
											stories.isError ||
											missingFacts.length > 0 ||
											missingStories.length > 0 ||
											(scope === "reusable" && !noEmployerWording)))
								}
								onClick={() => void submit()}
							>
								{mode === "reuse" ? t`Use reviewed answer` : t`Save reviewed answer`}
							</Button>
						</fieldset>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
}
