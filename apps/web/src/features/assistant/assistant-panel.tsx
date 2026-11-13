import type { ChatAttachment, MessageContext } from "./chat";
import type { AssistantDocument } from "./document";
import type { RouterOutput } from "@/libs/orpc/client";
import type { IconName } from "@reactive-resume/ui/components/icon";
import type { ReactNode } from "react";
import { i18n } from "@lingui/core";
import { ph, plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { ORPCError } from "@orpc/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { measureOverflow } from "@reactive-resume/pdf/page-map";
import { lintResumeForAts } from "@reactive-resume/resume/ats";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { cn } from "@reactive-resume/utils/style";
import { acceptOnCopy } from "./accept-on-copy";
import { ChatWelcome, ModelMenu } from "./chat-chrome";
import { ConnectionNotice } from "./connection-notice";
import { Composer, Conversation } from "./conversation";
import { TranslateResume } from "./translate-resume";
import { ListRow } from "@/components/calm/list-row";
import { SetUpAiLine } from "@/components/calm/set-up-ai-line";
import { useDialogStore } from "@/dialogs/store";
import { useSetUpAi } from "@/features/ai/set-up-ai";
import { applicationsListQueryOptions } from "@/features/applications/queries";
import { useResumeStore } from "@/features/resume/builder/draft";
import { useUnlockResume } from "@/features/resume/builder/use-unlock-resume";
import { buildIssues } from "@/features/resume/editor/check/issues";
import { useEditorStore } from "@/features/resume/editor/store";
import { formatVersionTime } from "@/features/resume/share/format";
import { AiProviderLoadState } from "@/features/settings/integrations/ai-provider-load-state";
import { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import { useConfirm } from "@/hooks/use-confirm";
import { toastError } from "@/libs/error-message";
import { ENTER_CLASS, stagger } from "@/libs/motion";
import { client, orpc } from "@/libs/orpc/client";

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
	const prompt = useEditorStore((state) => state.assistantPrompt);
	const draft = useEditorStore((state) => state.assistantDraft);
	const [view, setView] = useState<"thread" | "history">("thread");
	const setUp = useSetUpAi();

	const [translating, setTranslating] = useState(false);
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
	const menuLabel = stranded ? t`Choose a connection` : providerLabel;
	// The resume this conversation started on, once it moved to a copy (its first accepted edit).
	const original =
		document.kind === "resume" &&
		summary?.workingResumeId === document.id &&
		summary.sourceResumeId &&
		summary.sourceResumeId !== document.id
			? summary.sourceResumeId
			: null;

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
		<section aria-label={t`Assistant`} className="relative flex h-full min-h-0 flex-col bg-surface">
			<header className="flex shrink-0 items-center gap-1.5 ps-6 pe-2.5 pt-[11px]">
				<Icon name="sparkle" size={20} className="me-0.5 text-accent-text" />
				<h2 className="me-1 t-page-title">
					<Trans>Assistant</Trans>
				</h2>

				{(providers.providers.length > 0 || summary) && (
					<ModelMenu
						open={modelMenuOpen}
						onOpenChange={setModelMenuOpen}
						providers={providers.providers}
						current={provider}
						label={menuLabel}
						onChoose={(id) => void chooseProvider(id)}
						onConnect={() => setUp.open()}
					/>
				)}

				<span className="ms-auto flex shrink-0 items-center">
					{providers.hasUsableProvider && (
						<IconButton
							icon="chats"
							label={t`Conversations`}
							size="icon-sm"
							aria-pressed={view === "history"}
							className={cn("text-ink-2", view === "history" && "bg-accent-soft text-accent-text")}
							onClick={() => setView(view === "history" ? "thread" : "history")}
						/>
					)}
					<IconButton
						icon="x"
						label={t`Close the assistant`}
						shortcut="⌘J"
						// Alone in the header without AI, the close button is the full 36.
						size={providers.hasUsableProvider ? "icon-sm" : "icon"}
						className="text-ink-2"
						onClick={onClose}
					/>
				</span>
			</header>
			{setUp.dialog}

			{providers.hasUsableProvider && view !== "history" && (
				<p className="mx-6 flex items-center gap-2.5 border-b border-line pt-[13px] pb-3 text-[13px]/[18px] text-ink-2">
					<Icon
						name={(original || document.madeFor) && document.kind === "resume" ? "copy" : "clock-counter-clockwise"}
						size={16}
						className="mt-px shrink-0 self-start text-ink-3"
					/>
					{document.kind === "letter" ? (
						<Trans>Accepted edits change this letter; history keeps each version.</Trans>
					) : original ? (
						<CopyLine original={original} company={document.posting?.company} />
					) : document.madeFor && document.posting ? (
						<Trans>Working on a copy made for {document.posting.company}: the resume it came from is unchanged.</Trans>
					) : (
						<Trans>Nothing changes until you accept an edit.</Trans>
					)}
				</p>
			)}
			{translating && document.kind === "resume" && (
				<TranslateResume resumeId={document.id} onClose={() => setTranslating(false)} />
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
				<WithoutAi document={document} onSetUp={setUp.open} onClose={onClose} />
			) : view === "history" ? (
				<PastConversations
					onNew={() => {
						draftThread.current = null;
						creatingThread.current = null;
						setDraftKey((key) => key + 1);
						setContext({ document: true, posting: true });
						setPromptAttachments([]);
						useEditorStore.setState({ assistantDraft: null, assistantThread: "new" });
						setView("thread");
					}}
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
					{draft?.trim() ? (
						<div className="min-h-0 flex-1" />
					) : (
						<EmptyState
							document={document}
							disabled={starting}
							onPick={(text) => void start(text)}
							onTranslate={() => setTranslating(true)}
						/>
					)}

					<Composer
						notice={document.locked ? <LockedNotice document={document} /> : undefined}
						// A draft arriving while the box is open replaces what's in it.
						key={`${draftKey}:${draft ?? ""}`}
						initialText={draft ?? undefined}
						document={document}
						context={context}
						onContextChange={setContext}
						streaming={starting}
						disabled={false}
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
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const thread = useQuery({
		...orpc.agent.threads.get.queryOptions({ input: { id: threadId } }),
		refetchOnMount: "always",
		refetchOnWindowFocus: false,
	});
	// The assistant never edits a resume a conversation started on: its first accepted edit makes a copy and lands there.
	const summary = thread.data?.thread;
	const copyFirst =
		document.kind === "resume" &&
		!document.madeFor &&
		summary?.workingResumeId === document.id &&
		summary.sourceResumeId === document.id;
	const working = useMemo<AssistantDocument>(
		() =>
			copyFirst
				? {
						...document,
						accept: (proposals) => {
							void acceptOnCopy({
								threadId,
								resumeId: document.id,
								posting: document.posting,
								proposals,
								queryClient,
								open: (copyId) =>
									navigate({
										to: "/builder/$resumeId",
										params: { resumeId: copyId },
										search: { assistant: threadId },
									}),
							});
							// Recorded by the copy's save once it's applied there.
							return { applied: [], stale: [] };
						},
					}
				: document,
		[copyFirst, document, threadId, queryClient, navigate],
	);

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
			interrupted={thread.data.interrupted ?? []}
			initialAttachments={(thread.data.attachments ?? []).filter(
				(file) => !file.messageId && !props.promptAttachments.some((sent) => sent.id === file.id),
			)}
			activeRun={Boolean(thread.data.thread.activeRunId)}
			document={working}
			readOnly={thread.data.isReadOnly || destinationUnavailable}
			localEditsLocked={document.locked || !thread.data.document}
			{...props}
			// A locked document still takes questions; the banner says why edits wait, with Unlock.
			banner={document.locked ? <LockedNotice document={document} /> : undefined}
		/>
	);
}

/** "Working on a copy", with the resume it came from one link away. */
function CopyLine({ original, company }: { original: string; company: string | undefined }) {
	// Usually cached: the builder had it open just before the copy.
	const { data } = useQuery(orpc.resume.getById.queryOptions({ input: { id: original } }));
	const name = data?.name;
	return (
		<span className="flex flex-1 flex-wrap items-start justify-between gap-x-3 gap-y-1">
			<span>
				{company && name ? (
					<Trans>
						Working on a copy made for {company}: {name} is unchanged.
					</Trans>
				) : company ? (
					<Trans>Working on a copy made for {company}: the resume it came from is unchanged.</Trans>
				) : name ? (
					<Trans>Working on a copy. {name} is unchanged.</Trans>
				) : (
					<Trans>Working on a copy. The resume it came from is unchanged.</Trans>
				)}
			</span>
			<Link
				to="/builder/$resumeId"
				params={{ resumeId: original }}
				className="font-medium text-accent-text hover:underline"
			>
				<Trans>Open original</Trans>
			</Link>
		</span>
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
		return t`Tighten to one page. Page ${ph({ page: i18n.number(page) })} runs over by about ${ph({ lines: i18n.number(lines) })} lines.`;
	}
	const count = overflow.pageCount;
	return t`Tighten to one page. It currently runs to ${ph({ count: i18n.number(count) })} pages.`;
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
			// After a draft was accepted, the one way back to a fresh draft: proposals for the whole letter.
			...(document.posting
				? [
						{
							icon: "sparkle" as const,
							label: t`Redraft from the posting`,
							hint: t`A new version of the whole letter, as edits to accept`,
						},
					]
				: []),
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

type EmptyStateProps = {
	document: AssistantDocument;
	disabled: boolean;
	onPick: (text: string) => void;
	onTranslate: () => void;
};

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

function EmptyState({ document, disabled, onPick, onTranslate }: EmptyStateProps) {
	const kind = document.kind === "letter" ? t`letter` : t`resume`;
	const prepare = useEditorStore((state) => state.assistantSuggestions === "prepare");
	const rendered = useEditorStore((state) => state.fitRendered);
	const data = useResumeStore((state) => state.resume?.data);
	const overflow =
		document.kind === "resume" && data && rendered.pageCount > 0 ? measureOverflow(data, rendered) : undefined;

	return (
		<div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-4">
			<ChatWelcome
				description={
					<>
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
					</>
				}
				starters={suggestionsFor(document, prepare, overflow).map((suggestion) => ({
					...suggestion,
					disabled: disabled || (document.locked && suggestion.edits !== false),
					onPick: () => onPick(suggestion.prompt ?? suggestion.label),
				}))}
			/>
			{document.kind === "resume" && (
				<button
					type="button"
					onClick={onTranslate}
					className="mt-3 text-[13px]/[18px] font-medium text-accent-text hover:underline"
				>
					<Trans>Translate into another language…</Trans>
				</button>
			)}
		</div>
	);
}

type PastConversationsProps = {
	threads: readonly ThreadSummary[];
	document: AssistantDocument;
	currentId: string | null;
	onOpen: (id: string) => void;
	onNew: () => void;
};

/** D3: conversations grouped by document, titled by their task, with what came of them. */
function PastConversations({ threads, document, currentId, onOpen, onNew }: PastConversationsProps) {
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
		<div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pt-3 pb-4">
			<div className="flex items-center justify-between gap-3 ps-3 pe-0">
				<h3 className="text-[15px]/[22px] font-semibold">
					<Trans>Conversations</Trans>
				</h3>
				<Button size="sm" variant="secondary" onClick={onNew}>
					<Icon name="note-pencil" />
					<Trans>New conversation</Trans>
				</Button>
			</div>
			<section aria-labelledby="assistant-this-document" className="grid gap-1">
				<h3 id="assistant-this-document" className="px-3 text-[13px]/[18px] text-ink-3">
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
					<h3 id="assistant-other-documents" className="px-3 text-[13px]/[18px] text-ink-3">
						<Trans>Other documents · {i18n.number(others.length)}</Trans>
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
			<p className="px-3 text-[13px]/[18px] text-ink-3">
				<Trans>
					A conversation from another document opens that document. Deleting one removes its messages and files; edits
					you accepted stay.
				</Trans>
			</p>
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

/** A request remains recognizable even when its proposed edits give the conversation a new title. */
function ConversationRow({ thread, current, detail, index, onOpen, onDelete }: ConversationRowProps) {
	return (
		<li
			style={stagger(index)}
			// cn keeps the last transition list, so the hover colour is named again after ENTER_CLASS's.
			className={cn(
				"group/row flex items-center gap-1 rounded-lg hover:bg-hover has-[[aria-current]]:bg-sunken",
				ENTER_CLASS,
				"transition-[opacity,translate,background-color]",
			)}
		>
			<button
				type="button"
				aria-current={current ? "true" : undefined}
				onClick={onOpen}
				className={cn(
					"grid min-w-0 flex-1 rounded-lg px-3 py-2.5 text-start transition-colors duration-quick ease-enter active:bg-press",
				)}
			>
				<span className="truncate text-[15px]/[22px] font-medium">{thread.title}</span>
				{thread.firstMessage && <span className="truncate text-sm/5 text-ink-2">{thread.firstMessage}</span>}
				<span className="truncate text-[13px]/[18px] text-ink-3">{detail}</span>
			</button>
			<IconButton
				icon="x"
				label={t`Delete ${thread.title}`}
				size="icon-sm"
				className="me-2 text-ink-3 opacity-0 transition-[opacity,background-color,border-color,color,filter,scale] group-hover/row:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
				onClick={onDelete}
			/>
		</li>
	);
}

type WithoutAiProps = { document: AssistantDocument; onSetUp: () => void; onClose: () => void };

/** N1: no connection. The Set up AI line, then what works on this document without AI, one click away. */
function WithoutAi({ document, onSetUp, onClose }: WithoutAiProps) {
	return (
		<div className="min-h-0 flex-1 overflow-y-auto px-6 pt-[11px] pb-6">
			<SetUpAiLine lead={<Trans>The assistant needs AI.</Trans>} onSetUp={onSetUp}>
				<Trans>Everything below works without it.</Trans>
			</SetUpAiLine>
			{document.kind === "resume" ? (
				<ResumeWithoutAi resumeId={document.id} onClose={onClose} />
			) : (
				<p className="pt-6 text-[13px]/[18px] text-ink-3">
					<Trans>
						With a connection, the assistant proposes edits to this letter. You accept or reject each one, and nothing
						changes until you do.
					</Trans>
				</p>
			)}
		</div>
	);
}

/** Resume editor only: it switches the editor's mode. */
function ResumeWithoutAi({ resumeId, onClose }: { resumeId: string; onClose: () => void }) {
	const data = useResumeStore((state) => (state.resume?.id === resumeId ? state.resume.data : undefined));
	const check = useMemo(() => {
		if (!data) return null;
		const report = lintResumeForAts(data);
		return { report, count: buildIssues(report, data).length };
	}, [data]);
	const applications = useQuery(applicationsListQueryOptions());
	const job = applications.data?.find((application) => application.status === "saved" && !application.resumeId);
	const checkHint = check
		? plural(check.count, {
				one: `# thing to review · ${i18n.number(check.report.passedRules)} of ${i18n.number(check.report.totalRules)} checks pass`,
				other: `# things to review · ${i18n.number(check.report.passedRules)} of ${i18n.number(check.report.totalRules)} checks pass`,
			})
		: t`Spelling, length and what's missing`;

	const navigate = useNavigate();
	const openDialog = useDialogStore((state) => state.openDialog);
	const go = (mode: "write" | "check", checkTab?: "issues" | "match") => {
		if (checkTab) useEditorStore.setState({ checkTab });
		onClose();
		void navigate({
			to: "/builder/$resumeId",
			params: { resumeId },
			search: (previous: Record<string, unknown>) => ({
				...previous,
				mode: mode === "write" ? undefined : mode,
				assistant: undefined,
			}),
		});
	};
	const caret = <Icon name="caret-right" size={18} className="text-ink-3" />;
	const tile = (icon: IconName) => (
		<span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-sunken text-ink-2">
			<Icon name={icon} />
		</span>
	);

	return (
		<>
			<h3 className="pt-8 pb-1 t-section-title">
				<Trans>On this resume, without AI</Trans>
			</h3>
			<div className="flex flex-col">
				<ListRow
					render={<button type="button" onClick={() => go("check", "issues")} />}
					leading={tile("seal-check")}
					title={<Trans>Check it</Trans>}
					subtitle={checkHint}
					trailing={caret}
				/>
				<ListRow
					render={<button type="button" onClick={() => go("check", "match")} />}
					leading={tile("target")}
					title={<Trans>Match it against a job</Trans>}
					subtitle={<Trans>Which terms from a posting appear in it</Trans>}
					trailing={caret}
				/>
				<ListRow
					render={
						<button
							type="button"
							onClick={() => openDialog("document.new", { step: "copy", sourceResumeId: resumeId })}
						/>
					}
					leading={tile("copy")}
					title={<Trans>Copy it for a job</Trans>}
					subtitle={job ? t`${job.company} is saved and has no resume yet` : t`A tailored copy, linked to the job`}
					trailing={caret}
				/>
				<ListRow
					render={<button type="button" onClick={() => go("write")} />}
					leading={tile("pencil-simple")}
					title={<Trans>Edit a section</Trans>}
					subtitle={<Trans>Every section and entry, in Write</Trans>}
					trailing={caret}
				/>
			</div>
			<p className="pt-6 text-[13px]/[18px] text-ink-3">
				<Trans>
					With a connection, the assistant proposes numbered edits. You accept or reject each one, and nothing changes
					until you do.
				</Trans>
			</p>
		</>
	);
}
