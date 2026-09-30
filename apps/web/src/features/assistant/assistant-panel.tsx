import type { ChatAttachment, MessageContext } from "./chat";
import type { AssistantDocument } from "./document";
import type { RouterOutput } from "@/libs/orpc/client";
import type { IconName } from "@reactive-resume/ui/components/icon";
import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { ORPCError } from "@orpc/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { Composer, Conversation } from "./conversation";
import { ProviderSetup } from "./provider-setup";
import { useEditorStore } from "@/features/resume/editor/store";
import { formatVersionTime } from "@/features/resume/share/format";
import { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import { useConfirm } from "@/hooks/use-confirm";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { ENTER_CLASS, stagger } from "@/libs/motion";
import { client, orpc } from "@/libs/orpc/client";

type UsableProvider = ReturnType<typeof useHasUsableAiProvider>["usableProviders"][number];
type ThreadSummary = RouterOutput["agent"]["threads"]["list"][number];

type AssistantPanelProps = {
	document: AssistantDocument;
	onClose: () => void;
};

const belongsTo = (thread: ThreadSummary, document: AssistantDocument) =>
	document.kind === "letter"
		? thread.coverLetterId === document.id
		: thread.workingResumeId === document.id && !thread.coverLetterId;

/**
 * The assistant beside the page: it knows the open document and the posting it's for, proposes edits that appear on
 * the page and as cards, and asks before writing anything the document doesn't say.
 */
export function AssistantPanel({ document, onClose }: AssistantPanelProps) {
	const queryClient = useQueryClient();
	const providers = useHasUsableAiProvider();
	const threads = useQuery(orpc.agent.threads.list.queryOptions());
	const selected = useEditorStore((state) => state.assistantThread);
	const setSelected = useEditorStore((state) => state.setAssistantThread);
	const prompt = useEditorStore((state) => state.assistantPrompt);
	const setPrompt = useEditorStore((state) => state.setAssistantPrompt);
	const [view, setView] = useState<"thread" | "history">("thread");
	const [providerId, setProviderId] = useState<string | null>(null);
	const [modelMenuOpen, setModelMenuOpen] = useState(false);
	const [starting, setStarting] = useState(false);
	const [context, setContext] = useState<MessageContext>({ document: true, posting: true });
	const [promptAttachments, setPromptAttachments] = useState<ChatAttachment[]>([]);
	const [draftKey, setDraftKey] = useState(0);
	const draftThread = useRef<string | null>(null);
	const creatingThread = useRef<Promise<string> | null>(null);

	const mine = (threads.data ?? []).filter((thread) => belongsTo(thread, document));
	// Opens the document's latest conversation unless a new one (or another) was asked for.
	const threadId = selected === "new" ? null : (selected ?? mine[0]?.id ?? null);
	const summary = threads.data?.find((item) => item.id === threadId);

	const usable = providers.usableProviders;
	const provider =
		usable.find((item) => item.id === (threadId ? summary?.aiProviderId : providerId)) ??
		(threadId ? undefined : usable[0]);
	const providerLabel = provider?.label ?? summary?.providerLabel ?? t`your provider`;

	const ensureThread = async (): Promise<string> => {
		if (draftThread.current) return draftThread.current;
		if (creatingThread.current) return creatingThread.current;
		// A list refetch must not auto-open this empty draft while its composer still holds unsent files.
		setSelected("new");
		const input = {
			...(document.kind === "letter" ? { coverLetterId: document.id } : { resumeId: document.id }),
			...(provider ? { aiProviderId: provider.id } : {}),
		};
		const creating = client.agent.threads.start(input).then((created) => {
			if (creatingThread.current === creating) draftThread.current = created.id;
			return created.id;
		});
		creatingThread.current = creating;
		try {
			return await creating;
		} finally {
			if (creatingThread.current === creating) creatingThread.current = null;
		}
	};

	const start = async (text: string, attachments: ChatAttachment[] = []) => {
		if (starting) return;
		setStarting(true);
		try {
			const id = await ensureThread();
			setPrompt(text);
			setPromptAttachments(attachments);
			setSelected(id);
			draftThread.current = null;
			useEditorStore.getState().setAssistantSuggestions(null);
			setView("thread");
			void queryClient.invalidateQueries({ queryKey: orpc.agent.threads.list.key() });
		} catch (error) {
			toast.add({
				type: "error",
				description: getOrpcErrorMessage(error, { fallback: t`Couldn't start the conversation. Try again.` }),
			});
		}
		setStarting(false);
	};

	// A question from ⌘K (or Prepare for next step) starts a conversation as soon as the assistant can.
	const autoStarted = useRef<string | null>(null);
	useEffect(() => {
		if (!prompt || selected !== "new" || !providers.hasUsableProvider || autoStarted.current === prompt) return;
		autoStarted.current = prompt;
		void start(prompt);
	});

	const chooseProvider = async (id: string) => {
		if (!threadId) setProviderId(id);
		const targetThreadId = threadId ?? draftThread.current;
		if (!targetThreadId) return;
		try {
			await client.agent.threads.update({ id: targetThreadId, aiProviderId: id });
			await queryClient.invalidateQueries({ queryKey: orpc.agent.threads.list.key() });
		} catch (error) {
			toast.add({ type: "error", description: getOrpcErrorMessage(error, { fallback: t`Couldn't switch models.` }) });
		}
	};

	const notSetUp =
		(threads.error instanceof ORPCError && threads.error.code === "PRECONDITION_FAILED") || Boolean(providers.error);

	return (
		<section aria-label={t`Assistant`} className="flex h-full min-h-0 flex-col bg-surface">
			<header className="flex h-[52px] shrink-0 items-center gap-1 border-b border-line ps-4 pe-2">
				<Icon name="auto_awesome" size={20} className="text-accent-text" />
				<h2 className="me-auto text-[15px] font-semibold">
					<Trans>Assistant</Trans>
				</h2>

				{usable.length > 0 && (
					<ModelMenu
						open={modelMenuOpen}
						onOpenChange={setModelMenuOpen}
						providers={usable}
						current={provider}
						label={providerLabel}
						onChoose={(id) => void chooseProvider(id)}
					/>
				)}

				<IconButton
					icon="edit_square"
					label={t`New conversation`}
					className="text-ink-2"
					onClick={() => {
						draftThread.current = null;
						creatingThread.current = null;
						setDraftKey((key) => key + 1);
						setContext({ document: true, posting: true });
						setPromptAttachments([]);
						setSelected("new");
						setView("thread");
					}}
				/>
				<IconButton
					icon="history"
					label={t`Past conversations`}
					aria-pressed={view === "history"}
					className={cn("text-ink-2", view === "history" && "bg-accent-soft text-accent-text")}
					onClick={() => setView(view === "history" ? "thread" : "history")}
				/>
				<IconButton
					icon="close"
					label={t`Close the assistant`}
					shortcut="⌘J"
					className="text-ink-2"
					onClick={onClose}
				/>
			</header>

			{notSetUp ? (
				<Notice>
					<Trans>
						The assistant isn't set up on this server. Whoever runs it needs to set ENCRYPTION_SECRET. Everything else
						works without it.
					</Trans>
				</Notice>
			) : providers.isLoading || threads.isPending ? (
				<div className="grid flex-1 place-items-center">
					<Spinner />
				</div>
			) : !providers.hasUsableProvider ? (
				<div className="min-h-0 flex-1 overflow-y-auto">
					<ProviderSetup />
				</div>
			) : view === "history" ? (
				<PastConversations
					threads={threads.data ?? []}
					document={document}
					currentId={threadId}
					onOpen={(id) => {
						setSelected(id);
						setView("thread");
					}}
				/>
			) : threadId ? (
				<ConversationLoader
					key={threadId}
					threadId={threadId}
					document={document}
					providerLabel={providerLabel}
					prompt={selected === threadId ? prompt : null}
					promptAttachments={promptAttachments}
					initialContext={{ ...context, ...(document.posting ? { applicationId: document.posting.id } : {}) }}
					onPromptSent={() => {
						setPrompt(null);
						setPromptAttachments([]);
					}}
					onSwitchModel={() => setModelMenuOpen(true)}
				/>
			) : (
				<>
					<EmptyState document={document} disabled={document.locked || starting} onPick={(text) => void start(text)} />
					<Composer
						key={draftKey}
						document={document}
						context={context}
						onContextChange={setContext}
						providerLabel={providerLabel}
						streaming={starting}
						disabled={document.locked}
						threadId={null}
						ensureThread={ensureThread}
						onSend={(text, attachments) => void start(text, attachments)}
						onStop={() => undefined}
					/>
				</>
			)}
		</section>
	);
}

type ConversationLoaderProps = {
	threadId: string;
	document: AssistantDocument;
	providerLabel: string;
	prompt: string | null;
	promptAttachments: ChatAttachment[];
	initialContext: MessageContext;
	onPromptSent: () => void;
	onSwitchModel: () => void;
};

/** Reads the conversation fresh each time it opens: the chat takes its messages once, when it mounts. */
function ConversationLoader({ threadId, document, ...props }: ConversationLoaderProps) {
	const thread = useQuery({
		...orpc.agent.threads.get.queryOptions({ input: { id: threadId } }),
		refetchOnMount: "always",
		refetchOnWindowFocus: false,
	});

	if (thread.error)
		return (
			<Notice>
				<Trans>This conversation couldn't be opened.</Trans>
			</Notice>
		);
	if (!thread.data || !thread.isFetchedAfterMount)
		return (
			// Hidden for the first 150ms, so a quick refetch never flashes a spinner.
			<div className="grid flex-1 place-items-center transition-opacity delay-150 duration-standard ease-enter starting:opacity-0">
				<Spinner />
			</div>
		);

	return (
		<Conversation
			threadId={threadId}
			initialMessages={thread.data.messages}
			activeRun={Boolean(thread.data.thread.activeRunId)}
			document={document}
			readOnly={thread.data.isReadOnly || document.locked}
			{...props}
		/>
	);
}

type ModelMenuProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	providers: readonly UsableProvider[];
	current: UsableProvider | undefined;
	label: string;
	onChoose: (id: string) => void;
};

