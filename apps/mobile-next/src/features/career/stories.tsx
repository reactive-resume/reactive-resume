import type { CareerStoryData } from "@reactive-resume/schema/career";
import { t } from "@lingui/core/macro";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { careerStoryInputSchema } from "@reactive-resume/schema/career";
import { generateId } from "@reactive-resume/utils/string";
import { ResourceState, useCareerLeaveGuard } from "./shared";
import { useApplications, useCareerActions, useCareerStories, useDataActions, useDataBackend } from "@/data";
import {
	Button,
	Dialog,
	haptic,
	Chip,
	IconButton,
	ListRow,
	Menu,
	MenuItem,
	PageSubtitle,
	PushScreen,
	SectionHeading,
	Text,
	TextField,
	TextLink,
	Touch,
	showToast,
} from "@/ui";

export function StoriesScreen() {
	const query = useCareerStories();
	const router = useRouter();
	return (
		<PushScreen title={t`Stories`}>
			<ResourceState pending={query.isPending} error={query.isError} retry={() => void query.refetch()}>
				{query.data?.length ? (
					query.data.map((s, i) => (
						<ListRow
							key={s.id}
							title={s.data.title}
							trailing="caret"
							last={i === query.data.length - 1}
							onPress={() => router.push(`/career/knowledge/stories/${s.id}`)}
						/>
					))
				) : (
					<View style={{ padding: 24 }}>
						<Text variant="body">{t`No stories yet`}</Text>
					</View>
				)}
			</ResourceState>
		</PushScreen>
	);
}
const parts = ["situation", "task", "action", "result", "reflection"] as const;
type Part = (typeof parts)[number];
export function StoryScreen() {
	const applications = useApplications();
	const router = useRouter();
	const { id } = useLocalSearchParams<{ id: string }>();
	const query = useCareerStories();
	const actions = useDataActions();
	const careerActions = useCareerActions();
	const [deleting, setDeleting] = useState(false);
	const { backend } = useDataBackend();
	const row = query.data?.find((s) => s.id === id);
	const [draft, setDraft] = useState<CareerStoryData | null>(null);
	const [editing, setEditing] = useState<Part | "tags" | null>(null);
	const [menu, setMenu] = useState(false);
	const [failed, setFailed] = useState(false);
	const [saving, setSaving] = useState(false);
	const data = draft ?? row?.data;
	const guard = useCareerLeaveGuard(draft !== null && JSON.stringify(draft) !== JSON.stringify(row?.data));
	const names = {
		situation: t`Situation`,
		task: t`Task`,
		action: t`What I did`,
		result: t`Result`,
		reflection: t`Reflection`,
	};
	const save = async () => {
		if (!draft || saving) return;
		const parsed = careerStoryInputSchema.safeParse(draft);
		if (!parsed.success) {
			setFailed(true);
			return;
		}
		setSaving(true);
		try {
			await actions.write("stories-and-facts", "career.saveStory", { ...parsed.data, id });
			setEditing(null);
			setDraft(null);
			setFailed(false);
		} catch {
			setFailed(true);
		} finally {
			setSaving(false);
		}
	};
	return (
		<PushScreen
			title={data?.title}
			subtitle={
				backend.kind === "fake" ? <PageSubtitle status>{t`Used in 2 interview briefings`}</PageSubtitle> : undefined
			}
			barEnd={
				editing ? (
					<Button label={t`Done`} tone="accentGhost" disabled={saving} onPress={() => void save()} />
				) : (
					<IconButton icon="dots-three" label={t`More`} onPress={() => setMenu(true)} />
				)
			}
			overlay={
				<>
					{guard.confirmation}
					<Dialog
						open={deleting}
						onClose={() => setDeleting(false)}
						title={t`Delete 1 story permanently?`}
						message={t`It can't be restored.`}
						actions={[
							{
								label: t`Delete permanently`,
								tone: "danger",
								onPress: () => {
									void careerActions
										.deleteStory({ id })
										.then(() => {
											haptic("warning");
											guard.allowLeave();
											router.back();
										})
										.catch(() => setFailed(true));
								},
							},
							{ label: t`Cancel`, tone: "secondary", onPress: () => setDeleting(false) },
						]}
					/>
					<Menu open={menu} onClose={() => setMenu(false)} anchor={{ x: 334, y: 53, width: 44, height: 44 }}>
						<MenuItem
							label={t`Practice this story`}
							onPress={() => {
								setMenu(false);
								// W4 with this story's one question, on the application you're most likely interviewing for.
								const target =
									applications.data?.find((app) => app.status === "interview") ??
									applications.data?.find((app) => app.status !== "closed");
								if (target) router.push(`/applications/${target.id}/practise?story=${id}`);
								else showToast({ message: t`Save a job to practise for it.` });
							}}
						/>
						<MenuItem
							label={t`Duplicate`}
							onPress={() => {
								setMenu(false);
								if (data)
									void actions
										.write("stories-and-facts", "career.saveStory", { ...data, title: t`${data.title} (copy)` })
										.catch(() => setFailed(true));
							}}
						/>
						<MenuItem
							label={t`Delete`}
							onPress={() => {
								setMenu(false);
								setDeleting(true);
							}}
						/>
					</Menu>
				</>
			}
		>
			<ResourceState pending={query.isPending} error={query.isError} retry={() => void query.refetch()}>
				{!data ? (
					<View style={{ padding: 24 }}>
						<Text variant="body">{t`This story is unavailable or uses facts that are switched off.`}</Text>
					</View>
				) : (
					<>
						{failed ? (
							<View style={{ padding: 24 }}>
								<Text
									variant="body"
									color="dangerText"
								>{t`Couldn't save your story. Your edits are kept on this device. Try again.`}</Text>
								<Button label={t`Retry`} onPress={() => void save()} />
							</View>
						) : null}
						{parts.map((part) => (
							<View key={part}>
								<SectionHeading title={names[part]} />
								<View
									style={{
										paddingHorizontal: 24,
										paddingTop: editing === part || data[part] ? 4 : 12,
										paddingBottom: editing === part || data[part] ? 0 : 12,
									}}
								>
									{editing === part ? (
										<TextField
											accessibilityLabel={names[part]}
											multiline
											forceFocus
											autoFocus
											value={data[part]}
											onChangeText={(value) => setDraft({ ...data, [part]: value })}
											maxLength={part === "action" ? 6000 : 4000}
										/>
									) : data[part] ? (
										<Touch
											onPress={() => {
												setDraft(data);
												setEditing(part);
											}}
											accessibilityLabel={t`Edit ${names[part]}`}
										>
											<Text variant="prose">{data[part]}</Text>
										</Touch>
									) : (
										<TextLink
											label={part === "reflection" ? t`Add what you'd do differently` : t`Add ${names[part]}`}
											icon="plus"
											onPress={() => {
												setDraft(data);
												setEditing(part);
											}}
										/>
									)}
								</View>
							</View>
						))}
						<View style={{ paddingHorizontal: 24, paddingTop: 20, flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
							{editing === "tags" ? (
								<TextField
									label={t`Tags, separated by commas`}
									value={data.tags.join(", ")}
									onChangeText={(value) =>
										setDraft({
											...data,
											tags: value
												.split(",")
												.map((v) => v.trim())
												.filter(Boolean),
										})
									}
								/>
							) : (
								data.tags.map((tag) => (
									<Chip
										key={tag}
										label={tag}
										onPress={() => {
											setDraft(data);
											setEditing("tags");
										}}
									/>
								))
							)}
						</View>
					</>
				)}
			</ResourceState>
		</PushScreen>
	);
}

/** W3's missing-story link starts locally; nothing is stored until the complete story validates. */
export function NewStoryScreen() {
	const router = useRouter();
	const actions = useDataActions();
	const [id] = useState(() => generateId());
	const [draft, setDraft] = useState({ title: "", situation: "", task: "", action: "", result: "", reflection: "" });
	const [saving, setSaving] = useState(false);
	const [failed, setFailed] = useState(false);
	const guard = useCareerLeaveGuard(Object.values(draft).some(Boolean));
	const labels = {
		title: t`Title`,
		situation: t`Situation`,
		task: t`Task`,
		action: t`What I did`,
		result: t`Result`,
		reflection: t`Reflection`,
	};
	const save = async () => {
		const parsed = careerStoryInputSchema.safeParse(draft);
		if (!parsed.success) {
			setFailed(true);
			return;
		}
		if (saving) return;
		setSaving(true);
		setFailed(false);
		try {
			await actions.write("stories-and-facts", "career.saveStory", { ...parsed.data, id });
			guard.allowLeave();
			router.replace(`/career/knowledge/stories/${id}`);
		} catch {
			setFailed(true);
		} finally {
			setSaving(false);
		}
	};
	return (
		<PushScreen
			title={t`New story`}
			overlay={guard.confirmation}
			barEnd={<Button label={t`Save`} disabled={saving} onPress={() => void save()} />}
		>
			<View style={{ padding: 24, gap: 20 }}>
				{(Object.keys(labels) as (keyof typeof draft)[]).map((key) => (
					<TextField
						key={key}
						label={labels[key]}
						value={draft[key]}
						multiline={key !== "title"}
						onChangeText={(value) => setDraft((current) => ({ ...current, [key]: value }))}
					/>
				))}
				{failed ? (
					<Text
						variant="body"
						color="dangerText"
					>{t`Couldn't save your story. Check its title, situation, task and action, then try again. Your edits are kept here.`}</Text>
				) : null}
			</View>
		</PushScreen>
	);
}
