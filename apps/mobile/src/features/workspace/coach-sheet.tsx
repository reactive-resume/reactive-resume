import type { Application } from "@/features/applications/types";
import type { MessageContext } from "@/features/assistant/chat";
import type { WorkspaceTab } from "@reactive-resume/schema/career";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { View, useWindowDimensions } from "react-native";
import { tabLabel } from "./parts";
import { client } from "@/api/client";
import { getAccountScope, useSession } from "@/auth/session";
import { useHasAIProvider } from "@/features/ai/providers";
import { useThreads } from "@/features/assistant/chat";
import { ChatView } from "@/features/assistant/chat-view";
import { ModelButton, ModelSheet, ProviderGate, useConversationProvider } from "@/features/assistant/provider";
import { useDeleteThread, useThreadTime, useThreadTitle } from "@/features/assistant/threads";
import { Banner, IconButton, ListRow, Sheet, Text, useTheme } from "@/ui";

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
	const { provider, label, choose } = useConversationProvider(providers, summary, threadId);
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
	const context: MessageContext = { document: true, posting: true, application: true, memory: true, web: false, tab };
	const company = application.company;
	const tabName = tabLabel(tab);
	const privacy = t`Sends your message, earlier messages, this application (posting, notes, documents, your form answers, the saved offer and recent messages) and Knowledge that's switched on to ${label}.`;

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
						disabled={!providers.hasAIProvider}
						connection={label}
						privacy={privacy}
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
