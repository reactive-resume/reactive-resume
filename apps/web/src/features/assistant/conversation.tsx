import type { ChatAttachment, MessageContext } from "./chat";
import type { AssistantDocument } from "./document";
import type { ProposeEditsOutput } from "@reactive-resume/ai/tools/agent-tool-contracts";
import type { Proposal } from "@reactive-resume/resume/proposals";
import type { IconName } from "@reactive-resume/ui/components/icon";
import type { UIMessage } from "ai";
import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { lastAssistantMessageIsCompleteWithApprovalResponses, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import {
	agentWebSources,
	citesKnowledge,
	readPageOutputSchema,
	tailoringAllows,
} from "@reactive-resume/ai/tools/agent-tool-contracts";
import { withEditedText } from "@reactive-resume/resume/proposals";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@reactive-resume/ui/components/message-scroller";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { toast } from "@reactive-resume/ui/components/toast";
import { Trace, TraceIcon, TraceLine, TraceTitle } from "@reactive-resume/ui/components/trace";
import { cn } from "@reactive-resume/utils/style";
import { attachmentPart, fileToBase64, transcriptOf } from "./chat";
import { AssistantMarkdown } from "./markdown";
import { QuestionCard } from "./question-card";
import { ToolApprovals } from "./tool-approvals";
import { useAssistantChat } from "./use-assistant-chat";
import { useDialogStore } from "@/dialogs/store";
import { ChangeSet, Coverage } from "@/features/resume/editor/proposals/proposal-list";
import { useEditorStore } from "@/features/resume/editor/store";
import { getOrpcErrorMessage, toastError } from "@/libs/error-message";
import { isImeComposing } from "@/libs/keyboard";
import { ENTER_CLASS, POP_CLASS } from "@/libs/motion";
import { client, orpc } from "@/libs/orpc/client";

type EditStatus = Proposal["status"];
/** What the user did with an edit in this session: its status, and their wording when they rewrote it. */
/** What the server's receipts say about an edit: its decision, and the user's saved wording when they changed it. */
type Receipt = { status: EditStatus } & Partial<Pick<Proposal, "after" | "unsupported" | "edited">>;
type FactText = (id: string) => string | null;
type Part = UIMessage["parts"][number];
type ToolPart = Part & {
	toolCallId?: string;
	state?: string;
	input?: unknown;
	output?: unknown;
	errorText?: string;
};

type ConversationProps = {
	threadId: string;
	initialMessages: UIMessage[];
	/** A reply was still streaming when the conversation opened. */
	activeRun: boolean;
	document: AssistantDocument;
	readOnly: boolean;
	localEditsLocked?: boolean;
	providerLabel: string;
	/** A message to send as soon as the conversation opens (the first message, ⌘K Ask). */
	prompt: string | null;
	promptAttachments: ChatAttachment[];
	initialContext: MessageContext;
	onPromptSent: () => void;
	onSwitchModel: () => void;
};

/** One conversation: the thread (role="log"), change sets and questions in it, and the composer. */
export function Conversation(props: ConversationProps) {
	const { threadId, document, readOnly } = props;
	const queryClient = useQueryClient();
	const [context, setContext] = useState<MessageContext>(props.initialContext);
	const [rejections, setStatuses] = useState<ReadonlyMap<string, EditStatus>>(new Map());
	const [stopped, setStopped] = useState(false);
	// Messages already in the thread when it opens are history; only new ones rise in.
	const [initialIds] = useState(() => new Set(props.initialMessages.map((message) => message.id)));

	const refresh = () =>
		void queryClient.invalidateQueries({
			queryKey: orpc.agent.threads.list.key(),
		});
	const {
		messages,
		sendMessage,
		status,
		error: chatError,
		clearError,
		regenerate,
		stop,
		resuming,
		addToolOutput,
		addToolApprovalResponse,
	} = useAssistantChat({
		threadId,
		initialMessages: props.initialMessages,
		resume: props.activeRun,
		context,
		onFinish: refresh,
	});
	const streaming = status === "submitted" || status === "streaming";
	// A pending resume keeps the SDK at "ready"; lock the conversation until the replayed run starts or ends.
	const busy = streaming || resuming;
	const continuationBlocked =
		(!context.document || !context.posting) &&
		(messages.at(-1)?.metadata as { contextScope?: string } | undefined)?.contextScope !==
			JSON.stringify([context.document !== false, context.posting !== false]);

	const send = (text: string, attachments: ChatAttachment[] = []) => {
		if (busy || readOnly) return;
		clearError();
		setStopped(false);
		const files = attachments.map(attachmentPart);
		sendMessage(files.length > 0 ? { text, files } : { text }, {
			body: { attachmentIds: attachments.map((attachment) => attachment.id) },
		});
	};

	// The first message (or ⌘K's question) goes out once the conversation is open.
	const { prompt, promptAttachments, onPromptSent } = props;
	const sentPrompt = useRef(false);
	useEffect(() => {
		if (!prompt || sentPrompt.current || readOnly) return;
		sentPrompt.current = true;
		onPromptSent();
		const files = promptAttachments.map(attachmentPart);
		sendMessage(files.length > 0 ? { text: prompt, files } : { text: prompt }, {
			body: {
				attachmentIds: promptAttachments.map((attachment) => attachment.id),
			},
		});
	}, [prompt, promptAttachments, onPromptSent, sendMessage, readOnly]);

	// A failed continuation (after an answer) is sent again as it was; regenerating would drop the answer.
	const retry = () => {
		if (busy) return;
		if (receipts.error) {
			void receipts.refetch();
			return;
		}
		if (readOnly || continuationBlocked) return;
		clearError();
		if (
			lastAssistantMessageIsCompleteWithToolCalls({ messages }) ||
			lastAssistantMessageIsCompleteWithApprovalResponses({ messages })
		)
			void sendMessage();
		else void regenerate();
	};

	const stopReply = () => {
		setStopped(true);
		void client.agent.messages.stop({ threadId }).catch(() => undefined);
		void stop();
	};

	// Cited Knowledge facts are stored by id; their text shows only while they're still switched on.
	const citesFacts = messages.some((message) =>
		message.parts.some((part) => isProposeEdits(part) && citesKnowledge(part.output)),
	);
	const facts = useQuery({ ...orpc.career.facts.queryOptions({ input: { all: true } }), enabled: citesFacts });
	const factText: FactText = (id) =>
		facts.data?.find((fact) => fact.id === id && fact.status === "active")?.text ?? null;

	// Refresh receipts on document revisions without replacing a live streamed transcript.
	const receiptOptions = orpc.agent.threads.get.queryOptions({ input: { id: threadId } });
	const receipts = useQuery({
		...receiptOptions,
		gcTime: 0,
		queryKey: [...receiptOptions.queryKey, document?.proposalRevision],
		enabled: !!document?.proposalRevision,
	});
	const receiptsReady = !document.proposalRevision || !!receipts.data;
	const error = chatError ?? receipts.error;
	const statuses = useMemo(
		() =>
			new Map<string, Receipt>([
				...((receipts.data?.messages ?? []) as UIMessage[]).flatMap((message) =>
					message.parts.flatMap((part) =>
						isProposeEdits(part)
							? toProposals(part, new Map(), document).map(
									({ id, status, after, unsupported, edited }) =>
										[id, edited ? { status, after, unsupported, edited } : { status }] as const,
								)
							: [],
					),
				),
				...[...rejections].map(([id, status]) => [id, { status }] as const),
			]),
		[receipts.data, rejections, document],
	);

	// Every proposed edit in the conversation, with what the user did with it: marked on the page while pending.
	const proposals = useMemo(
		() =>
			(receiptsReady ? messages : []).flatMap((message) =>
				message.parts.flatMap((part) => (isProposeEdits(part) ? toProposals(part, statuses, document) : [])),
			),
		[messages, statuses, document, receiptsReady],
	);
	// Published only when they change: the page canvas and every section row re-render on each publish, and a
	// streaming reply rebuilds this list on every chunk.
	const published = useRef("[]");
	useEffect(() => {
		const key = JSON.stringify(proposals);
		if (key === published.current) return;
		published.current = key;
		useEditorStore.setState({ assistantProposals: proposals });
	}, [proposals]);
	useEffect(() => () => useEditorStore.setState({ assistantProposals: [] }), []);

	const record = (message: UIMessage, part: ToolPart, changed: readonly Proposal[], next: EditStatus) => {
		if (!part.toolCallId || next !== "rejected") return;
		setStatuses((current) => new Map([...current, ...changed.map((proposal) => [proposal.id, next] as const)]));
		void client.agent.messages
			.setEditStatus({
				threadId,
				messageId: message.id,
				toolCallId: part.toolCallId,
				edits: changed.map((proposal) => ({ id: proposal.id, status: next })),
			})
			.then(refresh)
			.catch(() => undefined);
	};

	// The user's wording shows (and Accept uses it) only once the server has it and a fresh read of the receipts shows
	// it; until then their draft stays open and out of Accept. A failed read keeps showing the old receipts, so it can't
	// confirm anything. The reviewed text binds the save, so another device's newer wording wins; a retry after a save
	// that went through finds its wording already there.
	const saveWording = async (message: UIMessage, part: ToolPart, proposal: Proposal, text: string) => {
		if (!part.toolCallId) throw new Error("This edit can't be saved.");
		await client.agent.messages.setEditStatus({
			threadId,
			messageId: message.id,
			toolCallId: part.toolCallId,
			edits: [{ id: proposal.id, status: "pending", text, after: proposal.after }],
		});
		const read = await receipts.refetch();
		const wording = withEditedText(proposal, text).after;
		const saved = ((read.data?.messages ?? []) as UIMessage[]).some((stored) =>
			stored.parts.some(
				(candidate) =>
					isProposeEdits(candidate) &&
					(candidate.output as ProposeEditsOutput | undefined)?.edits.some(
						(edit) => edit.id === proposal.id && edit.after === wording,
					),
			),
		);
		if (read.isError || !saved) throw new Error("The saved wording couldn't be read back.");
		refresh();
	};

	const answer = (toolCallId: string, output: string) =>
		addToolOutput({ tool: "ask_user_question", toolCallId, output });

	const last = messages.at(-1);
	const proposedInLast = last?.role === "assistant" && last.parts.some(isProposeEdits);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{/* Follows the reply only while the reader is at the latest message; a saved thread opens on its last question. */}
			<MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor">
				<div className="relative min-h-0 flex-1">
					<MessageScroller>
						<MessageScrollerViewport aria-label={t`Conversation`}>
							{/* Announced when the answer is complete, not token by token. */}
							<MessageScrollerContent aria-busy={busy} className="gap-4 p-4">
								{messages.map((message, index) => (
									<MessageScrollerItem key={message.id} messageId={message.id} scrollAnchor={message.role === "user"}>
										<MessageView
											message={message}
											streaming={streaming && index === messages.length - 1}
											busy={busy && index === messages.length - 1}
											answerable={index === messages.length - 1}
											enter={!initialIds.has(message.id)}
											readOnly={readOnly || continuationBlocked || !receiptsReady}
											localEditsLocked={(props.localEditsLocked ?? document.locked) || !receiptsReady}
											statuses={statuses}
											document={document}
											factText={factText}
											onAnswer={answer}
											onRecord={record}
											onSaveWording={saveWording}
										/>
										<ToolApprovals
											message={message}
											disabled={readOnly || continuationBlocked || busy || index !== messages.length - 1}
											onDecision={(decision) => {
												void addToolApprovalResponse(decision);
											}}
										/>
									</MessageScrollerItem>
								))}

								{(status === "submitted" || resuming) && (
									<MessageScrollerItem>
										<TraceLine status="running" className={ENTER_CLASS}>
											<TraceIcon>
												<Spinner decorative className="size-3" />
											</TraceIcon>
											<TraceTitle>
												<Trans>Thinking…</Trans>
											</TraceTitle>
										</TraceLine>
									</MessageScrollerItem>
								)}

								{stopped && !busy && !proposedInLast && (
									<MessageScrollerItem>
										<p className="flex items-center gap-2 text-sm text-ink-2 transition-opacity duration-standard ease-enter starting:opacity-0">
											<Icon name="stop-circle" size={18} className="text-ink-3" />
											<Trans>Stopped. No edits were proposed.</Trans>
											<button
												type="button"
												className="font-medium underline underline-offset-2"
												onClick={() => send(t`Continue`)}
											>
												<Trans>Continue</Trans>
											</button>
										</p>
									</MessageScrollerItem>
								)}

								{error && !busy && (
									<MessageScrollerItem>
										<div
											role="alert"
											className="grid gap-2 rounded-xl bg-danger-soft p-3 text-[13px] text-danger-text transition-opacity duration-standard ease-enter starting:opacity-0"
										>
											<span className="flex gap-2">
												<Icon name="warning-circle" size={18} className="shrink-0" />
												{receipts.error ? (
													<Trans>This conversation couldn't be opened.</Trans>
												) : (
													<Trans>
														{props.providerLabel} returned “
														{getOrpcErrorMessage(error, {
															fallback: t`an error`,
															allowServerMessage: true,
														})}
														”. Your message is kept.
													</Trans>
												)}
											</span>
											<span className="flex gap-1.5">
												<Button size="sm" variant="secondary" onClick={retry}>
													<Trans>Retry</Trans>
												</Button>
												<Button size="sm" variant="ghost" onClick={props.onSwitchModel}>
													<Trans>Switch model</Trans>
												</Button>
											</span>
										</div>
									</MessageScrollerItem>
								)}

								{!busy && messages.length > 0 && (
									<MessageScrollerItem className="flex justify-end transition-opacity duration-standard ease-enter starting:opacity-0">
										<Button
											size="sm"
											variant="ghost"
											className="text-ink-3"
											onClick={() => void copyTranscript(messages)}
										>
											<Icon name="copy" size={16} />
											<Trans>Copy transcript</Trans>
										</Button>
									</MessageScrollerItem>
								)}
							</MessageScrollerContent>
						</MessageScrollerViewport>
						<MessageScrollerButton>
							<Icon name="arrow-down" size={16} />
							<Trans>Latest</Trans>
						</MessageScrollerButton>
					</MessageScroller>
				</div>
			</MessageScrollerProvider>

			<Composer
				document={document}
				context={context}
				onContextChange={setContext}
				providerLabel={props.providerLabel}
				streaming={busy}
				disabled={readOnly}
				threadId={threadId}
				onSend={send}
				onStop={stopReply}
			/>
		</div>
	);
}

