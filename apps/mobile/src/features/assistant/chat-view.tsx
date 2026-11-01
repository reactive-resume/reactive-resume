// The embeddable chat (wave 5 contract): the builder Assistant, Career → Coach and the workspace Coach sheet (M6-T2)
// render it with their own context. Ported from apps/web/src/features/assistant/conversation.tsx and
// apps/web/src/features/career/coach-thread.tsx.
import type { ChatAttachment, MessageContext } from "./chat";
import type { AssistantDocument } from "./document";
import type { EditStatus, ProposalHandlers } from "./messages";
import type { Receipt, ToolPart } from "./proposals";
import type { SavedThread } from "./recovery";
import type { IconName } from "@/ui";
import type { LegendListRef } from "@legendapp/list/react-native";
import type { Proposal } from "@reactive-resume/resume/proposals";
import type { UIMessage } from "ai";
import type { ReactNode } from "react";
import { LegendList } from "@legendapp/list/react-native";
import { Trans, useLingui } from "@lingui/react/macro";
import { ORPCError } from "@orpc/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { lastAssistantMessageIsCompleteWithApprovalResponses, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { RefreshControl, ActivityIndicator, AppState, Pressable, ScrollView, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import {
	AGENT_ATTACHMENT_TYPES,
	agentReplyError,
	citesKnowledge,
	tailoringAllows,
} from "@reactive-resume/ai/tools/agent-tool-contracts";
import { withEditedText } from "@reactive-resume/resume/proposals";
import { isNetworkError } from "@reactive-resume/utils/http";
import { attachmentPart, refreshThreads, transcriptOf, useAssistantChat } from "./chat";
import { FileChip, MessageView, Status } from "./messages";
import { isProposeEdits, publishProposals, supersededIn, toProposals } from "./proposals";
import { createRequestLane, recoverRun } from "./recovery";
import { ToolApprovals, type StoryEditorRender } from "./tool-approvals";
import { client, orpc, SessionChangedError } from "@/api/client";
import { getAccountScope, useSession } from "@/auth/session";
import { Button, Icon, Text, showToast, useTheme } from "@/ui";
import { usePullRefresh } from "@/ui/use-pull-refresh";

export type { ChatAttachment, MessageContext } from "./chat";
export type { AssistantDocument } from "./document";

export type ChatViewProps = {
	onRefresh?: (() => Promise<unknown>) | undefined;
	/** The conversation, or null for a new one: the first message (or attachment) creates it through `createThread`. */
	threadId: string | null;
	createThread: (scope: string) => Promise<string>;
	/** The first message created this conversation; show it from now on (pass it back as `threadId`). */
	onThreadCreated: (id: string) => void;
	/** Read at send time: the chips apply to the next message. */
	context: MessageContext;
	/** The open document: its change sets apply to the draft and are marked on Page. Null for the coach. */
	document: AssistantDocument | null;
	/** The provider, named in the error line: "OpenAI". */
	connection: string;
	/** Says what a send shares, under the composer; given how many earlier messages still go and how many don't. */
	privacy: string | ((history: ChatHistory) => string);
	/** Above the composer: what needs a decision before the next message (a connection that went away). */
	notice?: ReactNode;
	/** The coach: each of the user's messages can be remembered in Knowledge, for this application or all. */
	remember?: { applicationId: string | null } | undefined;
	/** The user's facts, to show which ones a proposed story rests on. */
	facts?: readonly { id: string; text: string; status: string }[] | undefined;
	/** The story editor a proposal's Edit first opens, in the conversation's scope. */
	storyEditor?: StoryEditorRender | undefined;
	/** Text the message box starts with, handed over from another screen; the user still taps Send. */
	draft?: string | undefined;
	placeholder: string;
	/** How a copied transcript names the other side: "Assistant" or "Coach". */
	assistantName: string;
	/** Context chips, before the attachments. */
	chips?: ReactNode;
	/** Shown while the conversation has no messages; `send` sends a starter. */
	empty?: (send: (text: string) => void) => ReactNode;
	/** Sent once, as soon as it can be (a question asked from another screen). */
	prompt?: string | null;
	onPromptSent?: () => void;
	/** Nothing can be sent (locked document, Knowledge still loading). */
	disabled?: boolean;
	/** Error line: Switch model. */
	onSwitchModel?: () => void;
	/** After each reply, for example to refresh Knowledge. */
	onFinish?: () => void;
};

type Prompt = { threadId: string; text: string; attachments: ChatAttachment[] };

export type ChatHistory = { earlier: number; withheld: number };

/** Why a reply failed, in the reader's language: a lost connection, the provider, or this server's own reason. */
function replyFailure(error: unknown, fallback: string, t: ReturnType<typeof useLingui>["t"]) {
	if (isNetworkError(error)) return t`Couldn't reach Reactive Resume. Check your internet connection, then try again.`;
	const key = error instanceof Error && !(error instanceof ORPCError) ? agentReplyError(error.message) : null;
	if (key)
		return {
			providerKey: t`The AI provider rejected the saved key. Check the key in Settings, or change the connection.`,
			providerModel: t`The AI provider doesn't offer this model. Choose another model, or change the connection.`,
			providerLimit: t`The AI provider is limiting requests (rate limit or quota). Wait a minute and try again, or change the connection.`,
			providerDown: t`The AI provider is unavailable right now. Try again in a moment, or change the connection.`,
			provider: t`The AI provider couldn't finish this reply. Try again, or change the connection.`,
			failed: t`This reply couldn't finish. Try again.`,
		}[key];
	return error instanceof ORPCError && error.message ? error.message : fallback;
}

