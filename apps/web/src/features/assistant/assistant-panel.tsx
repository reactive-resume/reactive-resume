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
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { measureOverflow } from "@reactive-resume/pdf/page-map";
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
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { cn } from "@reactive-resume/utils/style";
import { ConnectionNotice } from "./connection-notice";
import { Composer, Conversation } from "./conversation";
import { ProviderSetup, SetUpAi } from "./provider-setup";
import { useResumeStore } from "@/features/resume/builder/draft";
import { useUnlockResume } from "@/features/resume/builder/use-unlock-resume";
import { useEditorStore } from "@/features/resume/editor/store";
import { formatVersionTime } from "@/features/resume/share/format";
import { AiProviderLoadState } from "@/features/settings/integrations/ai-provider-load-state";
import { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import { useConfirm } from "@/hooks/use-confirm";
import { toastError } from "@/libs/error-message";
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
	const navigate = useNavigate();
	const search = useSearch({ strict: false });
	const queryClient = useQueryClient();
	const providers = useHasUsableAiProvider();
	const threads = useQuery(orpc.agent.threads.list.queryOptions());
	const selected = useEditorStore((state) => state.assistantThread);
	const prompt = useEditorStore((state) => state.assistantPrompt);
	const draft = useEditorStore((state) => state.assistantDraft);
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
	// A conversation runs on its own connection. One switched off or removed is never swapped silently: the user picks
	// another before the next message goes anywhere. A new conversation starts on the account default (listed first).
	const saved = threadId ? usable.find((item) => item.id === summary?.aiProviderId) : undefined;
	const stranded = threadId !== null && summary !== undefined && saved === undefined && !providers.isLoading;
	const provider = threadId ? saved : (usable.find((item) => item.id === providerId) ?? usable[0]);
	const providerLabel = provider?.label ?? summary?.providerLabel ?? t`your provider`;

	const ensureThread = async (): Promise<string> => {
		if (draftThread.current) return draftThread.current;
		if (creatingThread.current) return creatingThread.current;
		// A list refetch must not auto-open this empty draft while its composer still holds unsent files.
		useEditorStore.setState({ assistantThread: "new" });
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
			useEditorStore.setState({ assistantPrompt: text, assistantDraft: null });
			setPromptAttachments(attachments);
			useEditorStore.setState({ assistantThread: id });
			draftThread.current = null;
			useEditorStore.setState({ assistantSuggestions: null });
			setView("thread");
			void queryClient.invalidateQueries({ queryKey: orpc.agent.threads.list.key() });
		} catch (error) {
			toastError(error, t`Couldn't start the conversation. Try again.`);
		}
		setStarting(false);
	};

	// A question from ⌘K or Job match starts a conversation as soon as the assistant can. A link's draft never does.
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
			toastError(error, t`Couldn't switch models. Try again.`);
		}
	};

	const notSetUp = threads.error instanceof ORPCError && threads.error.code === "PRECONDITION_FAILED";

	return (
		<section aria-label={t`Assistant`} className="flex h-full min-h-0 flex-col bg-surface">
			<header className="flex h-[52px] shrink-0 items-center gap-1 border-b border-line ps-4 pe-2">
				<Icon name="sparkle" size={20} className="text-accent-text" />
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
					icon="note-pencil"
					label={t`New conversation`}
					className="text-ink-2"
					onClick={() => {
						draftThread.current = null;
						creatingThread.current = null;
						setDraftKey((key) => key + 1);
						setContext({ document: true, posting: true });
						setPromptAttachments([]);
						useEditorStore.setState({ assistantDraft: null, assistantThread: "new" });
						setView("thread");
					}}
				/>
				<IconButton
					icon="clock-counter-clockwise"
					label={t`Past conversations`}
					aria-pressed={view === "history"}
					className={cn("text-ink-2", view === "history" && "bg-accent-soft text-accent-text")}
					onClick={() => setView(view === "history" ? "thread" : "history")}
				/>
				<IconButton icon="x" label={t`Close the assistant`} shortcut="⌘J" className="text-ink-2" onClick={onClose} />
			</header>

			{document.kind === "resume" && (
				<div className="grid gap-2 border-b border-line p-4 text-xs text-ink-2">
					<p>
						<Trans>
							I can edit your summary, bullets and text fields, and add entries and sections. Review each set before
							accepting it together. Some fields still need Write. I can't translate a whole resume.
						</Trans>
					</p>
					<Button
						size="sm"
						variant="ghost"
						onClick={() => {
							useEditorStore.setState({ mobileView: "write", drawerOpen: true });
							onClose();
							void navigate({
								to: "/builder/$resumeId",
								params: { resumeId: document.id },
								search: { ...search, mode: undefined, assistant: undefined },
							});
						}}
					>
						<Trans>Open Write</Trans>
					</Button>
				</div>
			)}
			{threadId && !provider && (
				<Notice>
					<Trans>
						This conversation's AI connection is unavailable. Its history stays here. Fix the saved connection or choose
						a model before sending again.
					</Trans>
					<SetUpAi />
				</Notice>
			)}
			{notSetUp ? (
				<Notice>
					<Trans>
						The assistant isn't set up on this server. Whoever runs it needs to set ENCRYPTION_SECRET. Everything else
						works without it.
					</Trans>
				</Notice>
			) : providers.error && view !== "history" && !threadId ? (
				<AiProviderLoadState
					state={{
						...providers,
						retry: () => {
							providers.retry();
							void threads.refetch();
						},
					}}
				/>
			) : (providers.isLoading && view !== "history" && !threadId) || threads.isPending ? (
				<div className="grid flex-1 place-items-center">
					<Spinner />
				</div>
			) : !providers.hasUsableProvider && view !== "history" && !threadId ? (
				<div className="min-h-0 flex-1 overflow-y-auto">
					<ProviderSetup />
				</div>
			) : view === "history" ? (
				<PastConversations
					threads={threads.data ?? []}
					document={document}
					currentId={threadId}
					onOpen={(id) => {
						useEditorStore.setState({ assistantThread: id });
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
						useEditorStore.setState({ assistantPrompt: null });
						setPromptAttachments([]);
					}}
					onSwitchModel={() => setModelMenuOpen(true)}
					destinationUnavailable={!provider}

					{...(stranded
						? {
								notice: (
									<ConnectionNotice
										label={summary?.providerLabel ?? null}
										fallback={usable[0]}
										onUse={(id) => void chooseProvider(id)}
										onChoose={() => setModelMenuOpen(true)}
									/>
								),
							}
						: {})}
				/>
			) : (
				<>
					<EmptyState document={document} disabled={starting} onPick={(text) => void start(text)} />
					<Composer
						// A draft arriving while the box is open replaces what's in it.
						key={`${draftKey}:${draft ?? ""}`}
						initialText={draft ?? undefined}
						document={document}
						context={context}
						onContextChange={setContext}
						providerLabel={providerLabel}
						streaming={starting}
						disabled={false}
						notice={document.locked ? <LockedNotice document={document} /> : undefined}
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
	destinationUnavailable: boolean;

	notice?: ReactNode;
};

/** Reads the conversation fresh each time it opens: the chat takes its messages once, when it mounts. */
function ConversationLoader({ threadId, document, destinationUnavailable, ...props }: ConversationLoaderProps) {
	const thread = useQuery({
		...orpc.agent.threads.get.queryOptions({ input: { id: threadId } }),
		refetchOnMount: "always",
		refetchOnWindowFocus: false,
	});

	if (thread.error)
		return (
			<Notice>
				<Trans>This conversation couldn't be opened. Refresh the page to try again.</Trans>
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
			readOnly={thread.data.isReadOnly || destinationUnavailable}
			localEditsLocked={document.locked || !thread.data.document}
			{...props}
			// A locked document still takes questions; the banner says why edits wait, with Unlock.
			banner={document.locked ? <LockedNotice document={document} /> : undefined}
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
				<Icon name="caret-down" size={16} />
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
	return <div className="m-4 rounded-xl bg-sunken p-4 text-sm text-ink-2">{children}</div>;
}

/** `prompt` is what's sent when it differs from the label (the measured overflow goes with Tighten). */
/** `edits: false` for tasks that answer or draft rather than edit, which a locked document still takes. */
type Suggestion = { icon: IconName; label: string; hint: string; prompt?: string; edits?: false };

/** The page's overflow as last drawn; undefined before the page has been drawn. */
type Overflow = ReturnType<typeof measureOverflow> | undefined;

/** Tighten asks with the page's real overflow, so the reply can say honestly whether text edits close it. */
function tightenPrompt(overflow: Overflow) {
	if (overflow === undefined) return t`Tighten to one page`;
	if (!overflow) return t`Tighten to one page. It fits within the planned pages, so only cut what's weak.`;
	const first = overflow.spills[0];
	if (first && first.pages.length === 1 && first.lines) {
		const page = first.authoredPage;
		const lines = first.lines;
		return t`Tighten to one page. Page ${page} runs over by about ${lines} lines.`;
	}
	const count = overflow.pageCount;
	return t`Tighten to one page. It currently runs to ${count} pages.`;
}

function suggestionsFor(document: AssistantDocument, prepare: boolean, overflow?: Overflow): Suggestion[] {
	const tailor: Suggestion[] = document.posting
		? [
				{
					icon: "briefcase",
					label: t`Tailor to the ${document.posting.company} posting`,
					hint: t`Uses the linked application`,
				},
			]
		: [];

	// Prepare for next step: the application's fit, a follow-up and the interview (what the copilot did).
	if (prepare && document.posting)
		return [
			{
				icon: "briefcase",
				label: t`How well do I fit this role?`,
				hint: t`Compares your resume with the posting`,
				edits: false,
			},
			{
				icon: "envelope-simple",
				label: t`Draft a follow-up email`,
				hint: t`Short and polite, for the recruiter`,
				edits: false,
			},
			{
				icon: "chat-text",
				label: t`Prepare me for the interview`,
				hint: t`Likely questions, from the posting and your resume`,
				edits: false,
			},
			...tailor,
		];

	if (document.kind === "letter")
		return [
			...tailor,
			{ icon: "lightning", label: t`Make the opening stronger`, hint: t`Leads with why you fit` },
			{ icon: "arrows-in-line-vertical", label: t`Make it shorter`, hint: t`Keeps the most specific parts` },
			{ icon: "text-align-left", label: t`Make it more specific`, hint: t`Uses facts from your resume` },
		];

	return [
		...tailor,
		{ icon: "scissors", label: t`Find weak bullets`, hint: t`Checks every bullet for action and result`, edits: false },
		{
			icon: "arrows-in-line-vertical",
			label: t`Tighten to one page`,
			hint: t`Suggests cuts, never deletes on its own`,
			prompt: tightenPrompt(overflow),
		},
		{ icon: "text-align-left", label: t`Draft a summary`, hint: t`From your experience entries` },
	];
}

type EmptyStateProps = { document: AssistantDocument; disabled: boolean; onPick: (text: string) => void };

/** Above the composer on a locked document: questions still work, edits wait for Unlock. */
function LockedNotice({ document }: { document: AssistantDocument }) {
	return (
		<p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-info-soft px-3 py-2 text-xs text-info-text">
			<Icon name="lock" size={16} className="shrink-0" />
			<span className="flex-1">
				<Trans>Locked. I can answer questions; unlock to get edits.</Trans>
			</span>
			{document.kind === "resume" && <UnlockButton />}
		</p>
	);
}

function UnlockButton() {
	const { unlock, isPending } = useUnlockResume();
	return (
		<Button size="sm" variant="secondary" loading={isPending} onClick={unlock} aria-label={t`Unlock editing`}>
			<Trans>Unlock</Trans>
		</Button>
	);
}

function EmptyState({ document, disabled, onPick }: EmptyStateProps) {
	const kind = document.kind === "letter" ? t`letter` : t`resume`;
	const prepare = useEditorStore((state) => state.assistantSuggestions === "prepare");
	const rendered = useEditorStore((state) => state.rendered);
	const data = useResumeStore((state) => state.resume?.data);
	const overflow =
		document.kind === "resume" && data && rendered.pageCount > 0 ? measureOverflow(data, rendered) : undefined;

	return (
		<div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4">
			<div className="grid gap-1.5">
				<h3 className="font-display text-[22px] leading-7 font-medium">
					<Trans>What should we work on?</Trans>
				</h3>
				<p className="text-sm text-ink-2">
					{prepare && document.posting ? (
						// These tasks answer and draft; none of them edits the document.
						<Trans>
							I can see this {kind} and the {document.posting.company} posting. Ask how you fit, or get a follow-up
							email or interview prep.
						</Trans>
					) : document.posting ? (
						<Trans>
							I can see this {kind} and the {document.posting.company} posting. Suggestions come back as edits you can
							review before accepting.
						</Trans>
					) : (
						<Trans>I can see this {kind}. Suggestions come back as edits you can review before accepting.</Trans>
					)}
				</p>
			</div>
			<ul className="grid gap-1">
				{suggestionsFor(document, prepare, overflow).map((suggestion, index) => (
					<li key={suggestion.label} style={stagger(index)} className={ENTER_CLASS}>
						<button
							type="button"
							// On a locked document, only the tasks that answer rather than edit can start.
							disabled={disabled || (document.locked && suggestion.edits !== false)}
							onClick={() => onPick(suggestion.prompt ?? suggestion.label)}
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
			confirmText: t`Delete conversation`,
		});
		if (!confirmed) return;
		try {
			await client.agent.threads.delete({ id: thread.id });
			await queryClient.invalidateQueries({ queryKey: orpc.agent.threads.list.key() });
			if (thread.id === currentId) useEditorStore.setState({ assistantThread: "new" });
		} catch (error) {
			toastError(error, t`Couldn't delete this conversation. Try again.`);
		}
	};

	return (
		<div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-3">
			<section aria-labelledby="assistant-this-document" className="grid gap-1">
				<h3 id="assistant-this-document" className="px-3 text-xs font-semibold text-ink-3">
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
					<h3 id="assistant-other-documents" className="px-3 text-xs font-semibold text-ink-3">
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
				icon="x"
				label={t`Delete ${thread.title}`}
				size="icon-sm"
				className="me-1 text-ink-3 opacity-0 transition-[opacity,background-color,border-color,color,filter,scale] group-hover/row:opacity-100 focus-visible:opacity-100"
				onClick={onDelete}
			/>
		</li>
	);
}