const isProposeEdits = (part: Part): part is ToolPart =>
	part.type === "tool-propose_edits" && (part as ToolPart).state === "output-available";

/** The edits in a result, with what the server's receipts say since: decisions, and the user's saved wording. */
function toProposals(part: ToolPart, receipts: ReadonlyMap<string, Receipt>, document: AssistantDocument): Proposal[] {
	const output = part.output as ProposeEditsOutput | undefined;
	return (output?.edits ?? []).map((streamed) => {
		const receipt = receipts.get(streamed.id);
		const edit = receipt?.edited ? { ...streamed, ...receipt } : streamed;
		const target = {
			sectionId: edit.target.sectionId,
			field: edit.target.field,
			...(edit.target.itemId === undefined ? {} : { itemId: edit.target.itemId }),
			...(edit.target.roleId === undefined ? {} : { roleId: edit.target.roleId }),
		};
		return {
			...edit,
			target,
			location: document.locationOf({ ...edit, target }) ?? edit.location,
			status: receipt?.status ?? edit.status,
			source: "assistant",
		};
	});
}

type MessageViewProps = {
	message: UIMessage;
	streaming: boolean;
	/** A continuation or resume is in flight: questions in this message cannot accept a second answer. */
	busy: boolean;
	/** Only the newest assistant message may answer a question, as with approvals. */
	answerable: boolean;
	enter: boolean;
	readOnly: boolean;
	localEditsLocked: boolean;
	statuses: ReadonlyMap<string, Receipt>;
	document: AssistantDocument;
	factText: FactText;
	onAnswer: (toolCallId: string, answer: string) => void;
	onRecord: (message: UIMessage, part: ToolPart, proposals: readonly Proposal[], status: EditStatus) => void;
	onSaveWording: (message: UIMessage, part: ToolPart, proposal: Proposal, text: string) => Promise<void>;
};