/** A failure another AI connection could fix; never a lost network or this server's refusal. */
const providerFailure = (error: unknown) =>
	error instanceof Error && agentReplyError(error.message)?.startsWith("provider") === true;

const MAX_FILES = 10;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

/** One conversation (or a new one), its change sets and questions, and the composer. */
export function ChatView(props: ChatViewProps) {
	useSession();
	const scope = getAccountScope();
	return scope ? <ScopedChatView key={scope} {...props} scope={scope} /> : null;
}

type ScopedChatViewProps = ChatViewProps & { scope: string };

function ScopedChatView(props: ScopedChatViewProps) {
	const pull = usePullRefresh(...(props.onRefresh ? [props.onRefresh] : []));
	const { t } = useLingui();
	const { colors, space } = useTheme();
	const [prompt, setPrompt] = useState<Prompt | null>(null);
	const [starting, setStarting] = useState(false);
	const draft = useRef<string | null>(null);
	const creating = useRef<Promise<string> | null>(null);
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const checkCurrent = () => {
		if (!mounted.current || getAccountScope() !== props.scope) throw new SessionChangedError();
	};

	// A conversation exists from its first message or attachment; one created for an attachment is reused.
	const ensureThread = (): Promise<string> => {
		checkCurrent();
		if (props.threadId) return Promise.resolve(props.threadId);
		if (draft.current) return Promise.resolve(draft.current);
		creating.current ??= props
			.createThread(props.scope)
			.then((id) => {
				checkCurrent();
				draft.current = id;
				return id;
			})
			.finally(() => {
				creating.current = null;
			});
		return creating.current;
	};

	/** Resolves false when the conversation couldn't start, so the composer keeps the message. */
	const start = async (text: string, attachments: ChatAttachment[] = []) => {
		if (starting || props.disabled) return false;
		setStarting(true);
		try {
			const id = await ensureThread();
			checkCurrent();
			setPrompt({ threadId: id, text, attachments });
			draft.current = null;
			props.onThreadCreated(id);
			return true;
		} catch (error) {
			showToast({ message: errorText(error, t`Couldn't start the conversation. Try again.`) });
			return false;
		} finally {
			setStarting(false);
		}
	};

	const startPrompt = useEffectEvent((text: string) => {
		props.onPromptSent?.();
		void start(text);
	});
	useEffect(() => {
		// oxlint-disable-next-line react/set-state-in-effect -- a question handed over from another screen starts its conversation (async: it creates the thread first)
		if (props.prompt && !props.disabled) startPrompt(props.prompt);
	}, [props.prompt, props.disabled]);

	if (!props.threadId)
		return (
			<KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
				<ScrollView
					alwaysBounceVertical
					refreshControl={
						props.onRefresh ? (
							<RefreshControl {...pull} tintColor={colors.accent} colors={[colors.accent]} />
						) : undefined
					}
					style={{ flex: 1 }}
					contentContainerStyle={{ padding: space.s4, gap: space.s4 }}
				>
					<Empty render={props.empty} send={(text) => void start(text)} />
				</ScrollView>
				<Composer
					{...props}
					privacy={typeof props.privacy === "string" ? props.privacy : props.privacy({ earlier: 0, withheld: 0 })}
					streaming={starting}
					disabled={props.disabled ?? false}
					ensureThread={ensureThread}
					onSend={start}
					onStop={() => undefined}
				/>
			</KeyboardAvoidingView>
		);

	return (
		<Session
			key={props.threadId}
			{...props}
			threadId={props.threadId}
			prompt={prompt?.threadId === props.threadId ? prompt : null}
			onPromptDelivered={() => setPrompt(null)}
		/>
	);
}

type EmptyProps = { render: ChatViewProps["empty"]; send: (text: string) => void };

/** The empty state as a component, so its send callback isn't treated as part of the render. */
function Empty({ render, send }: EmptyProps) {
	return render?.(send) ?? null;
}

type SessionProps = Omit<ScopedChatViewProps, "threadId" | "prompt"> & {
	threadId: string;
	prompt: Prompt | null;
	onPromptDelivered: () => void;
};

/** Reads the conversation fresh when it opens (the chat takes its messages once); a brand-new one skips the read. */
function Session(props: SessionProps) {
	const { space } = useTheme();
	const session = useSession();
	const [fresh] = useState(() => props.prompt !== null);
	const options = orpc.agent.threads.get.queryOptions({
		input: { id: props.threadId },
		context: { scope: props.scope },
	});
	const thread = useQuery({
		...options,
		queryKey: [...options.queryKey, props.scope],
		enabled: !fresh && session.status === "signed-in",
		refetchOnMount: "always",
	});

	if (fresh) return <Conversation {...props} initialMessages={[]} activeRun={false} readOnly={false} />;
	if (thread.data && thread.isFetchedAfterMount)
		return (
			<Conversation
				{...props}
				initialMessages={thread.data.messages as UIMessage[]}
				activeRun={Boolean(thread.data.thread.activeRunId)}
				readOnly={thread.data.isReadOnly}
			/>
		);
	return (
		<View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.s6 }}>
			{thread.error ? (
				<Text color="ink2" accessibilityRole="alert">
					<Trans>This conversation couldn't be opened.</Trans>
				</Text>
			) : (
				<ActivityIndicator />
			)}
		</View>
	);
}

