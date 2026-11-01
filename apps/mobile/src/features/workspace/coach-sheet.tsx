import type { Application } from "@/features/applications/types";
import type { MessageContext } from "@/features/assistant/chat";
import type { WorkspaceTab } from "@reactive-resume/schema/career";
import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { View, useWindowDimensions } from "react-native";
import { tabLabel } from "./parts";
import { client, orpc } from "@/api/client";
import { getAccountScope, useSession } from "@/auth/session";
import { useHasAIProvider } from "@/features/ai/providers";
import { useThreads } from "@/features/assistant/chat";
import { ChatView, ContextChip, type ChatHistory } from "@/features/assistant/chat-view";
import {
	ConnectionNotice,
	ModelButton,
	ModelSheet,
	ProviderGate,
	useConversationProvider,
	useMemoryNote,
	useWebSearch,
	WebResearchChip,
} from "@/features/assistant/provider";
import { useDeleteThread, useThreadTime, useThreadTitle } from "@/features/assistant/threads";
import { StoryEditor } from "@/features/career/stories";
import { Banner, IconButton, ListRow, Sheet, Text, showToast, useTheme } from "@/ui";

type CoachSheetProps = { application: Application; tab: WorkspaceTab; open: boolean; onClose: () => void };

/** Mount only while open: leaving detaches the stream and discards unsent attachments. Reopening reads history. */
export function CoachSheet(props: CoachSheetProps) {
	const { t } = useLingui();
	useSession();
	return (
		<Sheet open={props.open} onClose={props.onClose} title={t`Coach`} detents={[0.9]} padded={false}>
			{props.open && getAccountScope() ? (
				<ApplicationCoach
					key={`${getAccountScope()}:${props.application.id}`}
					application={props.application}
					tab={props.tab}
				/>
			) : null}
		</Sheet>
	);
}

type ApplicationCoachProps = Pick<CoachSheetProps, "application" | "tab">;

