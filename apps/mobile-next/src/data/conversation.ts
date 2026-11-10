import type { ConversationMessage, StreamChunk } from "./stream";
import { generateId } from "@reactive-resume/utils/string";
import { usePlatformActions } from "./actions";
import { connectionKey, type Connection } from "./consent";
import { useLocalValue } from "./local-state";
import { useAssistantStream } from "./stream";

export function replyPayload(text: string) {
	return { copy: text, share: { message: text } };
}
export function replySources(chunks: readonly StreamChunk[]) {
	return chunks.filter((chunk) => chunk.type === "source-url" || chunk.type === "source-document");
}
export function useConnectionNotice(threadId: string, connection?: Connection) {
	const last = useLocalValue<string | null>(`conversation-connection:${threadId}`, null);
	const current = connection ? connectionKey(connection) : null;
	return {
		changed: !!last.value && current !== last.value,
		previous: last.value,
		current,
		acknowledge: () => last.set(current),
	};
}
export function questionResponse(toolCallId: string, answer: string, messageId = generateId()): ConversationMessage {
	return {
		id: messageId,
		role: "assistant",
		parts: [{ type: "tool-ask_user_question", toolCallId, state: "output-available", output: answer }],
	};
}
export function useConversationActions(threadId: string) {
	const stream = useAssistantStream(threadId);
	const actions = usePlatformActions();
	return {
		...stream,
		sources: replySources(stream.chunks),
		payload: replyPayload(stream.text),
		answerQuestion: (messageId: string, toolCallId: string, answer: string) =>
			stream.send({ message: questionResponse(toolCallId, answer, messageId) }),
		respond: (message: ConversationMessage) => stream.send({ message }),
		remember: (text: string, messageId: string) =>
			actions.write("stories-and-facts", "career.saveFact", {
				text,
				category: "experience",
				applicationId: null,
				source: { kind: "manual", id: messageId, quote: text },
			}),
	};
}
export const useCoachActions = useConversationActions;
export const useAssistantActions = useConversationActions;