/** Memoized: while a reply streams, only its own message re-renders; the ones above keep their props. */
const MessageView = memo(function MessageView({
	message,
	streaming,
	busy,
	answerable,
	enter,
	readOnly,
	localEditsLocked,
	statuses,
	document,
	factText,
	onAnswer,
	onRecord,
	onSaveWording,
}: MessageViewProps) {
	if (message.role === "user") {
		const text = message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
		const files = message.parts.filter((part) => part.type === "file");
		return (
			<div className={cn("ms-8 grid justify-items-end gap-1", enter && ENTER_CLASS)}>
				{text && <p className="rounded-lg bg-sunken px-3 py-2 text-sm whitespace-pre-wrap">{text}</p>}
				{files.map((file) => (
					<span key={file.url} className="flex items-center gap-1 rounded-md bg-sunken px-2 py-1 text-xs text-ink-2">
						<Icon name="paperclip" size={14} />
						{(file as { filename?: string }).filename ?? t`Attachment`}
					</span>
				))}
			</div>
		);
	}

	const sources = agentWebSources(message);
	const lastTextIndex = message.parts.findLastIndex((part) => part.type === "text");

	return (
		<div className={cn("grid gap-3 text-sm", enter && ENTER_CLASS)}>
			{message.parts.map((part, index) => {
				const key = `${message.id}-${index}`;
				if (part.type === "text")
					return (
						<div key={key}>
							<AssistantMarkdown text={part.text} />
							{streaming && index === lastTextIndex && (
								<span aria-hidden="true" className="ms-0.5 inline-block h-4 w-2 translate-y-0.5 animate-pulse bg-ink" />
							)}
						</div>
					);
				return (
					<ToolPartView
						key={key}
						part={part as ToolPart}
						streaming={streaming}
						busy={busy}
						answerable={answerable}
						message={message}
						readOnly={readOnly}
						localEditsLocked={localEditsLocked}
						statuses={statuses}
						document={document}
						factText={factText}
						onAnswer={onAnswer}
						onRecord={onRecord}
						onSaveWording={onSaveWording}
					/>
				);
			})}
			{sources.length > 0 && (
				<div className="grid gap-1 text-xs">
					<span className="font-medium text-ink-3">
						<Trans>Sources</Trans>
					</span>
					{sources.map((source) => (
						<a
							key={source.url}
							href={source.url}
							target="_blank"
							rel="noreferrer"
							className="truncate text-accent-text underline underline-offset-2"
						>
							{source.title?.trim() || source.url}
						</a>
					))}
				</div>
			)}
		</div>
	);
});