function ApplicationCoach({ application, tab }: ApplicationCoachProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const { height } = useWindowDimensions();
	const providers = useHasAIProvider();
	const threads = useThreads();
	const [selected, setSelected] = useState<string | null>(null);
	const [draftKey, setDraftKey] = useState(0);
	const [history, setHistory] = useState(false);
	const [modelOpen, setModelOpen] = useState(false);
	const list = (threads.data ?? []).filter(
		(thread) => thread.scope === "application" && thread.applicationId === application.id,
	);
	const threadId = selected === "new" ? null : (selected ?? list[0]?.id ?? null);
	const summary = list.find((thread) => thread.id === threadId);
	const { provider, stranded, label, choose } = useConversationProvider(providers, summary, threadId);
	const web = useWebSearch();
	// The same choices as Career → Coach, for this sheet: Knowledge on, Web research off until turned on.
	const [chips, setChips] = useState({ memory: true, web: false });
	const memory = useMemoryNote(chips.memory);
	const facts = useQuery(orpc.career.facts.queryOptions({ input: { applicationId: application.id } }));
	const title = useThreadTitle();
	const time = useThreadTime();
	const open = (id: string) => {
		setDraftKey((key) => key + 1);
		setSelected(id);
		setHistory(false);
	};
	const remove = useDeleteThread((id) => {
		if (id === threadId) open("new");
	});
	const context: MessageContext = {
		document: true,
		posting: true,
		application: true,
		memory: chips.memory,
		web: chips.web && web.canSearch,
		tab,
	};
	const company = application.company;
	const tabName = tabLabel(tab);
	const privacy = ({ earlier, withheld }: ChatHistory) =>
		[
			stranded
				? t`Nothing is sent until you choose a connection for this conversation.`
				: earlier > 0
					? chips.memory
						? t`Sends your message, earlier messages, this application (posting, notes, documents sent) and Knowledge that's switched on to ${label}.`
						: t`Sends your message, earlier messages and this application (posting, notes, documents sent) to ${label}.`
					: chips.memory
						? t`Sends your message, this application (posting, notes, documents sent) and Knowledge that's switched on to ${label}.`
						: t`Sends your message and this application (posting, notes, documents sent) to ${label}.`,
			...(withheld > 0 ? [t`Messages from before Knowledge changed aren't sent.`] : []),
			...(context.web ? [t`Search terms go to your web search service.`] : []),
			memory.note,
		]
			.filter(Boolean)
			.join(" ");

	return (
		<View style={{ height: height * 0.7 }}>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					gap: space.s2,
					paddingHorizontal: space.s4,
					paddingVertical: space.s2,
				}}
			>
				<View style={{ flex: 1 }}>
					<Text variant="callout" color="ink3">{t`${company} · ${tabName}`}</Text>
					<ModelButton label={provider?.model ?? label} onPress={() => setModelOpen(true)} />
				</View>
				<IconButton
					icon="clock-counter-clockwise"
					label={t`Conversations`}
					selected={history}
					onPress={() => setHistory(!history)}
				/>
				<IconButton icon="note-pencil" label={t`New conversation`} onPress={() => open("new")} />
			</View>
			<ProviderGate
				providers={providers}
				readOnly={history || threadId !== null}
				threadsError={threads.error}
				loading={threads.isPending}
				onRetry={() => {
					providers.retry();
					void threads.refetch();
				}}
				notSetUp={t`The coach isn't set up on this server. Whoever runs it needs to set ENCRYPTION_SECRET.`}
			>
				{threads.isError ? (
					<Banner
						tone="danger"
						message={t`Conversations couldn't load.`}
						action={{ label: t`Retry`, onPress: () => void threads.refetch() }}
					/>
				) : history ? (
					<View>
						<ListRow title={t`New conversation`} leading="note-pencil" onPress={() => open("new")} />
						{list.map((thread) => (
							<ListRow
								key={thread.id}
								title={title(thread)}
								subtitle={time(thread.lastMessageAt)}
								selected={thread.id === threadId}
								onPress={() => open(thread.id)}
								trailing={
									<IconButton icon="trash" label={t`Delete ${title(thread)}`} onPress={() => remove.ask(thread)} />
								}
							/>
						))}
					</View>
				) : (
					<ChatView
						key={draftKey}
						threadId={threadId}
						createThread={async (scope) =>
							(
								await client.agent.threads.start(
									{
										scope: "application",
										applicationId: application.id,
										...(provider ? { aiProviderId: provider.id } : {}),
									},
									{ context: { scope } },
								)
							).id
						}
						onThreadCreated={(id) => {
							setSelected(id);
							void threads.refetch();
						}}
						context={context}
						document={null}
						disabled={!providers.hasAIProvider || stranded}
						connection={label}
						privacy={privacy}
						remember={{ applicationId: application.id }}
						facts={facts.data ?? []}
						storyEditor={({ story, onChange, onSaved, onClose }) => (
							<StoryEditor
								story={null}
								facts={facts.data ?? []}
								proposal={{
									story,
									onChange,
									onSaved: () => {
										onSaved();
										showToast({ message: t`Your edited story is saved to Knowledge.` });
									},
								}}
								onClose={onClose}
							/>
						)}
						notice={
							stranded ? (
								<ConnectionNotice
									label={summary?.providerLabel ?? null}
									fallback={providers.usableProviders[0]}
									onUse={(id) => void choose(id)}
									onChoose={() => setModelOpen(true)}
								/>
							) : null
						}
						chips={
							<>
								<ContextChip
									icon="brain"
									label={t`Knowledge`}
									pressed={chips.memory}
									onPress={() => setChips({ ...chips, memory: !chips.memory })}
								/>
								<WebResearchChip
									web={web}
									pressed={chips.web}
									onPress={() => setChips({ ...chips, web: !chips.web })}
								/>
								{memory.chip}
							</>
						}
						placeholder={t`Ask about this application…`}
						assistantName={t`Coach`}
						onSwitchModel={() => setModelOpen(true)}
						empty={() => (
							<Text color="ink2">{t`Ask anything about this job. The coach reads the posting, your notes and what you sent, and knows you're on ${tabName}.`}</Text>
						)}
					/>
				)}
			</ProviderGate>
			<ModelSheet
				open={modelOpen}
				onClose={() => setModelOpen(false)}
				providers={providers.usableProviders}
				currentId={provider?.id}
				onChoose={(id) => void choose(id)}
			/>
			{remove.dialog}
		</View>
	);
}
