// Career → Coach (ported from apps/web/src/features/career/coach.tsx): conversations about the whole search, with what
// each message shares chosen in the composer.
import type { MessageContext, ThreadSummary } from "./chat";
import type { IconName } from "@/ui";
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { formatList } from "@reactive-resume/utils/locale";
import { refreshThreads, useThreads } from "./chat";
import { ChatView, ContextChip } from "./chat-view";
import { ModelButton, ModelSheet, ProviderGate, useConversationProvider } from "./provider";
import { useDeleteThread, useThreadTime, useThreadTitle } from "./threads";
import { client, orpc } from "@/api/client";
import { useSession } from "@/auth/session";
import { useHasAIProvider } from "@/features/ai/providers";
import { Button, Icon, IconButton, ListRow, Sheet, Text, TextField, showToast, useTheme } from "@/ui";

type Chips = { application: boolean; memory: boolean; web: boolean; offers: boolean };
const DEFAULT_CHIPS: Chips = { application: true, memory: true, web: false, offers: true };

/** Expo Router gives one value or several for `?offers=`; at most two offers are compared. */
export function offerIdsFrom(value: string | string[] | undefined) {
	return (Array.isArray(value) ? value : value ? [value] : [])
		.flatMap((item) => item.split(","))
		.map((item) => item.trim())
		.filter(Boolean)
		.slice(0, 2);
}

/** Shared, switched-on facts and usable stories, as the server's career context counts them (web: useCoachKnowledge). */
function useCoachKnowledge() {
	const session = useSession();
	const enabled = session.status === "signed-in";
	const factsOptions = orpc.career.facts.queryOptions({ input: { applicationId: null, all: true } });
	const storiesOptions = orpc.career.stories.queryOptions({ input: { applicationId: null } });
	const facts = useQuery({ ...factsOptions, queryKey: [...factsOptions.queryKey, session.server], enabled });
	const stories = useQuery({ ...storiesOptions, queryKey: [...storiesOptions.queryKey, session.server], enabled });
	const active = (facts.data ?? []).filter((fact) => fact.status === "active" && fact.applicationId === null);
	const usable = (stories.data ?? []).filter(
		(story) =>
			story.data.factIds.length > 0 &&
			story.data.factIds.every((id) =>
				active.some(
					(fact) =>
						fact.id === id && (fact.revisions.length === 0 || new Date(fact.updatedAt) <= new Date(story.updatedAt)),
				),
			),
	);
	return {
		isPending: facts.isPending || stories.isPending,
		isError: facts.isError || stories.isError,
		retry: () => {
			void facts.refetch();
			void stories.refetch();
		},
		facts: active.length,
		stories: usable.length,
	};
}

type CoachScreenProps = {
	/** Saved offers to compare, from Offers → Plan what to ask (M6-T1). */
	offerIds: string[];
};