function ModelMenu({ open, onOpenChange, providers, current, label, onChoose }: ModelMenuProps) {
	const navigate = useNavigate();

	return (
		<DropdownMenu open={open} onOpenChange={onOpenChange}>
			<DropdownMenuTrigger
				render={
					<button
						type="button"
						aria-label={t`Model: ${label}`}
						className="flex h-7 max-w-[140px] items-center gap-0.5 rounded-md px-2 text-xs text-ink-2 transition-colors hover:bg-hover"
					/>
				}
			>
				<span className="truncate">{current?.model ?? label}</span>
				<Icon name="expand_more" size={16} />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-64">
				{providers.map((item) => (
					<DropdownMenuItem key={item.id} onClick={() => onChoose(item.id)}>
						<span className="grid min-w-0 flex-1">
							<span className="truncate">{item.label}</span>
							<span className="truncate text-xs text-ink-3">{item.model}</span>
						</span>
						{item.id === current?.id && <Icon name="check" size={16} />}
					</DropdownMenuItem>
				))}
				<DropdownMenuSeparator />
				<DropdownMenuItem onClick={() => void navigate({ to: "/dashboard/settings/ai" })}>
					<Trans>Connect another…</Trans>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function Notice({ children }: { children: ReactNode }) {
	return <p className="m-4 rounded-xl bg-sunken p-4 text-sm text-ink-2">{children}</p>;
}

type Suggestion = { icon: IconName; label: string; hint: string };

function suggestionsFor(document: AssistantDocument, prepare: boolean): Suggestion[] {
	const tailor: Suggestion[] = document.posting
		? [
				{
					icon: "work",
					label: t`Tailor to the ${document.posting.company} posting`,
					hint: t`Uses the linked application`,
				},
			]
		: [];

	// Prepare for next step: the application's fit, a follow-up and the interview (what the copilot did).
	if (prepare && document.posting)
		return [
			{ icon: "work", label: t`How well do I fit this role?`, hint: t`Compares your resume with the posting` },
			{ icon: "mail", label: t`Draft a follow-up email`, hint: t`Short and polite, for the recruiter` },
			{
				icon: "chat",
				label: t`Prepare me for the interview`,
				hint: t`Likely questions, from the posting and your resume`,
			},
			...tailor,
		];

	if (document.kind === "letter")
		return [
			...tailor,
			{ icon: "bolt", label: t`Make the opening stronger`, hint: t`Leads with why you fit` },
			{ icon: "compress", label: t`Make it shorter`, hint: t`Keeps the most specific parts` },
			{ icon: "short_text", label: t`Make it more specific`, hint: t`Uses facts from your resume` },
		];

	return [
		...tailor,
		{ icon: "content_cut", label: t`Find weak bullets`, hint: t`Checks every bullet for action and result` },
		{ icon: "vertical_align_center", label: t`Tighten to one page`, hint: t`Suggests cuts, never deletes on its own` },
		{ icon: "short_text", label: t`Draft a summary`, hint: t`From your experience entries` },
	];
}

type EmptyStateProps = { document: AssistantDocument; disabled: boolean; onPick: (text: string) => void };

function EmptyState({ document, disabled, onPick }: EmptyStateProps) {
	const kind = document.kind === "letter" ? t`letter` : t`resume`;
	const prepare = useEditorStore((state) => state.assistantSuggestions === "prepare");

	return (
		<div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4">
			<div className="grid gap-1.5">
				<h3 className="font-display text-[22px] leading-7 font-medium">
					<Trans>What should we work on?</Trans>
				</h3>
				<p className="text-sm text-ink-2">
					{document.posting ? (
						<Trans>
							I can see this {kind} and the {document.posting.company} posting. Suggestions come back as edits you can
							accept one by one.
						</Trans>
					) : (
						<Trans>I can see this {kind}. Suggestions come back as edits you can accept one by one.</Trans>
					)}
				</p>
				{document.locked && (
					<p className="text-xs text-warn-text">
						<Trans>This document is locked. Unlock it to get suggestions.</Trans>
					</p>
				)}
			</div>
			<ul className="grid gap-1">
				{suggestionsFor(document, prepare).map((suggestion, index) => (
					<li key={suggestion.label} style={stagger(index)} className={ENTER_CLASS}>
						<button
							type="button"
							disabled={disabled}
							onClick={() => onPick(suggestion.label)}
							className="flex min-h-11 w-full items-center gap-3 rounded-lg border border-line px-3 py-2 text-start transition-[background-color,scale] duration-quick ease-enter hover:bg-hover enabled:active:scale-[0.98] disabled:opacity-60"
						>
							<Icon name={suggestion.icon} size={20} className="shrink-0 text-ink-2" />
							<span className="grid min-w-0">
								<span className="truncate text-sm font-medium">{suggestion.label}</span>
								<span className="truncate text-xs text-ink-3">{suggestion.hint}</span>
							</span>
						</button>
					</li>
				))}
			</ul>
		</div>
	);
}

type PastConversationsProps = {
	threads: readonly ThreadSummary[];
	document: AssistantDocument;
	currentId: string | null;
	onOpen: (id: string) => void;
};

/** D3: conversations grouped by document, titled by their task, with what came of them. */
function PastConversations({ threads, document, currentId, onOpen }: PastConversationsProps) {
	const { i18n } = useLingui();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const confirm = useConfirm();
	const mine = threads.filter((thread) => belongsTo(thread, document));
	const others = threads.filter(
		(thread) => !belongsTo(thread, document) && (thread.workingResumeId || thread.coverLetterId),
	);

	const outcome = (thread: ThreadSummary) =>
		thread.editsProposed === 0 ? t`no edits` : t`${thread.editsAccepted} of ${thread.editsProposed} edits accepted`;

	const open = (thread: ThreadSummary) => {
		if (belongsTo(thread, document)) return onOpen(thread.id);
		// Another document's conversation opens that document, with the assistant on it.
		if (thread.coverLetterId)
			void navigate({
				to: "/builder/letter/$coverLetterId",
				params: { coverLetterId: thread.coverLetterId },
				search: { assistant: thread.id },
			});
		else if (thread.workingResumeId)
			void navigate({
				to: "/builder/$resumeId",
				params: { resumeId: thread.workingResumeId },
				search: { assistant: thread.id },
			});
	};

	const remove = async (thread: ThreadSummary) => {
		const confirmed = await confirm(t`Delete this conversation?`, {
			description: t`Its messages and attachments are deleted. Edits you accepted stay in the document.`,
			confirmText: t`Delete`,
		});
		if (!confirmed) return;
		try {
			await client.agent.threads.delete({ id: thread.id });
			await queryClient.invalidateQueries({ queryKey: orpc.agent.threads.list.key() });
			if (thread.id === currentId) useEditorStore.getState().setAssistantThread("new");
		} catch (error) {
			toast.add({ type: "error", description: getOrpcErrorMessage(error, { fallback: t`Couldn't delete it.` }) });
		}
	};

	return (
		<div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-3">
			<section aria-labelledby="assistant-this-document" className="grid gap-1">
				<h3 id="assistant-this-document" className="px-3 text-xs font-semibold text-ink-3 uppercase">
					<Trans>This document</Trans>
				</h3>
				{mine.length > 0 ? (
					<ul className="grid">
						{mine.map((thread, index) => (
							<ConversationRow
								key={thread.id}
								index={index}
								thread={thread}
								current={thread.id === currentId}
								detail={`${formatVersionTime(new Date(thread.lastMessageAt), i18n.locale)} · ${outcome(thread)}`}
								onOpen={() => open(thread)}
								onDelete={() => void remove(thread)}
							/>
						))}
					</ul>
				) : (
					<p className="px-3 text-sm text-ink-2">
						<Trans>No conversations about this document yet.</Trans>
					</p>
				)}
			</section>
			{others.length > 0 && (
				<section aria-labelledby="assistant-other-documents" className="grid gap-1">
					<h3 id="assistant-other-documents" className="px-3 text-xs font-semibold text-ink-3 uppercase">
						<Trans>Other documents · {others.length}</Trans>
					</h3>
					<ul className="grid">
						{others.map((thread, index) => (
							<ConversationRow
								key={thread.id}
								index={mine.length + index}
								thread={thread}
								current={false}
								detail={`${formatVersionTime(new Date(thread.lastMessageAt), i18n.locale)} · ${outcome(thread)} · ${thread.coverLetterName ?? thread.resumeName ?? ""}`}
								onOpen={() => open(thread)}
								onDelete={() => void remove(thread)}
							/>
						))}
					</ul>
				</section>
			)}
		</div>
	);
}

type ConversationRowProps = {
	thread: ThreadSummary;
	current: boolean;
	detail: string;
	index: number;
	onOpen: () => void;
	onDelete: () => void;
};

function ConversationRow({ thread, current, detail, index, onOpen, onDelete }: ConversationRowProps) {
	return (
		<li
			style={stagger(index)}
			// cn keeps the last transition list, so the hover colour is named again after ENTER_CLASS's.
			className={cn(
				"group/row flex items-center gap-1 rounded-lg hover:bg-hover",
				ENTER_CLASS,
				"transition-[opacity,translate,background-color]",
			)}
		>
			<button
				type="button"
				aria-current={current ? "true" : undefined}
				onClick={onOpen}
				className={cn(
					"grid min-w-0 flex-1 rounded-lg px-3 py-2 text-start transition-colors duration-quick ease-enter active:bg-press",
					current && "bg-sunken",
				)}
			>
				<span className="truncate text-sm font-medium">{thread.title}</span>
				<span className="truncate text-xs text-ink-3">{detail}</span>
			</button>
			<IconButton
				icon="close"
				label={t`Delete ${thread.title}`}
				size="icon-sm"
				className="me-1 text-ink-3 opacity-0 transition-[opacity,background-color,border-color,color,filter,scale] group-hover/row:opacity-100 focus-visible:opacity-100"
				onClick={onDelete}
			/>
		</li>
	);
}
