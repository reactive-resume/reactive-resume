import type { RouterOutput } from "@/api/client";
import type { AnswerEvidence } from "@reactive-resume/schema/application-answers";
import type { CareerWorkspace } from "@reactive-resume/schema/career";
import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { View } from "react-native";
import {
	answerRelevance,
	answerScopeAllows,
	reviewedAnswerEvidence,
} from "@reactive-resume/schema/application-answers";
import { workspaceError } from "./hooks";
import { Actions, CheckRow } from "./parts";
import { shareText } from "./share";
import { orpc } from "@/api/client";
import { Banner, Button, SelectSheet, Sheet, Text, TextArea, TextField, showToast, useTheme } from "@/ui";

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
	const queryClient = useQueryClient();
	const { space } = useTheme();
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
		if (busy) return;
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
			showToast({ message: workspaceError(error, t`Couldn't update saved answers. Try again.`) });
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
				showToast({ message: t`Reviewed answer saved` });
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
			<Actions>
				{current ? (
					<Button
						size="sm"
						variant="ghost"
						label={t`Save for other applications`}
						disabled={disabled || !current.question.trim() || !current.answer.trim()}
						onPress={() => open("save")}
					/>
				) : null}
				<Button
					size="sm"
					variant="secondary"
					label={t`Use a saved answer`}
					disabled={disabled}
					onPress={() => open("list")}
				/>
			</Actions>
			{relevant > 0 ? (
				<Text variant="caption">
					{plural(relevant, { one: "# relevant reviewed answer", other: "# relevant reviewed answers" })}
				</Text>
			) : null}
			<Sheet
				open={mode !== null}
				onClose={() => {
					if (!busy) setMode(null);
				}}
				dismissible={!busy}
				title={title}
			>
				<Text>{t`Current employer: ${company}`}</Text>
				{mode === "list" ? (
					<View style={{ gap: space.s4 }}>
						<TextField label={t`Search saved answers`} value={query} onChangeText={setQuery} />
						<Button
							variant="ghost"
							size="sm"
							label={t`Export saved answers`}
							disabled={!library.data?.length}
							onPress={() =>
								void run(async () => {
									await shareText(
										"reviewed-answers.json",
										JSON.stringify(library.data, null, 2),
										"application/json",
										"public.json",
									);
								})
							}
						/>
						{library.isPending ? <Text accessibilityRole="alert">{t`Loading saved answers…`}</Text> : null}
						{library.isError ? <Button label={t`Retry`} onPress={() => void library.refetch()} /> : null}
						{!library.isPending && rows.length === 0 ? (
							<Text>{t`No matching saved answers. Clear the search to see all answers.`}</Text>
						) : null}
						{rows.map(({ row }) => (
							<View key={row.id} style={{ gap: space.s2 }}>
								<Text variant="heading" accessibilityRole="header">
									{row.question}
								</Text>
								<Text>{row.answer}</Text>
								<Text variant="caption" color="ink2">
									{scopeLabel(row.scope)} · {row.employer} · {t`Last reviewed`}:{" "}
									{i18n.date(row.reviewedAt, { dateStyle: "medium", timeStyle: "short" })}
								</Text>
								{row.stale ? (
									<Banner tone="info" message={t`Evidence changed or was removed. Edit and review before reuse.`} />
								) : row.evidence.length > 0 && !library.isFetching ? (
									<Text variant="caption">{t`Linked evidence unchanged since review`}</Text>
								) : null}
								{!answerScopeAllows(row, { id: applicationId, company }) ? (
									<Text>{t`Restricted to its employer or application.`}</Text>
								) : null}
								<Actions>
									<Button
										size="sm"
										label={t`Review and use`}
										disabled={!row.canReuse || library.isFetching}
										onPress={() => open("reuse", row)}
									/>
									<Button
										size="sm"
										variant="secondary"
										label={t`Edit saved answer`}
										disabled={!answerScopeAllows(row, { id: applicationId, company }) || library.isFetching}
										onPress={() => open("edit", row)}
									/>
									<Button
										size="sm"
										variant="ghost"
										label={t`Copy`}
										onPress={() =>
											void run(async () => {
												await Clipboard.setStringAsync(row.answer);
												showToast({ message: t`Answer copied` });
											})
										}
									/>
									<Button size="sm" variant="ghost" label={t`Delete`} onPress={() => open("delete", row)} />
								</Actions>
							</View>
						))}
					</View>
				) : mode === "delete" ? (
					<View style={{ gap: space.s3 }}>
						<Text>{t`Delete this library answer? Application drafts and submitted copies are kept.`}</Text>
						<Button
							loading={busy}
							label={t`Delete saved answer`}
							onPress={() =>
								void run(async () => {
									if (!selected) return;
									await remove.mutateAsync({ id: selected.id, expectedRevision: selected.revision });
									await refresh();
									setMode("list");
								})
							}
						/>
					</View>
				) : (
					<View style={{ gap: space.s3 }}>
						<Text color="ink2">{t`Review wording, employer context and every claim. Saving does not confirm Knowledge facts or send data to AI.`}</Text>
						{selected ? (
							<Text>
								{t`Source employer`}: {selected.employer}
							</Text>
						) : null}
						{mode !== "reuse" ? (
							<TextArea
								label={t`Question`}
								editable={!busy}
								value={question}
								maxLength={2000}
								onChangeText={(value) => change(() => setQuestion(value))}
							/>
						) : (
							<Text variant="heading">{current?.question || question}</Text>
						)}
						<TextArea
							label={t`Answer`}
							editable={!busy}
							value={answer}
							maxLength={6000}
							onChangeText={(value) => change(() => setAnswer(value))}
						/>
						<Text variant="caption">{t`${answer.split(/\s+/).filter(Boolean).length} words · ${[...answer].length} characters`}</Text>
						{mode === "reuse" ? (
							<View style={{ gap: space.s2 }}>
								{(facts.data ?? [])
									.filter((fact) => selected?.evidence.some((ref) => ref.kind === "fact" && ref.id === fact.id))
									.map((fact) => (
										<Text key={fact.id}>{fact.text}</Text>
									))}
								{(stories.data ?? [])
									.filter((story) => selected?.storyIds.includes(story.id))
									.map((story) => (
										<Text key={story.id}>
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
										</Text>
									))}
							</View>
						) : null}
						{mode !== "reuse" ? (
							<>
								<SelectSheet
									label={t`Reuse scope`}
									disabled={busy}
									value={scope}
									options={(["application", "employer", "reusable"] as const).map((value) => ({
										value,
										label: scopeLabel(value),
									}))}
									onChange={(value) => change(() => setScope(value))}
								/>
								<SelectSheet
									label={t`Answer source`}
									disabled={busy}
									value={source}
									options={[
										{ value: "manual", label: t`Written manually` },
										{ value: "application", label: t`Application answer` },
										{ value: "ai-assisted", label: t`AI-assisted draft` },
									]}
									onChange={(value) => change(() => setSource(value))}
								/>
								<Text variant="heading">{t`Supporting Knowledge facts and stories`}</Text>
								{availableFacts.map((fact) => (
									<CheckRow
										key={fact.id}
										label={fact.text}
										checked={factIds.includes(fact.id)}
										onChange={() => change(() => setFactIds(toggle(factIds, fact.id)))}
									/>
								))}
								{availableStories.map((story) => (
									<View key={story.id}>
										<CheckRow
											label={story.data.title}
											checked={storyIds.includes(story.id)}
											onChange={() => change(() => setStoryIds(toggle(storyIds, story.id)))}
										/>
										<Text color="ink2">
											{[
												story.data.situation,
												story.data.task,
												story.data.action,
												story.data.result,
												story.data.reflection,
											]
												.filter(Boolean)
												.join("\n")}
										</Text>
									</View>
								))}
								{missingFacts.map((id) => (
									<Button
										key={id}
										variant="secondary"
										label={t`Remove unavailable fact reference`}
										onPress={() => change(() => setFactIds(factIds.filter((value) => value !== id)))}
									/>
								))}
								{missingStories.map((id) => (
									<Button
										key={id}
										variant="secondary"
										label={t`Remove unavailable story reference`}
										onPress={() => change(() => setStoryIds(storyIds.filter((value) => value !== id)))}
									/>
								))}
								{scope === "reusable" ? (
									<CheckRow
										label={t`I removed employer-specific wording and reviewed reuse across employers.`}
										checked={noEmployerWording}
										onChange={setNoEmployerWording}
									/>
								) : null}
							</>
						) : null}
						<CheckRow
							label={t`I reviewed this answer, its evidence and the application context.`}
							checked={reviewed}
							onChange={confirmReview}
						/>
						<Button
							loading={busy}
							label={mode === "reuse" ? t`Use reviewed answer` : t`Save reviewed answer`}
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
							onPress={() => void submit()}
						/>
					</View>
				)}
			</Sheet>
		</>
	);
}
