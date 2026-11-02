import type { Fact, Story } from "./hooks";
import type { CareerStoryData } from "@reactive-resume/schema/career";
import type { ComponentRef } from "react";
import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useRef, useState } from "react";
import { type TextInput, View } from "react-native";
import Animated from "react-native-reanimated";
import { careerStoryInputSchema } from "@reactive-resume/schema/career";
import { client, useCareerAction, useCareerQueries, useUndoRows } from "./hooks";
import { Actions, EditorSheet, LoadState, SwitchRow } from "./shared";
import {
	Banner,
	Button,
	Card,
	ChipInput,
	EmptyState,
	Text,
	TextArea,
	TextField,
	listItemMotion,
	listLayout,
	useFirstAppearance,
	useTheme,
} from "@/ui";

const parts = () =>
	(
		[
			{ key: "situation", label: t`Situation`, max: 4000 },
			{ key: "task", label: t`Task`, max: 4000 },
			{ key: "action", label: t`Action`, max: 6000 },
			{ key: "result", label: t`Result`, max: 4000 },
			{ key: "reflection", label: t`Reflection`, max: 4000 },
		] as const
	).map((part) => ({
		...part,
		required: !careerStoryInputSchema.shape[part.key].safeParse("").success,
	}));
export function Stories() {
	const { t } = useLingui();
	const { space } = useTheme();
	const { stories, facts } = useCareerQueries();
	const [editor, setEditor] = useState<{ story: Story | null } | null>(null);
	const undo = useUndoRows();
	const rows = (stories.data ?? []).filter((row) => !undo.hidden.includes(row.id));
	const firstAppearance = useFirstAppearance(!stories.isPending);
	return (
		<View style={{ gap: space.s4 }}>
			<Text color="ink3">{t`Situation, Task, Action, Result, Reflection. Link each story to facts you can support; leave unknown outcomes blank.`}</Text>
			<Button label={t`Add a story`} onPress={() => setEditor({ story: null })} />
			<LoadState query={stories} />
			<LoadState query={facts} />
			{!stories.isError && !stories.isPending && !rows.length ? (
				<EmptyState
					variant="card"
					title={t`No stories yet`}
					message={t`Write one about something you did, in five parts. Leave Result and Reflection blank until you can support them.`}
				/>
			) : null}
			{rows.map((story, index) => {
				const changed = story.data.factIds.some((id) => {
					const fact = facts.data?.find((row) => row.id === id);
					const revision = fact?.revisions.at(-1);
					return !fact || fact.status !== "active" || (revision && new Date(revision.at) > new Date(story.updatedAt));
				});
				return (
					<Animated.View key={story.id} {...listItemMotion(index, firstAppearance)} layout={listLayout}>
						<Card style={{ gap: space.s3 }}>
							<Text variant="title">{story.data.title}</Text>
							{changed ? <Banner tone="warn" message={t`A fact changed. Review this story.`} /> : null}
							{parts().map((part) => (
								<View key={part.key}>
									<Text variant="label">{part.label}</Text>
									<Text>{story.data[part.key] || t`Not recorded yet. Leave blank until you can support it.`}</Text>
								</View>
							))}
							<Text variant="label">{t`Backed by`}</Text>
							{story.data.factIds.map((id) => (
								<Text key={id} color="ink2">
									{facts.data?.find((row) => row.id === id)?.text ?? t`Fact no longer available`}
								</Text>
							))}
							<Text color="ink3">{story.data.tags.join(" · ")}</Text>
							<Actions>
								<Button label={t`Edit`} variant="secondary" onPress={() => setEditor({ story })} />
								<Button
									label={t`Delete story`}
									variant="ghost"
									onPress={() =>
										undo.remove(story.id, t`Story deleted`, () => client.career.deleteStory({ id: story.id }))
									}
								/>
							</Actions>
						</Card>
					</Animated.View>
				);
			})}
			{editor && facts.data ? (
				<StoryEditor
					key={editor.story?.id ?? "new"}
					story={editor.story}
					facts={facts.data}
					onClose={() => setEditor(null)}
				/>
			) : null}
		</View>
	);
}