type ConversationProps = SessionProps & { initialMessages: UIMessage[]; activeRun: boolean; readOnly: boolean };

function Conversation(props: ConversationProps) {
	const pull = usePullRefresh(...(props.onRefresh ? [props.onRefresh] : []));
	const { threadId, document } = props;
	const { t } = useLingui();
	const { colors, radius, space } = useTheme();
	const queryClient = useQueryClient();
	const [rejections, setStatuses] = useState<ReadonlyMap<string, EditStatus>>(new Map());
	const [stopped, setStopped] = useState(false);
	const [recovering, setRecovering] = useState(props.activeRun);

	const refresh = () => {
		refreshThreads(queryClient);
		props.onFinish?.();
	};
	const chat = useAssistantChat({
		threadId,
		initialMessages: props.initialMessages,
		context: props.context,
		onFinish: refresh,
		scope: props.scope,
		beforeSend: props.context.document ? document?.flush : undefined,
	});
	const {
		messages,
		sendMessage,
		setMessages,
		status,
		error: chatError,
		clearError,
		regenerate,
		addToolOutput,
		addToolApprovalResponse,
		resumeStream,
	} = chat;
	const streaming = status === "submitted" || status === "streaming";
	// A resume or recovery in flight keeps the SDK at "ready" until the stream starts; lock every input until it settles.
	const busy = streaming || recovering;
	const readOnly = props.readOnly || props.disabled === true;

	// One request at a time: sends, retries, the automatic continuation after an answer and recovery share a lane, so
	// streams never overlap; each new request cancels and awaits the previous one, and Stop aborts all of them.
	const { instance } = chat;
	const lane = useMemo(
		() =>
			createRequestLane({
				stop: () => instance.stop(),
				busy: () => instance.status === "submitted" || instance.status === "streaming",
			}),
		[instance],
	);
	const detaching = useRef<Promise<void> | null>(null);

	const deliver = (text: string, attachments: ChatAttachment[]) => {
		const files = attachments.map(attachmentPart);
		void lane.run(() =>
			sendMessage(files.length > 0 ? { text, files } : { text }, {
				body: { attachmentIds: attachments.map((attachment) => attachment.id) },
			}),
		);
		// The server titles the conversation from its first message.
		setTimeout(() => refreshThreads(queryClient), 1500);
	};

	const send = (text: string, attachments: ChatAttachment[] = []) => {
		if (busy || readOnly) return false;
		clearError();
		setStopped(false);
		deliver(text, attachments);
		// The new question and its reply come into view even when the reader had scrolled up.
		requestAnimationFrame(() => void list.current?.scrollToEnd({ animated: true }));
		return true;
	};

	// The first message of a new conversation goes out once the chat exists.
	const sendPrompt = useEffectEvent((prompt: Prompt) => {
		props.onPromptDelivered();
		deliver(prompt.text, prompt.attachments);
	});
	const sentPrompt = useRef(false);
	useEffect(() => {
		if (!props.prompt || sentPrompt.current) return;
		sentPrompt.current = true;
		sendPrompt(props.prompt);
	}, [props.prompt]);

	const stopReply = () => {
		setStopped(true);
		void Promise.all([
			client.agent.messages.stop({ threadId }, { context: { scope: props.scope } }).catch(() => undefined),
			lane.cancel(),
		]).then(async () => {
			// The server keeps what it wrote before the stop reached it, which can differ from what arrived here. Show its
			// copy once the run is settled, so Continue and Try again act on what was actually saved.
			for (let attempt = 0; attempt < 10; attempt++) {
				const saved = await reloadThread();
				if (!saved) return;
				if (!saved.active) return setMessages(saved.messages);
				await new Promise((resolve) => setTimeout(resolve, 300));
			}
		});
	};

	const reloadThread = async (): Promise<SavedThread | null> => {
		const options = orpc.agent.threads.get.queryOptions({
			input: { id: threadId },
			context: { scope: props.scope },
		});
		const latest = await queryClient
			.fetchQuery({ ...options, queryKey: [...options.queryKey, props.scope], staleTime: 0 })
			.catch(() => null);
		return latest && { messages: latest.messages as UIMessage[], active: Boolean(latest.thread.activeRunId) };
	};

	// Follows a reply the connection lost, only while no other request is open; it checks it is still current after
	// every await (recovery.ts).
	const followRun = (isCurrent: () => boolean) =>
		recoverRun({
			isCurrent,
			reload: reloadThread,
			apply: (saved) => {
				clearError();
				setMessages(saved);
			},
			resume: () => resumeStream(),
		}).finally(() => {
			if (isCurrent()) refreshThreads(queryClient);
		});
	const recover = useEffectEvent(() => {
		void lane.runIfIdle(followRun).finally(() => setRecovering(false));
	});

	// Continue only the reply generated with the current context choices; the server checks its stored metadata too.
	const fresh = document !== null && (!props.context.document || !props.context.posting);
	const continuationBlocked =
		fresh &&
		(messages.at(-1)?.metadata as { contextScope?: string } | undefined)?.contextScope !==
			JSON.stringify([props.context.document !== false, props.context.posting !== false]);

	// A reply the connection lost may still run on the server, which refuses a second one: Retry follows it as recovery
	// does. Only with no run left is the message sent again: a failed continuation (after an answer) as it was,
	// since regenerating would drop the answer.
	const retry = () => {
		if (busy) return;
		if (receipts.error) {
			void receipts.refetch();
			return;
		}
		if (readOnly || continuationBlocked) return;
		clearError();
		void lane.run(async (isCurrent) => {
			const latest = await reloadThread();
			if (!isCurrent()) return;
			if (latest?.active) return followRun(isCurrent);
			const continuation =
				lastAssistantMessageIsCompleteWithToolCalls({ messages }) ||
				lastAssistantMessageIsCompleteWithApprovalResponses({ messages });
			await (continuation ? sendMessage() : regenerate());
		});
	};

	// A reply still running when the conversation opened is followed until it finishes (resume needs Redis). Only the
	// state at opening counts: a later refresh of the thread never starts a second stream. Leaving aborts every request.
	const [openedRunning] = useState(props.activeRun);
	useEffect(() => {
		if (openedRunning) recover();
		return () => void lane.cancel();
	}, [openedRunning, lane]);

	// In the background the OS may cut the connection, so requests are detached here; the run goes on on the server.
	// Back in the foreground, once the detach settled, the thread is reloaded as saved and a run still going is followed.
	// Every background transition cancels (even when idle), so a recovery still queued from an earlier foreground is
	// dropped; the queued one also checks the app is still active when the detach has settled.
	const onAppState = useEffectEvent((state: string) => {
		if (state === "background") {
			const busy = lane.busy();
			const cancelled = lane.cancel();
			if (busy) detaching.current = cancelled;
			return;
		}
		if (state !== "active" || (!detaching.current && status !== "error")) return;
		const settled = detaching.current ?? Promise.resolve();
		detaching.current = null;
		void lane.runAfter(settled, () => AppState.currentState === "active", followRun);
	});
	useEffect(() => {
		const subscription = AppState.addEventListener("change", onAppState);
		return () => subscription.remove();
	}, []);

	// Refresh receipts on document revisions without replacing a live streamed transcript.
	const receiptOptions = orpc.agent.threads.get.queryOptions({
		input: { id: threadId },
		context: { scope: props.scope },
	});
	const receipts = useQuery({
		...receiptOptions,
		gcTime: 0,
		queryKey: [...receiptOptions.queryKey, props.scope, document?.proposalRevision],
		enabled: !!document?.proposalRevision,
	});
	const receiptsReady = !document?.proposalRevision || !!receipts.data;
	const error = chatError ?? receipts.error;
	// A new id, not every streamed chunk, changes the receipts.
	const supersededIds = [...supersededIn(messages)].join(" ");
	// What the server no longer sends (Knowledge changed) and which replies ended early, read again after each reply.
	const history = useQuery({
		...receiptOptions,
		queryKey: [...receiptOptions.queryKey, props.scope, "history", messages.length, status],
		select: (data) => ({
			withheld: new Set(data.history?.withheld ?? []),
			cutoffAt: data.history?.cutoffAt ?? null,
			interrupted: data.interrupted ?? [],
		}),
		enabled: status === "ready" || status === "error",
		placeholderData: (previous) => previous,
	});
	const withheld = messages.filter((message) => history.data?.withheld.has(message.id)).length;
	const lastReply = messages.at(-1)?.role === "assistant" ? messages.at(-1) : undefined;
	const endedEarly =
		!busy &&
		!error &&
		(stopped || (lastReply !== undefined && (history.data?.interrupted ?? []).includes(lastReply.id)));
	const saidSomething = lastReply?.parts.some((part) => part.type === "text" && part.text.trim() !== "") === true;
	const statuses = useMemo(
		() =>
			new Map<string, Receipt>([
				...((receipts.data?.messages ?? []) as UIMessage[]).flatMap((message) =>
					message.parts.flatMap((part) =>
						isProposeEdits(part)
							? toProposals(part, new Map()).map(
									({ id, status, after, unsupported, edited }) =>
										[id, edited ? { status, after, unsupported, edited } : { status }] as const,
								)
							: [],
					),
				),
				...[...rejections].map(([id, status]) => [id, { status }] as const),
				...supersededIds
					.split(" ")
					.filter(Boolean)
					.map((id) => [id, { status: "rejected" as const, superseded: true }] as const),
			]),
		[receipts.data, rejections, supersededIds],
	);

	// ---- Proposed edits ----

	const proposals = useMemo(
		() =>
			document && receiptsReady
				? messages.flatMap((message) =>
						message.parts.flatMap((part) => (isProposeEdits(part) ? toProposals(part, statuses) : [])),
					)
				: [],
		[messages, statuses, document, receiptsReady],
	);
	// Kept after the assistant closes: Page marks them while they're pending.
	const documentId = document?.id;
	useEffect(() => {
		if (documentId && document?.kind === "resume") publishProposals(documentId, proposals);
	}, [documentId, document?.kind, proposals]);

	const record = (message: UIMessage, part: ToolPart, changed: readonly Proposal[], next: EditStatus) => {
		if (!part.toolCallId || next !== "rejected") return;
		setStatuses((current) => new Map([...current, ...changed.map((proposal) => [proposal.id, next] as const)]));
		void client.agent.messages
			.setEditStatus(
				{
					threadId,
					messageId: message.id,
					toolCallId: part.toolCallId,
					edits: changed.map((proposal) => ({ id: proposal.id, status: next })),
				},
				{ context: { scope: props.scope } },
			)
			.then(() => refreshThreads(queryClient))
			.catch(() => undefined);
	};
	// The user's wording shows (and Accept uses it) only once the server has it and a fresh read of the receipts shows
	// it (web conversation.tsx); until then their draft stays open and out of Accept. The reviewed text binds the save.
	const saveWording = async (message: UIMessage, part: ToolPart, proposal: Proposal, text: string) => {
		if (!part.toolCallId) throw new Error("This edit can't be saved.");
		await client.agent.messages.setEditStatus(
			{
				threadId,
				messageId: message.id,
				toolCallId: part.toolCallId,
				edits: [{ id: proposal.id, status: "pending", text, after: proposal.after }],
			},
			{ context: { scope: props.scope } },
		);
		const read = await receipts.refetch();
		const wording = withEditedText(proposal, text).after;
		const saved = ((read.data?.messages ?? []) as UIMessage[]).some((stored) =>
			stored.parts.some(
				(candidate) =>
					isProposeEdits(candidate) &&
					toProposals(candidate, new Map()).some((edit) => edit.id === proposal.id && edit.after === wording),
			),
		);
		if (read.isError || !saved) throw new Error("The saved wording couldn't be read back.");
		void refreshThreads(queryClient);
	};
	const saveWordingRef = useRef(saveWording);
	useLayoutEffect(() => {
		saveWordingRef.current = saveWording;
	});
	// Kept current for the memoized handlers below, so the message rows keep their props while a reply streams.
	const recordRef = useRef(record);
	useLayoutEffect(() => {
		recordRef.current = record;
	});

	// Cited Knowledge facts are stored by id; their text shows only while they're still switched on (web conversation.tsx).
	const citesFacts = messages.some((message) =>
		message.parts.some((part) => isProposeEdits(part) && citesKnowledge(part.output)),
	);
	const session = useSession();
	const facts = useQuery({
		...orpc.career.facts.queryOptions({ input: { applicationId: null, all: true } }),
		queryKey: [...orpc.career.facts.key(), session.server, "all"],
		enabled: citesFacts && session.status === "signed-in",
	});
	const factText = useCallback(
		(id: string) => facts.data?.find((fact) => fact.id === id && fact.status === "active")?.text ?? null,
		[facts.data],
	);

	const handlers = useMemo<ProposalHandlers | null>(
		() =>
			document
				? {
						statuses,
						stateOf: document.stateOf,
						locked: document.locked || !receiptsReady,
						// Synchronous with the tap: the draft is checked and changed in the same turn (document.ts), and the
						// decision travels with the document save.
						onAccept: (message, part, chosen) => {
							if (!receiptsReady || forJobCopy(document, message, part)) return;
							const { applied } = document.accept(chosen);
							if (applied.length > 0) recordRef.current(message, part, applied, "accepted");
						},
						forJobCopy: (message, part) => forJobCopy(document, message, part),
						onReject: (message, part, chosen) => recordRef.current(message, part, chosen, "rejected"),
						onEdit: (message, part, proposal, text) => saveWordingRef.current(message, part, proposal, text),
						factText,
					}
				: null,
		[document, statuses, receiptsReady, factText],
	);
	const answer = useMemo(
		() =>
			continuationBlocked
				? null
				: (toolCallId: string, output: string) =>
						// The answer's automatic continuation is a request too: it waits for anything open to end.
						void lane.run(async () => {
							await addToolOutput({ tool: "ask_user_question", toolCallId, output } as never);
						}),
		[continuationBlocked, lane, addToolOutput],
	);
	const extraData = useMemo(
		() => ({ streaming: busy, readOnly, handlers, answer }),
		[busy, readOnly, handlers, answer],
	);

	const last = messages.at(-1);
	const proposedInLast = last?.role === "assistant" && last.parts.some(isProposeEdits);

	// "Latest" shows once the reader has scrolled away from the newest message; the list follows only at the end.
	const list = useRef<LegendListRef>(null);
	const [behind, setBehind] = useState(false);

	const copyTranscript = async () => {
		try {
			await Clipboard.setStringAsync(
				transcriptOf(messages, { user: t`You`, assistant: props.assistantName, sources: t`Sources` }),
			);
			showToast({ message: t`Transcript copied` });
		} catch {
			showToast({ message: t`Couldn't copy the transcript. Try again.` });
		}
	};

	return (
		<KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
			<View style={{ flex: 1 }}>
				<LegendList
					ref={list}
					onScroll={(event) => {
						const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
						setBehind(contentSize.height - layoutMeasurement.height - contentOffset.y > 160);
					}}
					scrollEventThrottle={64}
					data={messages}
					keyExtractor={(message) => message.id}
					extraData={extraData}
					initialScrollAtEnd
					maintainScrollAtEnd={{ animated: false }}
					maintainVisibleContentPosition
					maintainScrollAtEndThreshold={0.2}
					recycleItems={false}
					alwaysBounceVertical
					refreshControl={
						props.onRefresh ? (
							<RefreshControl {...pull} tintColor={colors.accent} colors={[colors.accent]} />
						) : undefined
					}
					style={{ flex: 1 }}
					accessibilityLabel={t`Conversation`}
					contentContainerStyle={{ padding: space.s4 }}
					ItemSeparatorComponent={() => <View style={{ height: space.s4 }} />}
					keyboardDismissMode="interactive"
					keyboardShouldPersistTaps="handled"
					ListEmptyComponent={!busy ? <Empty render={props.empty} send={(text) => void send(text)} /> : null}
					renderItem={({ item: message, index }) => (
						<View>
							<MessageView
								message={message}
								streaming={busy && index === messages.length - 1}
								readOnly={readOnly}
								answerable={index === messages.length - 1}
								proposals={handlers}
								onAnswer={answer}
								remember={props.remember ?? null}
							/>
							<ToolApprovals
								message={message}
								facts={props.facts ?? []}
								applicationId={props.remember?.applicationId ?? null}
								storyEditor={props.storyEditor}
								disabled={readOnly || busy || index !== messages.length - 1}
								onDecision={(decision) => {
									void lane.run(async () => {
										await addToolApprovalResponse(decision);
									});
								}}
							/>
						</View>
					)}
					ListFooterComponent={
						<View style={{ gap: space.s4, paddingTop: space.s4 }}>
							{status === "submitted" || recovering ? (
								<Status status="running">
									<Trans>Thinking…</Trans>
								</Status>
							) : null}

							{withheld > 0 ? (
								<View style={{ flexDirection: "row", gap: space.s2 }}>
									<Icon name="eye-slash" size={16} color={colors.ink3} />
									<Text variant="caption" color="ink2" style={{ flex: 1 }}>
										<Trans>
											Messages from before Knowledge changed aren't sent to the AI anymore, so it won't remember them.
											Start a new conversation to keep context together.
										</Trans>
									</Text>
								</View>
							) : null}

							{endedEarly && !proposedInLast ? (
								<View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.s2 }}>
									<Icon name="stop-circle" size={18} color={colors.ink3} />
									<Text variant="callout" color="ink2">
										{document ? (
											<Trans>Stopped. No edits were proposed.</Trans>
										) : saidSomething ? (
											<Trans>Stopped before the answer finished.</Trans>
										) : (
											<Trans>Stopped before answering.</Trans>
										)}
									</Text>
									{/* A reply that said something is continued; one that said nothing is asked again. */}
									<Button
										variant="link"
										label={saidSomething || document ? t`Continue` : t`Try again`}
										disabled={readOnly}
										onPress={() => (saidSomething || document ? send(t`Continue`) : retry())}
									/>
								</View>
							) : null}

							{error && !busy ? (
								<View
									accessibilityRole="alert"
									style={{
										gap: space.s2,
										padding: space.s3,
										borderRadius: radius.rLg,
										backgroundColor: colors.dangerSoft,
									}}
								>
									<View style={{ flexDirection: "row", gap: space.s2 }}>
										<Icon name="warning-circle" size={18} color={colors.dangerText} />
										<Text variant="callout" color="dangerText" style={{ flex: 1 }}>
											{receipts.error ? (
												<Trans>This conversation couldn't be opened.</Trans>
											) : (
												`${replyFailure(error, t`${props.connection} didn't respond.`, t)} ${t`Your message is kept.`}`
											)}
										</Text>
									</View>
									{continuationBlocked ? (
										<Text variant="callout" color="dangerText">
											<Trans>Context is left out, so reply with a new message instead.</Trans>
										</Text>
									) : null}
									<View style={{ flexDirection: "row", gap: space.s2 }}>
										<Button
											size="sm"
											variant="secondary"
											icon="arrow-clockwise"
											label={t`Retry`}
											disabled={busy || (!receipts.error && (readOnly || continuationBlocked))}
											onPress={retry}
										/>
										{props.onSwitchModel && providerFailure(error) ? (
											<Button size="sm" variant="ghost" label={t`Switch model`} onPress={props.onSwitchModel} />
										) : null}
									</View>
								</View>
							) : null}

							{!busy && messages.length > 0 ? (
								<Button variant="ghost" size="sm" icon="copy" label={t`Copy transcript`} onPress={copyTranscript} />
							) : null}
						</View>
					}
				/>
				{behind ? (
					<View
						pointerEvents="box-none"
						style={{ position: "absolute", bottom: space.s3, start: 0, end: 0, alignItems: "center" }}
					>
						<Button
							size="sm"
							variant="secondary"
							icon="arrow-down"
							label={t`Latest`}
							onPress={() => void list.current?.scrollToEnd({ animated: true })}
						/>
					</View>
				) : null}
			</View>

			<Composer
				{...props}
				privacy={
					typeof props.privacy === "string"
						? props.privacy
						: props.privacy({ earlier: messages.length - withheld, withheld })
				}
				streaming={busy}
				disabled={readOnly}
				ensureThread={() => Promise.resolve(threadId)}
				onSend={send}
				onStop={stopReply}
			/>
		</KeyboardAvoidingView>
	);
}