type ToolPartViewProps = Omit<MessageViewProps, "enter"> & { part: ToolPart };

function ToolPartView({
	part,
	streaming,
	busy,
	answerable,
	message,
	readOnly,
	localEditsLocked,
	statuses,
	document,
	factText,
	onAnswer,
	onRecord,
	onSaveWording,
}: ToolPartViewProps) {
	const working = part.state === "input-streaming" || part.state === "input-available";
	if (part.state === "approval-requested" || part.state === "approval-responded") return null;
	if (part.state === "output-denied")
		return (
			<Status working={false}>
				<Trans>Skipped</Trans>
			</Status>
		);

	switch (part.type) {
		case "tool-read_resume":
		case "tool-read_letter":
			return (
				<Status working={working}>
					{part.type === "tool-read_letter" ? <Trans>Read the letter</Trans> : <Trans>Read the resume</Trans>}
				</Status>
			);
		case "tool-read_attachment":
			return (
				<Status working={working}>
					<Trans>Read the attachment</Trans>
				</Status>
			);
		case "tool-web_search":
		case "tool-google_search":
		case "tool-search_web":
		case "tool-read_page": {
			const reading = part.type === "tool-read_page";
			if (working && !streaming)
				return (
					<TraceLine status="pending">
						<TraceIcon>
							<Icon name="minus" size={14} />
						</TraceIcon>
						<TraceTitle>
							{reading ? <Trans>Page reading didn't finish.</Trans> : <Trans>Web search didn't finish.</Trans>}
						</TraceTitle>
					</TraceLine>
				);
			if (part.state === "output-error")
				return (
					<TraceLine role="alert" status="error">
						<TraceIcon>
							<Icon name="warning-circle" size={14} />
						</TraceIcon>
						<TraceTitle>
							{reading ? (
								<Trans>Couldn't read this page: {part.errorText}</Trans>
							) : (
								<Trans>Web search failed: {part.errorText}</Trans>
							)}
						</TraceTitle>
					</TraceLine>
				);
			const page = reading ? readPageOutputSchema.safeParse(part.output) : null;
			return (
				<Trace>
					<Status working={working}>
						{reading ? (
							working ? (
								<Trans>Reading page…</Trans>
							) : (
								<Trans>Read the page</Trans>
							)
						) : working ? (
							<Trans>Searching the web…</Trans>
						) : (
							<Trans>Searched the web</Trans>
						)}
					</Status>
					{page?.success && (page.data.truncated || page.data.completeness === "incomplete") && (
						<p className="text-xs text-ink-3">
							<Trans>This page is clipped or incomplete. Check the original before using it.</Trans>
						</p>
					)}
					{page?.success && page.data.fallbackReason && (
						<p className="text-xs text-ink-3">
							<Trans>Enhanced reading unavailable; used the built-in reader.</Trans>
						</p>
					)}
				</Trace>
			);
		}
		case "tool-apply_resume_patch":
			// Conversations from before the assistant only proposed edits.
			return (
				<Status working={false}>
					<Trans>Changed the resume directly (an earlier conversation)</Trans>
				</Status>
			);
		case "tool-ask_user_question":
			return <QuestionCard part={part} readOnly={readOnly || !answerable} busy={busy} onAnswer={onAnswer} />;
		case "tool-propose_edits": {
			if (part.state === "output-error")
				return (
					<TraceLine status="error">
						<TraceIcon>
							<Icon name="warning-circle" size={14} />
						</TraceIcon>
						<TraceTitle>
							<Trans>Couldn't propose these edits: {part.errorText}</Trans>
						</TraceTitle>
					</TraceLine>
				);
			if (part.state !== "output-available")
				return (
					<Status working>
						<Trans>Preparing edits…</Trans>
					</Status>
				);
			const output = part.output as ProposeEditsOutput;
			const proposals = toProposals(part, statuses, document);
			const states = proposals.map(document.stateOf);
			const pending = states.filter((state) => state === "pending").length;
			const accepted = states.filter((state) => state === "accepted").length;
			// Tailored edits land only on the copy made for their job; older sets that may have used a posting are asked again.
			const forJobCopy = document.kind === "resume" && !tailoringAllows(message, part.output, document.madeFor);
			const undecided = proposals.some((proposal) => proposal.status === "pending");
			const requirements = output.requirements ?? [];
			return (
				<div className="grid gap-1.5">
					{proposals.length > 0 ? (
						<ChangeSet
							proposals={proposals}
							states={states}
							locked={localEditsLocked || forJobCopy}
							title={
								pending > 0 ? (
									<Plural value={proposals.length} one="# proposed edit" other="# proposed edits" />
								) : (
									<Trans>
										{accepted} of {proposals.length} applied
									</Trans>
								)
							}
							onAccept={(chosen) => {
								if (forJobCopy) return;
								const { applied } = document.accept(chosen);
								if (applied.length > 0) onRecord(message, part, applied, "accepted");
							}}
							onReject={(chosen) => onRecord(message, part, chosen, "rejected")}
							onEdit={(proposal, text) => onSaveWording(message, part, proposal, text)}
							requirements={requirements}
							factText={factText}
						/>
					) : (
						requirements.length > 0 && (
							<div className="overflow-hidden rounded-xl border border-line">
								<Coverage requirements={requirements} factText={factText} />
							</div>
						)
					)}
					{forJobCopy && undecided && (
						<p className="text-xs text-ink-2">
							{"tailoredFor" in output ? (
								<Trans>
									These edits use a job posting, so they go to a copy of this resume made for that job. Copy it for the
									job and ask again there; this resume stays unchanged.
								</Trans>
							) : (
								<Trans>
									These edits are from before the assistant recorded which job posting they use, so they can't be
									applied. Ask again on the resume you want to change.
								</Trans>
							)}
						</p>
					)}
					{output.skipped.length > 0 && (
						<p className="text-xs text-ink-3">
							<Plural
								value={output.skipped.length}
								one="# change couldn't be prepared. Save your latest changes and ask again, or open Write to edit it directly."
								other="# changes couldn't be prepared. Save your latest changes and ask again, or open Write to edit them directly."
							/>
						</p>
					)}
				</div>
			);
		}
		case "data-knowledge-withdrawn":
			return (
				<Status working={false}>
					<Trans>This reply used Knowledge that has since changed, so it's hidden.</Trans>
				</Status>
			);
		default:
			return null;
	}
}

