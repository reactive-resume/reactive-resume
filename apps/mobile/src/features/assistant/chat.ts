// The assistant's chat on oRPC, ported from apps/web/src/features/assistant/chat.ts.
import type { MessageContext } from "./transport";
import type { AgentMessagesApi } from "./transport";
import type { RouterOutput } from "@/api/client";
import type { useQueryClient } from "@tanstack/react-query";
import type { FileUIPart, UIMessage } from "ai";
import { Chat, useChat } from "@ai-sdk/react";
import { t } from "@lingui/core/macro";
import { ORPCError } from "@orpc/client";
import { useQuery } from "@tanstack/react-query";
import { lastAssistantMessageIsCompleteWithApprovalResponses, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { useLayoutEffect, useMemo, useRef } from "react";
import { resumeAgentStream, sendAgentMessage } from "./transport";
import { orpc, streamClient } from "@/api/client";
import { getAccountScope, useSession } from "@/auth/session";

export type { MessageContext } from "./transport";
export type ChatAttachment = { id: string; filename: string; mediaType: string };
export type ThreadSummary = RouterOutput["agent"]["threads"]["list"][number];

export const attachmentPart = (attachment: ChatAttachment): FileUIPart => ({
	type: "file",
	url: `agent-attachment:${attachment.id}`,
	mediaType: attachment.mediaType,
	filename: attachment.filename,
});

export const textOf = (message: UIMessage) =>
	message.parts
		.flatMap((part) => (part.type === "text" ? [part.text] : []))
		.join("")
		.trim();

export type WebSource = { url: string; title: string };

// Hosts only: IP literals and local names are never shown as sources (web: agentWebSources).
const PUBLIC_URL = /^(https?):\/\/([^/?#@\s]+)([^#\s]*)/i;

function publicSourceUrl(value: string) {
	const match = PUBLIC_URL.exec(value.trim());
	const host = match?.[2]?.toLowerCase().replace(/\.$/, "");
	if (!match || !host) return null;
	if (
		!host.includes(".") ||
		/^[\d.]+$/.test(host) ||
		host.includes(":") ||
		/(?:^|\.)(?:localhost|local|internal|lan)$/.test(host) ||
		host.endsWith(".home.arpa")
	)
		return null;
	return `${match[1]?.toLowerCase()}://${host}${match[3] ?? ""}`;
}

/** Sources from successful retrieval and native source parts, never links invented in response text. */
export function webSources(message: UIMessage): WebSource[] {
	const sources = new Map<string, WebSource>();
	const add = (value: unknown, title: unknown) => {
		const url = typeof value === "string" ? publicSourceUrl(value) : null;
		if (url && !sources.has(url)) sources.set(url, { url, title: (typeof title === "string" && title.trim()) || url });
	};
	for (const part of message.parts) {
		if (part.type === "source-url") {
			add(part.url, part.title);
			continue;
		}
		const tool = part as { state?: string; output?: unknown };
		if (tool.state !== "output-available") continue;
		if (part.type === "tool-search_web" && Array.isArray(tool.output))
			for (const result of tool.output as { url?: unknown; title?: unknown }[]) add(result.url, result.title);
		if (part.type === "tool-read_page" && tool.output && typeof tool.output === "object") {
			const page = tool.output as { resolvedUrl?: unknown; requestedUrl?: unknown };
			add(page.resolvedUrl ?? page.requestedUrl, "");
		}
	}
	return [...sources.values()];
}

type TranscriptLabels = { user: string; assistant: string; sources: string };

/** The conversation as plain text, speaker by speaker, for Copy transcript. Tool steps are left out. */
export function transcriptOf(messages: readonly UIMessage[], labels: TranscriptLabels) {
	return messages
		.flatMap((message) => {
			const sources = webSources(message)
				.map((source) => `${source.title}: ${source.url}`)
				.join("\n");
			const content = [textOf(message), ...(sources ? [`${labels.sources}:\n${sources}`] : [])]
				.filter(Boolean)
				.join("\n\n");
			return content ? [`${message.role === "user" ? labels.user : labels.assistant}: ${content}`] : [];
		})
		.join("\n\n");
}

/** Conversations for the signed-in server, newest first. */
export function useThreads() {
	const session = useSession();
	const scope = getAccountScope();
	const options = orpc.agent.threads.list.queryOptions({ input: {}, context: { scope: scope ?? "" } });
	return useQuery({
		...options,
		queryKey: [...options.queryKey, scope],
		enabled: session.status === "signed-in",
	});
}

export const refreshThreads = (queryClient: ReturnType<typeof useQueryClient>) =>
	void queryClient.invalidateQueries({ queryKey: orpc.agent.threads.key() });

type UseAssistantChatInput = {
	threadId: string;
	initialMessages: UIMessage[];
	/** Read when a message is sent, so the chips always apply to the next message. */
	context: MessageContext;
	onFinish: () => void;
	scope: string;
	beforeSend?: (() => Promise<boolean>) | undefined;
};

/**
 * The conversation's chat: messages stream in over oRPC, answers to the assistant's questions continue the reply,
 * and only the newest message is sent (the server keeps the transcript).
 */
/** Running replies are picked up by the caller (chat-view.tsx `recoverRun`), not on mount. */
export function useAssistantChat({
	threadId,
	initialMessages,
	context,
	onFinish,
	scope,
	beforeSend,
}: UseAssistantChatInput) {
	const contextRef = useRef(context);
	const onFinishRef = useRef(onFinish);
	const beforeSendRef = useRef(beforeSend);
	useLayoutEffect(() => {
		contextRef.current = context;
		onFinishRef.current = onFinish;
		beforeSendRef.current = beforeSend;
	});

	// One Chat per conversation (the caller keys it by thread), so callers can hold it outside render (chat-view.tsx).
	const instance = useMemo(() => {
		const agentMessages: AgentMessagesApi = {
			// The server validates the UI message; bind every request to this conversation's account.
			send: (input, options) => streamClient.agent.messages.send(input as never, { ...options, context: { scope } }),
			resume: (input, options) => streamClient.agent.messages.resume(input, { ...options, context: { scope } }),
		};
		const chat: Chat<UIMessage> = new Chat<UIMessage>({
			id: threadId,
			messages: initialMessages,
			transport: {
				// The server's resumable stream replays the reply from its start, so the client starts the message over.
				resumeStreamIsReplay: true,
				sendMessages: async (options) => {
					if (beforeSendRef.current && !(await beforeSendRef.current()))
						throw new ORPCError("PRECONDITION_FAILED", { message: t`Save the document before sending.` });
					options.abortSignal?.throwIfAborted();
					return sendAgentMessage(agentMessages, threadId, contextRef.current, options);
				},
				// A resumed run keeps the parts of the message from before it, as the chat shows them now.
				reconnectToStream: ({ abortSignal }) =>
					resumeAgentStream(agentMessages, threadId, {
						signal: abortSignal,
						messageById: (id) => chat.messages.find((message) => message.id === id),
					}),
			},
			sendAutomaticallyWhen: (input) =>
				lastAssistantMessageIsCompleteWithToolCalls(input) ||
				lastAssistantMessageIsCompleteWithApprovalResponses(input),
			onFinish: () => onFinishRef.current(),
		});
		return chat;
		// The initial messages are read once, when the chat is created.
		// oxlint-disable-next-line react-hooks/exhaustive-deps -- the chat takes its messages once; it's keyed by thread
	}, [threadId, scope]);

	return { ...useChat<UIMessage>({ chat: instance, throttle: 50 }), instance };
}