/** The server's reason when it gave one (a switched-off connection, a limit); otherwise the fallback. */
function errorText(error: unknown, fallback: string) {
	return error instanceof ORPCError && error.message ? error.message : fallback;
}

// ---- Composer ----

type Upload = ChatAttachment & { size: number; busy?: boolean };

type ComposerProps = Pick<ScopedChatViewProps, "chips" | "notice" | "placeholder" | "scope" | "draft"> & {
	privacy: string;
	streaming: boolean;
	disabled: boolean;
	ensureThread: () => Promise<string>;
	/** True once the message is on its way; false keeps it in the box. */
	onSend: (text: string, attachments: ChatAttachment[]) => boolean | Promise<boolean>;
	onStop: () => void;
};

/** Context chips and attachments, a box that grows to six lines, attach, and Send (Stop while a reply streams). */
function Composer(props: ComposerProps) {
	const { t } = useLingui();
	const { colors, radius, size, space, type } = useTheme();
	const [text, setText] = useState(props.draft ?? "");
	const [attachments, setAttachments] = useState<Upload[]>([]);
	// Chips removed while their upload was still running: the finished upload is deleted, not kept.
	const removedUploads = useRef(new Set<string>());
	const uploading = attachments.some((attachment) => attachment.busy);
	const hasText = text.trim().length > 0;

	const submit = async () => {
		const value = text.trim();
		if (!value || props.streaming || props.disabled || uploading) return;
		const sent = await props.onSend(
			value,
			attachments.map(({ id, filename, mediaType }) => ({ id, filename, mediaType })),
		);
		if (!sent) return;
		setText("");
		setAttachments([]);
	};

	const attach = async () => {
		const picked = await DocumentPicker.getDocumentAsync({
			multiple: true,
			copyToCacheDirectory: true,
			type: [...AGENT_ATTACHMENT_TYPES],
		});
		if (picked.canceled) return;
		// Sizes are checked before any file is read: 25 MB a file and 100 MB in all, the server's limits.
		let budget = MAX_TOTAL_BYTES - attachments.reduce((total, item) => total + item.size, 0);
		let room = MAX_FILES - attachments.length;
		const files: { asset: DocumentPicker.DocumentPickerAsset; key: string; size: number }[] = [];
		const skipped = { count: 0, big: false, total: false };
		for (const [index, asset] of picked.assets.entries()) {
			const size = asset.size ?? new File(asset.uri).size;
			if (room === 0) skipped.count++;
			else if (size > MAX_FILE_BYTES) skipped.big = true;
			else if (size > budget) skipped.total = true;
			else {
				files.push({ asset, key: `upload-${index}-${asset.uri}`, size });
				budget -= size;
				room--;
			}
		}
		if (skipped.count > 0) showToast({ message: t`Attach up to 10 files to a message.` });
		if (skipped.big) showToast({ message: t`Files can be up to 25 MB each.` });
		if (skipped.total) showToast({ message: t`Attachments can be up to 100 MB in all.` });
		if (files.length === 0) return;
		setAttachments((current) => [
			...current,
			...files.map(({ asset, key, size }) => ({
				id: key,
				filename: asset.name,
				mediaType: asset.mimeType ?? "application/octet-stream",
				size,
				busy: true,
			})),
		]);
		const drop = (key: string) => setAttachments((current) => current.filter((item) => item.id !== key));
		let threadId: string;
		try {
			threadId = await props.ensureThread();
		} catch (error) {
			for (const { key } of files) drop(key);
			showToast({ message: errorText(error, t`Couldn't attach the file. Try again.`) });
			return;
		}
		// One file at a time: only one base64 copy is in memory at once.
		for (const { asset, key } of files) {
			if (removedUploads.current.delete(key)) continue;
			try {
				const attachment = await client.agent.attachments.create(
					{
						threadId,
						filename: asset.name,
						mediaType: asset.mimeType ?? "application/octet-stream",
						data: await new File(asset.uri).base64(),
					},
					{ context: { scope: props.scope } },
				);
				if (removedUploads.current.delete(key)) {
					// Removed while uploading.
					void client.agent.attachments
						.delete({ id: attachment.id }, { context: { scope: props.scope } })
						.catch(() => undefined);
					continue;
				}
				setAttachments((current) =>
					current.map((item) =>
						item.id === key
							? { id: attachment.id, filename: attachment.filename, mediaType: attachment.mediaType, size: item.size }
							: item,
					),
				);
			} catch (error) {
				drop(key);
				showToast({ message: errorText(error, t`Couldn't attach the file. Try again.`) });
			}
		}
	};

	const sendDisabled = !props.streaming && (!hasText || props.disabled || uploading);

	return (
		<View
			style={{
				gap: space.s2,
				paddingHorizontal: space.s3,
				paddingTop: space.s2,
				paddingBottom: space.s3,
				borderTopWidth: 1,
				borderColor: colors.line,
				backgroundColor: colors.surface,
			}}
		>
			{props.notice}
			{props.chips || attachments.length > 0 ? (
				// One row that scrolls sideways, so the chips never push the message box down the screen.
				<ScrollView
					horizontal
					showsHorizontalScrollIndicator={false}
					keyboardShouldPersistTaps="handled"
					contentContainerStyle={{ flexDirection: "row", gap: space.s2 }}
					accessibilityLabel={t`Context`}
				>
					{props.chips}
					{attachments.map((attachment) => (
						<FileChip
							key={attachment.id}
							name={attachment.filename}
							busy={attachment.busy}
							onRemove={() => {
								setAttachments((current) => current.filter((item) => item.id !== attachment.id));
								// An uploaded but unsent file counts toward the message's limit until it's deleted.
								if (attachment.busy) removedUploads.current.add(attachment.id);
								else
									void client.agent.attachments
										.delete({ id: attachment.id }, { context: { scope: props.scope } })
										.catch(() => undefined);
							}}
						/>
					))}
				</ScrollView>
			) : null}

			<View
				style={{
					flexDirection: "row",
					alignItems: "flex-end",
					gap: space.s1,
					padding: space.s1,
					borderRadius: radius.rLg,
					borderWidth: 1,
					borderColor: colors.line2,
					backgroundColor: colors.raised,
					opacity: props.disabled ? 0.6 : 1,
				}}
			>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel={t`Attach a PDF, Word, text or image file`}
					accessibilityState={{ disabled: props.disabled || uploading }}
					disabled={props.disabled || uploading}
					onPress={() => void attach()}
					style={{ width: size.hit, height: size.hit, alignItems: "center", justifyContent: "center" }}
				>
					<Icon name="paperclip" size={22} color={colors.ink2} />
				</Pressable>
				<TextInput
					value={text}
					onChangeText={setText}
					editable={!props.disabled}
					multiline
					accessibilityLabel={t`Message the assistant`}
					placeholder={props.placeholder}
					placeholderTextColor={colors.ink3}
					style={{
						...type.body,
						flex: 1,
						color: colors.ink,
						minHeight: size.hit,
						maxHeight: type.body.lineHeight * 6 + space.s4,
						paddingVertical: space.s3,
						textAlignVertical: "top",
					}}
				/>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel={props.streaming ? t`Stop` : t`Send`}
					accessibilityState={{ disabled: sendDisabled }}
					disabled={sendDisabled}
					onPress={props.streaming ? props.onStop : () => void submit()}
					style={{ width: size.hit, height: size.hit, alignItems: "center", justifyContent: "center" }}
				>
					<View
						style={{
							width: 34,
							height: 34,
							borderRadius: radius.rLg,
							alignItems: "center",
							justifyContent: "center",
							backgroundColor: props.streaming ? colors.ink : hasText ? colors.accent : colors.sunken,
						}}
					>
						<Icon
							name={props.streaming ? "stop" : "arrow-up"}
							size={props.streaming ? 16 : 18}
							color={props.streaming ? colors.bg : hasText ? colors.onAccent : colors.ink3}
						/>
					</View>
				</Pressable>
			</View>

			<Text variant="caption" color="ink3" style={{ paddingHorizontal: space.s1 }}>
				{props.privacy}
			</Text>
		</View>
	);
}