/** One step the assistant took: a spinner while it runs, a check once done. */
function Status({ working, children }: { working: boolean; children: ReactNode }) {
	return (
		<TraceLine status={working ? "running" : undefined}>
			<TraceIcon>
				{working ? <Spinner decorative className="size-3" /> : <Icon name="check" size={14} className={POP_CLASS} />}
			</TraceIcon>
			<TraceTitle>{children}</TraceTitle>
		</TraceLine>
	);
}

type ComposerProps = {
	document: AssistantDocument;
	context: MessageContext;
	onContextChange: (context: MessageContext) => void;
	providerLabel: string;
	streaming: boolean;
	disabled: boolean;
	/** Attachments need a conversation to belong to. */
	threadId: string | null;
	/** Creates a draft conversation lazily for the first attachment. */
	ensureThread?: () => Promise<string>;
	onSend: (text: string, attachments?: ChatAttachment[]) => void;
	onStop: () => void;
	/** Text the box starts with (a link's `?ask=`); the user still presses Send. */
	initialText?: string | undefined;
};

/**
 * Context chips (removing one leaves it out of what's sent), a two-row text box, Send (Stop while a reply streams)
 * and the line saying what's sent where.
 */
export function Composer(props: ComposerProps) {
	const { document, context, onContextChange, streaming, disabled } = props;
	const openDialog = useDialogStore((state) => state.openDialog);
	const id = useId();
	const [text, setText] = useState(props.initialText ?? "");
	const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
	const [uploading, setUploading] = useState(false);
	const fileInput = useRef<HTMLInputElement>(null);
	const hasText = text.trim().length > 0;

	const submit = () => {
		if (!hasText || streaming || disabled || uploading) return;
		props.onSend(text.trim(), attachments);
		setText("");
		setAttachments([]);
	};

	const upload = async (files: FileList | null) => {
		if (!files?.length) return;
		setUploading(true);
		try {
			const threadId = props.threadId ?? (await props.ensureThread?.());
			if (!threadId) return;
			const uploaded = await Promise.all(
				Array.from(files).map(async (file) => {
					const attachment = await client.agent.attachments.create({
						threadId,
						filename: file.name,
						mediaType: file.type || "application/octet-stream",
						data: await fileToBase64(file),
					});
					return {
						id: attachment.id,
						filename: attachment.filename,
						mediaType: attachment.mediaType,
					};
				}),
			);
			setAttachments((current) => [...current, ...uploaded]);
		} catch (error) {
			toastError(error, t`Couldn't attach the file. Try again.`);
		} finally {
			setUploading(false);
			if (fileInput.current) fileInput.current.value = "";
		}
	};

	const chips = [
		{
			key: "document" as const,
			icon: document.kind === "letter" ? ("envelope-simple" as const) : ("file-text" as const),
			label: document.name,
		},
		...(document.posting
			? [
					{
						key: "posting" as const,
						icon: "briefcase" as const,
						label: t`${document.posting.company} posting`,
					},
				]
			: []),
	].filter((chip) => context[chip.key]);

	const provider = props.providerLabel;
	const sharesPosting = context.posting && document.posting;
	const disclosure = context.document
		? document.kind === "letter"
			? sharesPosting
				? t`Sends this letter and the posting to ${provider} with your key, only when you press send.`
				: t`Sends this letter to ${provider} with your key, only when you press send.`
			: sharesPosting
				? t`Sends this resume and the posting to ${provider} with your key, only when you press send.`
				: t`Sends this resume to ${provider} with your key, only when you press send.`
		: sharesPosting
			? t`Sends your message and the posting to ${provider} with your key, only when you press send.`
			: t`Sends your message to ${provider} with your key, only when you press send.`;

	// Tailoring needs the job's own copy: the server refuses edits that use the posting on a resume other jobs share.
	const posting = sharesPosting ? document.posting : null;
	const needsCopy = document.kind === "resume" && !document.jobCopy;

	return (
		<div className="grid gap-2 border-t border-line bg-surface px-3 pt-2.5 pb-3">
			{needsCopy && posting && (
				<p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-sunken px-3 py-2 text-xs text-ink-2">
					<span className="flex-1">
						<Trans>
							Edits that use the {posting.company} posting go to a copy made for that job, so this resume stays
							unchanged.
						</Trans>
					</span>
					<Button
						size="sm"
						variant="secondary"
						onClick={() =>
							openDialog("document.new", { step: "copy", sourceResumeId: document.id, applicationId: posting.id })
						}
					>
						<Trans>Copy for this job</Trans>
					</Button>
				</p>
			)}
			{/* The Knowledge switch is always here, so the row is too. */}
			<div className="flex flex-wrap gap-1.5">
				{chips.map((chip) => (
					<RemovableChip
						key={chip.key}
						icon={chip.icon}
						label={chip.label}
						maxWidth="max-w-[160px]"
						removeLabel={t`Don't send ${chip.label}`}
						onRemove={() => onContextChange({ ...context, [chip.key]: false })}
					/>
				))}
				<button
					type="button"
					aria-pressed={context.memory === true}
					onClick={() => onContextChange({ ...context, memory: context.memory !== true })}
					className={cn(
						"flex h-[26px] items-center gap-1 rounded-md px-2 text-xs transition-colors",
						context.memory === true ? "bg-accent-soft text-accent-text" : "bg-sunken text-ink-3 hover:text-ink",
					)}
				>
					<Icon name="brain" size={15} />
					<Trans>Use Knowledge</Trans>
				</button>
				{attachments.map((attachment) => (
					<RemovableChip
						key={attachment.id}
						icon="paperclip"
						label={attachment.filename}
						maxWidth="max-w-[140px]"
						removeLabel={t`Remove ${attachment.filename}`}
						onRemove={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
					/>
				))}
			</div>

			<div className="flex items-end gap-1.5 rounded-xl border border-control-border bg-raised p-1.5 transition-[border-color,box-shadow] focus-within:border-accent focus-within:ring-3 focus-within:ring-accent-soft">
				<label htmlFor={id} className="sr-only">
					<Trans>Message the assistant</Trans>
				</label>
				<textarea
					id={id}
					rows={2}
					value={text}
					disabled={disabled}
					placeholder={t`Ask, or describe a change…`}
					onChange={(event) => setText(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey && !isImeComposing(event)) {
							event.preventDefault();
							submit();
						}
						if (event.key === "Escape" && streaming) {
							event.preventDefault();
							props.onStop();
						}
					}}
					className="field-sizing-content max-h-40 min-h-[44px] flex-1 resize-none bg-transparent px-1.5 py-1 text-sm outline-none placeholder:text-ink-3"
				/>
				{(props.threadId || props.ensureThread) && (
					<>
						<IconButton
							icon="paperclip"
							label={t`Attach a file`}
							size="icon-sm"
							disabled={disabled || uploading}
							className="text-ink-2"
							onClick={() => fileInput.current?.click()}
						/>
						<input
							ref={fileInput}
							type="file"
							multiple
							className="hidden"
							onChange={(event) => void upload(event.target.files)}
						/>
					</>
				)}
				<button
					type="button"
					aria-label={streaming ? t`Stop` : t`Send`}
					disabled={!streaming && (!hasText || disabled || uploading)}
					onClick={streaming ? props.onStop : submit}
					className={cn(
						"grid size-[34px] shrink-0 place-items-center rounded-lg transition-[background-color,color,scale] duration-quick ease-enter enabled:active:scale-[0.97]",
						streaming ? "bg-ink text-bg" : hasText ? "bg-accent text-on-accent" : "bg-sunken text-ink-3",
					)}
				>
					<Icon name={streaming ? "stop" : "arrow-up"} size={20} />
				</button>
			</div>

			<p className="text-xs leading-4 text-ink-3">
				{disclosure} {context.memory === true && <Trans>Knowledge facts the assistant looks up are sent too.</Trans>}{" "}
				{!context.document || !context.posting ? (
					<Trans>
						Each send starts fresh with this message and selected files. Previous conversation history stays here.
					</Trans>
				) : (
					<Trans>Previous messages, including document details, are also sent.</Trans>
				)}
			</p>
		</div>
	);
}

type RemovableChipProps = {
	icon: IconName;
	label: string;
	/** The label's max-width class (Tailwind needs the whole class name in the source). */
	maxWidth: string;
	removeLabel: string;
	onRemove: () => void;
};

function RemovableChip({ icon, label, maxWidth, removeLabel, onRemove }: RemovableChipProps) {
	return (
		<span className="flex h-[26px] items-center gap-1 rounded-md bg-sunken ps-2 text-xs text-ink-2">
			<Icon name={icon} size={15} />
			<span className={cn(maxWidth, "truncate")}>{label}</span>
			<button
				type="button"
				aria-label={removeLabel}
				onClick={onRemove}
				className="grid size-5 place-items-center rounded text-ink-3 transition-colors hover:bg-hover hover:text-ink"
			>
				<Icon name="x" size={14} />
			</button>
		</span>
	);
}

async function copyTranscript(messages: readonly UIMessage[]) {
	try {
		await navigator.clipboard.writeText(
			transcriptOf(messages, {
				user: t`You`,
				assistant: t`Assistant`,
				sources: t`Sources`,
			}),
		);
		toast.add({ description: t`Transcript copied` });
	} catch {
		toast.add({ description: t`Couldn't copy the transcript. Try again.` });
	}
}
