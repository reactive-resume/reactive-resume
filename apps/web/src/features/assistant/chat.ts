import type { AgentUIMessage } from "@reactive-resume/ai/tools/agent-tool-contracts";
import type { ChatTransport, FileUIPart, UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import { eventIteratorToUnproxiedDataStream } from "@orpc/client";
import { lastAssistantMessageIsCompleteWithToolCalls, parseJsonEventStream, uiMessageChunkSchema } from "ai";
import { useLayoutEffect, useMemo, useRef } from "react";
import { agentMessageMetadataSchema, agentWebSources } from "@reactive-resume/ai/tools/agent-tool-contracts";
import { streamClient } from "@/libs/orpc/client";

/** What a message shares with the model; each context chip turns one off. */
export type MessageContext = { document: boolean; posting: boolean; applicationId?: string };

export type ChatAttachment = { id: string; filename: string; mediaType: string };

function parseSse(stream: ReadableStream<string>) {
	return parseJsonEventStream({
		stream: stream.pipeThrough(new TextEncoderStream()),
		schema: uiMessageChunkSchema,
	}).pipeThrough(
		new TransformStream({
			transform(chunk, controller) {
				if (!chunk.success) {
					console.warn("[assistant] dropping malformed SSE frame", chunk.error);
					return;
				}
				controller.enqueue(chunk.value);
			},
		}),
	);
}

const attachmentIdsOf = (body: object | undefined) =>
	body && "attachmentIds" in body && Array.isArray(body.attachmentIds)
		? body.attachmentIds.filter((id): id is string => typeof id === "string")
		: undefined;

export const attachmentPart = (attachment: ChatAttachment): FileUIPart => ({
	type: "file",
	url: `agent-attachment:${attachment.id}`,
	mediaType: attachment.mediaType,
	filename: attachment.filename,
});

type TranscriptLabels = { user: string; assistant: string; sources?: string };

/** The conversation as plain text, speaker by speaker, for Copy transcript. Tool steps are left out. */
export function transcriptOf(messages: readonly UIMessage[], labels: TranscriptLabels) {
	return messages
		.flatMap((message) => {
			const text = message.parts
				.flatMap((part) => (part.type === "text" ? [part.text] : []))
				.join("")
				.trim();
			const sources = agentWebSources(message)
				.map((source) => `${source.title}: ${source.url}`)
				.join("\n");
			const content = [text, ...(sources ? [`${labels.sources ?? "Sources"}:\n${sources}`] : [])]
				.filter(Boolean)
				.join("\n\n");
			return content ? [`${message.role === "user" ? labels.user : labels.assistant}: ${content}`] : [];
		})
		.join("\n\n");
}

export const fileToBase64 = (file: File) =>
	new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
		reader.onerror = reject;
		reader.readAsDataURL(file);
	});

type UseAssistantChatInput = {
	threadId: string;
	initialMessages: UIMessage[];
	/** A reply was streaming when the conversation opened: pick it up again (needs Redis on the server). */
	resume: boolean;
	/** Read when a message is sent, so the chips always apply to the next message. */
	context: MessageContext;
	onFinish: () => void;
};

/**
 * The conversation's chat: messages stream in over oRPC, answers to the assistant's questions continue the reply,
 * and only the newest message is sent (the server keeps the transcript).
 */
export function useAssistantChat({ threadId, initialMessages, resume, context, onFinish }: UseAssistantChatInput) {
	const contextRef = useRef(context);
	useLayoutEffect(() => {
		contextRef.current = context;
	});

	const transport = useMemo<ChatTransport<AgentUIMessage>>(
		() => ({
			async sendMessages(options) {
				const message = options.messages.at(-1);
				if (!message) throw new Error("No message to send.");
				const attachmentIds = attachmentIdsOf(options.body);
				return parseSse(
					eventIteratorToUnproxiedDataStream(
						await streamClient.agent.messages.send(
							{ threadId, message, context: contextRef.current, ...(attachmentIds ? { attachmentIds } : {}) },
							options.abortSignal ? { signal: options.abortSignal } : {},
						),
					),
				);
			},
			async reconnectToStream() {
				return parseSse(eventIteratorToUnproxiedDataStream(await streamClient.agent.messages.resume({ threadId })));
			},
		}),
		[threadId],
	);

	return useChat<AgentUIMessage>({
		id: threadId,
		messages: initialMessages as AgentUIMessage[],
		resume,
		transport,
		throttle: 50,
		messageMetadataSchema: agentMessageMetadataSchema,
		sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
		onFinish,
	});
}