type ContextChipProps = {
	icon: IconName;
	label: string;
	/** A removable chip (what this message shares); without it the chip toggles. */
	onRemove?: () => void;
	removeLabel?: string;
	/** Toggle chips (the coach's): on or off. */
	pressed?: boolean;
	onPress?: () => void;
};

/** A context chip: removing one (×) leaves it out of what's sent; the coach's toggle on and off. */
export function ContextChip({ icon, label, onRemove, removeLabel, pressed, onPress }: ContextChipProps) {
	const { colors, radius, space } = useTheme();
	const toggle = onPress !== undefined;
	const on = !toggle || pressed;
	return (
		<Pressable
			accessibilityRole={toggle ? "switch" : "text"}
			accessibilityState={toggle ? { checked: !!pressed } : {}}
			accessibilityLabel={label}
			onPress={onPress}
			disabled={!toggle}
			hitSlop={8}
			style={{
				flexDirection: "row",
				alignItems: "center",
				gap: space.s1,
				minHeight: 28,
				maxWidth: 200,
				paddingStart: space.s2,
				paddingEnd: onRemove ? 0 : space.s2,
				borderRadius: radius.rMd,
				borderWidth: toggle ? 1 : 0,
				borderColor: on ? colors.accent : colors.line2,
				backgroundColor: toggle ? (on ? colors.accentSoft : "transparent") : colors.sunken,
			}}
		>
			<Icon name={icon} size={14} color={toggle && on ? colors.accentText : colors.ink2} />
			<Text
				variant="caption"
				color={toggle ? (on ? "accentText" : "ink3") : "ink2"}
				numberOfLines={1}
				style={{ flexShrink: 1 }}
			>
				{label}
			</Text>
			{onRemove ? (
				<Pressable
					accessibilityRole="button"
					accessibilityLabel={removeLabel ?? label}
					onPress={onRemove}
					hitSlop={8}
					style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center" }}
				>
					<Icon name="x" size={12} color={colors.ink3} />
				</Pressable>
			) : null}
		</Pressable>
	);
}

/**
 * Tailored edits land only on the copy made for their job (web conversation.tsx); older sets that may have used a
 * posting are asked again.
 */
function forJobCopy(document: AssistantDocument, message: UIMessage, part: ToolPart) {
	return document.kind === "resume" && !tailoringAllows(message, part.output, document.madeFor);
}