export function CoachScreen({ offerIds }: CoachScreenProps) {
	const { t, i18n } = useLingui();
	const { colors, space } = useTheme();
	const queryClient = useQueryClient();
	const providers = useHasAIProvider();
	const threads = useThreads();
	const knowledge = useCoachKnowledge();
	const [threadId, setThreadId] = useState<string | null>(null);
	const [draftKey, setDraftKey] = useState(0);
	const [chips, setChips] = useState<Chips>(DEFAULT_CHIPS);
	const [listOpen, setListOpen] = useState(false);
	const [modelOpen, setModelOpen] = useState(false);

	const conversations = (threads.data ?? []).filter((thread) => thread.scope === "career");
	const summary = threads.data?.find((thread) => thread.id === threadId);
	const { provider, label, choose } = useConversationProvider(providers, summary, threadId);
	const title = useThreadTitle();

	const context: MessageContext = {
		// A career conversation has no document or posting to leave out.
		document: true,
		posting: true,
		application: chips.application,
		memory: chips.memory,
		web: chips.web,
		...(offerIds.length > 0 && chips.offers ? { offerIds } : {}),
	};
	const knowledgeBlocks = chips.memory && (knowledge.isPending || knowledge.isError);

	// The privacy line names exactly what goes. The chips choose what this message adds; earlier messages always go.
	const parts = [
		t`your message`,
		t`earlier messages in this chat`,
		...(chips.application ? [t`application summaries`] : []),
		...(context.offerIds ? [plural(offerIds.length, { one: "# saved offer", other: "# saved offers" })] : []),
		...(chips.memory
			? [
					t`your preferences`,
					...(knowledge.facts > 0 ? [plural(knowledge.facts, { one: "# fact", other: "# facts" })] : []),
					...(knowledge.stories > 0 ? [t`your stories`] : []),
				]
			: []),
	];
	const list = formatList(i18n.locale, parts);
	const connection = /connection$/i.test(label) ? label : t`${label} connection`;
	const privacy = [
		chips.memory && knowledge.isError
			? t`Knowledge couldn't load. Try again or switch Knowledge off before sending.`
			: chips.memory && knowledge.isPending
				? t`Loading Knowledge before you send…`
				: t`When you tap send, ${list} go to ${connection}.`,
		...(chips.web ? [t`Search terms go to your web search service.`] : []),
	].join(" ");

	const newConversation = () => {
		setThreadId(null);
		setDraftKey((key) => key + 1);
		setListOpen(false);
	};

	return (
		<View style={{ flex: 1, backgroundColor: colors.surface }}>
			<View style={{ paddingHorizontal: space.s4, flexDirection: "row", alignItems: "center" }}>
				<Text variant="label" style={{ flex: 1 }}>
					{summary ? title(summary) : t`Coach`}
				</Text>
				<IconButton icon="clock-counter-clockwise" label={t`Conversations`} onPress={() => setListOpen(true)} />
				<IconButton icon="note-pencil" label={t`New conversation`} onPress={newConversation} />
			</View>
			<ProviderGate
				providers={providers}
				readOnly={threadId !== null}
				threadsError={threads.error}
				loading={threads.isPending}
				onRetry={() => {
					providers.retry();
					void threads.refetch();
					knowledge.retry();
				}}
				notSetUp={t`The coach isn't set up on this server. Whoever runs it needs to set ENCRYPTION_SECRET. Knowledge, Offers and your applications work without it.`}
			>
				<View
					style={{
						flexDirection: "row",
						alignItems: "center",
						gap: space.s2,
						paddingHorizontal: space.s4,
						paddingVertical: space.s2,
						borderBottomWidth: 1,
						borderColor: colors.line,
					}}
				>
					<Icon name="sparkle" size={18} color={colors.accent} />
					<View style={{ flex: 1 }}>
						<ModelButton
							label={provider ? `${provider.label} · ${provider.model}` : label}
							onPress={() => setModelOpen(true)}
						/>
					</View>
					{chips.memory && knowledge.isError ? (
						<Button variant="link" size="sm" label={t`Retry`} onPress={knowledge.retry} />
					) : null}
				</View>
				<ChatView
					key={draftKey}
					threadId={threadId}
					createThread={async (scope) =>
						(
							await client.agent.threads.start(
								{ scope: "career", ...(provider ? { aiProviderId: provider.id } : {}) },
								{ context: { scope } },
							)
						).id
					}
					onThreadCreated={(id) => {
						setThreadId(id);
						void threads.refetch();
					}}
					context={context}
					document={null}
					onRefresh={() =>
						Promise.allSettled([
							threads.refetch(),
							queryClient.invalidateQueries({ queryKey: orpc.career.key() }),
							queryClient.invalidateQueries({ queryKey: orpc.applications.key() }),
							queryClient.invalidateQueries({ queryKey: orpc.auth.getProfile.key() }),
							queryClient.invalidateQueries({ queryKey: orpc.aiProviders.key() }),
						])
					}
					connection={connection}
					privacy={privacy}
					placeholder={t`Ask about your next career step…`}
					assistantName={t`Coach`}
					disabled={knowledgeBlocks || !provider}
					onSwitchModel={() => setModelOpen(true)}
					onFinish={() => {
						// The coach may have remembered a fact or saved a story.
						void queryClient.invalidateQueries({ queryKey: orpc.career.facts.key() });
						void queryClient.invalidateQueries({ queryKey: orpc.career.stories.key() });
					}}
					chips={
						<>
							<ContextChip
								icon="briefcase"
								label={t`Applications`}
								pressed={chips.application}
								onPress={() => setChips({ ...chips, application: !chips.application })}
							/>
							<ContextChip
								icon="brain"
								label={plural(knowledge.facts, { one: "Knowledge · # fact", other: "Knowledge · # facts" })}
								pressed={chips.memory}
								onPress={() => setChips({ ...chips, memory: !chips.memory })}
							/>
							<ContextChip
								icon="globe-hemisphere-west"
								label={t`Web research`}
								pressed={chips.web}
								onPress={() => setChips({ ...chips, web: !chips.web })}
							/>
							{offerIds.length > 0 ? (
								<ContextChip
									icon="hand-heart"
									label={plural(offerIds.length, { one: "# saved offer", other: "# saved offers" })}
									pressed={chips.offers}
									onPress={() => setChips({ ...chips, offers: !chips.offers })}
								/>
							) : null}
						</>
					}
					empty={(send) => <Starters disabled={knowledgeBlocks || !provider} onPick={send} />}
				/>
			</ProviderGate>

			<ConversationsSheet
				open={listOpen}
				onClose={() => setListOpen(false)}
				threads={conversations}
				currentId={threadId}
				onNew={newConversation}
				onOpen={(id) => {
					setThreadId(id);
					setListOpen(false);
				}}
				onDeleted={(id) => {
					if (id === threadId) newConversation();
				}}
				onRenamed={() => refreshThreads(queryClient)}
			/>
			<ModelSheet
				open={modelOpen}
				onClose={() => setModelOpen(false)}
				providers={providers.usableProviders}
				currentId={provider?.id}
				onChoose={(id) => void choose(id)}
			/>
		</View>
	);
}

