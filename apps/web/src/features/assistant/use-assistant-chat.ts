import type { MessageContext } from "./chat";
import type { AgentUIMessage } from "@reactive-resume/ai/tools/agent-tool-contracts";
import type { ChatTransport, UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import { eventIteratorToUnproxiedDataStream } from "@orpc/client";
import {
	lastAssistantMessageIsCompleteWithApprovalResponses,
	lastAssistantMessageIsCompleteWithToolCalls,
	parseJsonEventStream,
	uiMessageChunkSchema,
} from "ai";
import { useLayoutEffect, useMemo, useRef } from "react";
import { agentMessageMetadataSchema } from "@reactive-resume/ai/tools/agent-tool-contracts";
import { streamClient } from "@/libs/orpc/client";

// Apart from chat.ts so pages that only list conversations don't load the AI SDK.

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
		sendAutomaticallyWhen: (input) =>
			lastAssistantMessageIsCompleteWithToolCalls(input) || lastAssistantMessageIsCompleteWithApprovalResponses(input),
		onFinish,
	});
}