type StoryEditorProps = {
	story: Story | null;
	facts: Fact[];
	onClose: () => void;
	/**
	 * A coach's proposal opened with Edit first: its parts and scope start the draft, edits are handed back as they're
	 * typed (so closing keeps them for the review card), and `onSaved` follows a successful save.
	 */
	proposal?: { story: CareerStoryData; onChange: (story: CareerStoryData) => void; onSaved: () => void };
};
export function StoryEditor({ story, facts, onClose, proposal }: StoryEditorProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const [draft, setDraft] = useState<CareerStoryData>(
		() =>
			proposal?.story ??
			story?.data ?? {
				applicationId: null,
				title: "",
				situation: "",
				task: "",
				action: "",
				result: "",
				reflection: "",
				factIds: [],
				tags: [],
			},
	);
	const action = useCareerAction();
	const [tried, setTried] = useState(false);
	const inputs = useRef<
		Partial<Record<"title" | ReturnType<typeof parts>[number]["key"], ComponentRef<typeof TextInput> | null>>
	>({});
	const available = facts.filter(
		(fact) => fact.status === "active" && (!fact.applicationId || fact.applicationId === draft.applicationId),
	);
	const change = (patch: Partial<CareerStoryData>) =>
		setDraft((current) => {
			const next = { ...current, ...patch };
			proposal?.onChange(next);
			return next;
		});
	// Proposed facts this scope can't use: they won't back the story, and the server would refuse them.
	const unavailable = draft.factIds.filter((id) => !available.some((fact) => fact.id === id));
	const payload = { ...draft, factIds: draft.factIds.filter((id) => available.some((fact) => fact.id === id)) };
	const valid = careerStoryInputSchema.safeParse(payload).success;
	const missingTitle = !draft.title.trim();
	const missingParts = parts().filter((part) => part.required && !draft[part.key].trim());
	const firstMissing = missingTitle ? "title" : missingParts[0]?.key;
	const dirty =
		JSON.stringify(draft) !==
		JSON.stringify(
			story?.data ?? {
				applicationId: null,
				title: "",
				situation: "",
				task: "",
				action: "",
				result: "",
				reflection: "",
				factIds: [],
				tags: [],
			},
		);
	return (
		<EditorSheet
			// A proposal's edits are kept for its review card, so closing never discards them.
			dirty={proposal ? false : dirty}
			pending={action.pending}
			onClose={onClose}
			title={proposal ? t`Edit the proposed story` : story ? t`Edit STARR story` : t`New STARR story`}
		>
			<View style={{ padding: space.s4, gap: space.s4 }}>
				<Text color="ink3">{t`Give the story a title, then fill in Situation, Task and Action. Leave Result and Reflection blank until you can support them.`}</Text>
				<TextField
					label={t`Title`}
					ref={(input) => {
						inputs.current.title = input;
					}}
					value={draft.title}
					maxLength={200}
					error={tried && missingTitle ? t`Give the story a title before you can save.` : undefined}
					onChangeText={(title) => change({ title })}
				/>
				<ChipInput label={t`Tags`} values={draft.tags} onChange={(tags) => change({ tags })} />
				{parts().map((part) => (
					<TextArea
						key={part.key}
						label={part.required ? part.label : t`${part.label} (optional)`}
						ref={(input) => {
							inputs.current[part.key] = input;
						}}
						error={
							tried && missingParts.some((missing) => missing.key === part.key)
								? t`Complete ${part.label} before saving.`
								: undefined
						}
						value={draft[part.key]}
						maxLength={part.max}
						onChangeText={(value) => change({ [part.key]: value })}
					/>
				))}
				<Text variant="label">{t`Backed by`}</Text>
				<Text color="ink3">{t`Only enabled facts can back a story. Leave unsupported outcomes blank.`}</Text>
				{available.map((fact) => (
					<SwitchRow
						key={fact.id}
						label={fact.text}
						value={draft.factIds.includes(fact.id)}
						onValueChange={(enabled) =>
							change({ factIds: enabled ? [...draft.factIds, fact.id] : draft.factIds.filter((id) => id !== fact.id) })
						}
					/>
				))}
				{unavailable.length > 0 ? (
					<Banner
						tone="warn"
						message={plural(unavailable.length, {
							one: "# proposed fact isn't available here and won't back the story.",
							other: "# proposed facts aren't available here and won't back the story.",
						})}
					/>
				) : null}
				{action.error ? <Banner tone="danger" message={action.error} /> : null}
				<Button
					label={t`Save story`}
					loading={action.pending}
					disabled={!valid && !firstMissing}
					onPress={() => {
						setTried(true);
						if (!valid) {
							if (firstMissing) {
								requestAnimationFrame(() => inputs.current[firstMissing]?.focus());
							}
							return;
						}
						void action.run(
							() => client.career.saveStory({ ...payload, ...(story ? { id: story.id } : {}) }),
							proposal ? proposal.onSaved : onClose,
						);
					}}
				/>
			</View>
		</EditorSheet>
	);
}