function Starters({ disabled, onPick }: { disabled: boolean; onPick: (text: string) => void }) {
	const { t } = useLingui();
	const { colors, radius, space } = useTheme();
	const starters: Array<{ icon: IconName; text: string }> = [
		{ icon: "list-magnifying-glass", text: t`Which opportunities best match my priorities?` },
		{
			icon: "list-numbers",
			text: t`Help me turn an accomplishment into a Situation, Task, Action, Result and Reflection story.`,
		},
		{ icon: "user-sound", text: t`What interview answers should I practice?` },
	];
	return (
		<View style={{ gap: space.s4, paddingTop: space.s4 }}>
			<View style={{ gap: space.s2 }}>
				<Text variant="heading" accessibilityRole="header">
					<Trans>What are you working on?</Trans>
				</Text>
				<Text color="ink2">
					<Trans>
						Ask about your search, or bring an accomplishment you want to explain better. Answers use what's switched on
						below and say what they relied on.
					</Trans>
				</Text>
			</View>
			{starters.map((starter) => (
				<Pressable
					key={starter.icon}
					accessibilityRole="button"
					disabled={disabled}
					onPress={() => onPick(starter.text)}
					style={({ pressed }) => ({
						flexDirection: "row",
						alignItems: "center",
						gap: space.s3,
						minHeight: 52,
						padding: space.s3,
						borderWidth: 1,
						borderColor: colors.line,
						borderRadius: radius.rLg,
						backgroundColor: pressed ? colors.press : colors.raised,
						opacity: disabled ? 0.6 : 1,
					})}
				>
					<Icon name={starter.icon} size={22} color={colors.accentText} />
					<Text style={{ flex: 1 }}>{starter.text}</Text>
				</Pressable>
			))}
		</View>
	);
}

type ConversationsSheetProps = {
	open: boolean;
	onClose: () => void;
	threads: readonly ThreadSummary[];
	currentId: string | null;
	onNew: () => void;
	onOpen: (id: string) => void;
	onDeleted: (id: string) => void;
	onRenamed: () => void;
};

/** New conversation, then the career conversations: open, rename or delete. */
function ConversationsSheet(props: ConversationsSheetProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const title = useThreadTitle();
	const time = useThreadTime();
	const remove = useDeleteThread(props.onDeleted);
	const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);

	const saveName = async () => {
		const target = renaming;
		setRenaming(null);
		const next = target?.title.trim();
		if (!target || !next) return;
		try {
			await client.agent.threads.update({ id: target.id, title: next });
			props.onRenamed();
		} catch {
			showToast({ message: t`Couldn't rename the conversation. Try again.` });
		}
	};

	return (
		<Sheet open={props.open} onClose={props.onClose} title={t`Conversations`} detents={[0.7]}>
			<ListRow title={t`New conversation`} leading="note-pencil" onPress={props.onNew} />
			{props.threads.map((thread) =>
				renaming?.id === thread.id ? (
					<View key={thread.id} style={{ gap: space.s2, paddingHorizontal: space.s4 }}>
						<TextField
							label={t`Conversation name`}
							value={renaming.title}
							onChangeText={(value) => setRenaming({ id: thread.id, title: value })}
							maxLength={200}
							autoFocus
							returnKeyType="done"
							onSubmitEditing={() => void saveName()}
						/>
						<View style={{ flexDirection: "row", gap: space.s2 }}>
							<Button size="sm" label={t`Save`} onPress={() => void saveName()} />
							<Button size="sm" variant="ghost" label={t`Cancel`} onPress={() => setRenaming(null)} />
						</View>
					</View>
				) : (
					<ListRow
						key={thread.id}
						title={title(thread)}
						subtitle={time(thread.lastMessageAt)}
						selected={thread.id === props.currentId}
						onPress={() => props.onOpen(thread.id)}
						trailing={
							<View style={{ flexDirection: "row" }}>
								<IconButton
									icon="pencil-simple"
									label={t`Rename ${title(thread)}`}
									onPress={() => setRenaming({ id: thread.id, title: title(thread) })}
								/>
								<IconButton icon="trash" label={t`Delete ${title(thread)}`} onPress={() => remove.ask(thread)} />
							</View>
						}
					/>
				),
			)}
			<Text variant="caption" color="ink3" style={{ paddingHorizontal: space.s4 }}>
				<Trans>Conversations about one job live in its workspace.</Trans>
			</Text>
			{remove.dialog}
		</Sheet>
	);
}
