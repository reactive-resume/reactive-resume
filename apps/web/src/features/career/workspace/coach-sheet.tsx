import type { Application } from "@/features/applications/types";
import type { MessageContext } from "@/features/assistant/chat";
import type { RouterOutput } from "@/libs/orpc/client";
import type { WorkspaceTab } from "@reactive-resume/schema/career";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@reactive-resume/ui/components/sheet";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { CoachThread, connectionName, deleteConversation, titleFor, useConversationDate } from "../coach-thread";
import { PrivacyLine, tabLabel } from "../shared";
import { ProviderSetup, SetUpAi } from "@/features/assistant/provider-setup";
import { WebAccessAttention } from "@/features/settings/ai/web-access";
import { AiProviderLoadState } from "@/features/settings/integrations/ai-provider-load-state";
import { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import { toastError } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";

type ThreadSummary = RouterOutput["agent"]["threads"]["list"][number];

/** URL state: true opens the newest conversation, "new" a fresh one, anything else that conversation. */
export type CoachConversation = true | string;

type CoachSheetProps = {
	application: Application;
	tab: WorkspaceTab;
	/** Undefined when the sheet is closed. */
	conversation: CoachConversation | undefined;
	onConversationChange: (conversation: CoachConversation | undefined) => void;
};

/** W19: chat about this job beside any tab, in as many conversations as needed. Esc closes and keeps the draft. */
export function CoachSheet({ application, tab, conversation, onConversationChange }: CoachSheetProps) {
	// The conversation stays on screen while the sheet slides out.
	const [shown, setShown] = useState<CoachConversation>(conversation ?? true);
	if (conversation !== undefined && conversation !== shown) setShown(conversation);
	const queryClient = useQueryClient();
	// Deleted conversations wait out their Undo here, so closing the sheet doesn't bring them back early.
	const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
	// Where the sheet is when an Undo fires: it returns to the restored conversation only from the fresh one its delete
	// opened, never from a conversation started since or a closed sheet.
	const current = useRef(conversation);
	useEffect(() => {
		current.current = conversation;
	});
	const remove = (id: string, opened: () => void) =>
		deleteConversation(
			queryClient,
			id,
			() => {
				setHidden((ids) => new Set(ids).add(id));
				opened();
			},
			() => {
				setHidden((ids) => new Set([...ids].filter((item) => item !== id)));
				if (current.current === "new") onConversationChange(id);
			},
		);

	return (
		<Sheet open={conversation !== undefined} onOpenChange={(open) => onConversationChange(open ? true : undefined)}>
			<SheetContent
				side="right"
				closeLabel={t`Close`}
				className="gap-0 border-s border-line data-[side=right]:sm:max-w-none data-[side=right]:md:max-w-[420px]"
			>
				<CoachSheetBody
					application={application}
					tab={tab}
					conversation={shown}
					hidden={hidden}
					onConversationChange={onConversationChange}
					onDelete={remove}
				/>
			</SheetContent>
		</Sheet>
	);
}

type CoachSheetBodyProps = {
	application: Application;
	tab: WorkspaceTab;
	conversation: CoachConversation;
	/** Conversations deleted with Undo still pending. */
	hidden: ReadonlySet<string>;
	onConversationChange: (conversation: CoachConversation) => void;
	/** Deletes after the Undo toast; `opened` runs once it's hidden. */
	onDelete: (id: string, opened: () => void) => void;
};

function CoachSheetBody({
	application,
	tab,
	conversation,
	hidden,
	onConversationChange,
	onDelete,
}: CoachSheetBodyProps) {
	const [choosingModel, setChoosingModel] = useState(false);
	const queryClient = useQueryClient();
	const providers = useHasUsableAiProvider();
	const threads = useQuery(orpc.agent.threads.list.queryOptions());
	// A new chat each time another conversation is picked, so an unsent attachment can't follow it there. The one the
	// first message just created keeps its chat, so the answer keeps streaming.
	const [session, setSession] = useState(0);

	// This job's conversations, newest first.
	const list = (threads.data ?? []).filter(
		(thread) => thread.scope === "application" && thread.applicationId === application.id && !hidden.has(thread.id),
	);
	const summary =
		conversation === true ? list[0] : conversation === "new" ? undefined : list.find(({ id }) => id === conversation);
	const threadId = summary?.id ?? null;
	const usable = providers.usableProviders;
	const tabName = tabLabel(tab);
	const provider = usable.find((item) => item.id === summary?.aiProviderId) ?? (summary ? undefined : usable[0]);
	const connection = connectionName(provider?.label ?? summary?.providerLabel ?? t`Your AI`);

	const open = (next: CoachConversation) => {
		setSession((current) => current + 1);
		onConversationChange(next);
	};
	const remove = (thread: ThreadSummary) => onDelete(thread.id, () => open("new"));

	// The current tab is a hint, so answers fit the task at hand.
	const context: MessageContext = { document: true, posting: true, application: true, memory: true, web: false, tab };

	const createThread = async () => {
		const thread = await client.agent.threads.start({
			scope: "application",
			applicationId: application.id,
			...(provider ? { aiProviderId: provider.id } : {}),
		});
		queryClient.setQueryData(orpc.agent.threads.list.queryKey(), (old: ThreadSummary[] | undefined) =>
			old ? [thread, ...old] : old,
		);
		return thread.id;
	};

	const header = (
		<header className="flex h-14 shrink-0 items-center gap-1 border-b border-line ps-4 pe-14">
			<Icon name="sparkle" size={20} className="me-1.5 shrink-0 text-accent-text" />
			<div className="grid min-w-0 flex-1">
				<SheetTitle className="font-sans text-[15px] leading-5 font-semibold">
					<Trans>Coach</Trans>
				</SheetTitle>
				<SheetDescription className="truncate text-xs text-ink-3">
					{application.company} · {tabLabel(tab)}
				</SheetDescription>
			</div>
			{list.length > 0 && <ConversationMenu threads={list} currentId={threadId} onOpen={open} onDelete={remove} />}
			<IconButton
				icon="note-pencil"
				label={t`New conversation`}
				size="icon-sm"
				iconSize={20}
				className="text-ink-2"
				disabled={threadId === null}
				onClick={() => open("new")}
			/>
		</header>
	);

	if (providers.error && !threadId)
		return (
			<AiProviderLoadState
				state={{
					...providers,
					retry: () => {
						providers.retry();
						void threads.refetch();
					},
				}}
			/>
		);
	if ((providers.isLoading && !threadId) || threads.isPending)
		return (
			<>
				{header}
				<WebAccessAttention />
				<div className="grid flex-1 place-items-center">
					<Spinner />
				</div>
			</>
		);
	if (!providers.hasUsableProvider && !threadId)
		return (
			<>
				{header}
				<WebAccessAttention />
				<div className="min-h-0 flex-1 overflow-y-auto">
					<ProviderSetup />
				</div>
			</>
		);

	return (
		<>
			{header}
			<WebAccessAttention />
			{providers.error && <AiProviderLoadState state={providers} />}
			{(!provider || choosingModel) && (
				<div className="grid gap-2 p-3">
					<p className="text-xs text-warn-text">
						<Trans>Choose a destination before continuing. Earlier messages may be sent to the chosen provider.</Trans>
					</p>
					{usable.map((item) => (
						<Button
							key={item.id}
							size="sm"
							variant="secondary"
							onClick={async () => {
								if (!threadId) return;
								try {
									await client.agent.threads.update({ id: threadId, aiProviderId: item.id });
									await queryClient.invalidateQueries({ queryKey: orpc.agent.threads.key() });
									setChoosingModel(false);
								} catch (error) {
									if (!(error instanceof DOMException && error.name === "AbortError"))
										toastError(error, t`Couldn't switch models. Try again.`);
								}
							}}
						>
							{item.label} · {item.model}
						</Button>
					))}
					<SetUpAi />
				</div>
			)}
			<CoachThread
				key={session}
				threadId={threadId}
				createThread={createThread}
				onThreadCreated={(id) => onConversationChange(id)}
				applicationId={application.id}
				company={application.company}
				context={context}
				connection={connection}
				onChangeConnection={() => setChoosingModel(!choosingModel)}
				header={() => null}
				empty={() => (
					<p className="text-sm text-ink-2">
						<Trans>
							Ask anything about this job. The coach reads the posting, your notes and what you sent, and knows you're
							on {tabName}.
						</Trans>
					</p>
				)}
				privacy={
					<PrivacyLine>
						{t`Sends your message, earlier messages in this chat, this application (posting, notes, documents, your form answers, the saved offer and recent messages) and Knowledge that's switched on to ${connection}.`}
					</PrivacyLine>
				}
				placeholder={t`Ask about this application…`}
				draftKey={`application:${application.id}`}
				disabled={!provider}
				variant="sheet"
			/>
		</>
	);
}

type ConversationMenuProps = {
	threads: ThreadSummary[];
	currentId: string | null;
	onOpen: (id: string) => void;
	onDelete: (thread: ThreadSummary) => void;
};

/** Earlier conversations about this job, and deleting the open one (with Undo). */
function ConversationMenu({ threads, currentId, onOpen, onDelete }: ConversationMenuProps) {
	const when = useConversationDate();
	const current = threads.find((thread) => thread.id === currentId);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<IconButton
						icon="clock-counter-clockwise"
						label={t`Conversations`}
						size="icon-sm"
						iconSize={20}
						className="text-ink-2"
					/>
				}
			/>
			<DropdownMenuContent align="end" className="w-72">
				{threads.map((thread) => (
					<DropdownMenuItem key={thread.id} onClick={() => onOpen(thread.id)}>
						<span className="grid min-w-0 flex-1">
							<span className="truncate">{titleFor(thread)}</span>
							<span className="text-xs text-ink-3">{when(new Date(thread.lastMessageAt))}</span>
						</span>
						{thread.id === currentId && <Icon name="check" size={16} />}
					</DropdownMenuItem>
				))}
				{current && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem variant="destructive" onClick={() => onDelete(current)}>
							<Icon name="trash" size={18} />
							<Trans>Delete this conversation</Trans>
						</DropdownMenuItem>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
