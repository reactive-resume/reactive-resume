import type { WorkspaceTab } from "@reactive-resume/schema/career";
import type { FileUIPart, UIMessage } from "ai";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { agentWebSources } from "@reactive-resume/ai/tools/agent-tool-contracts";
import { client, orpc } from "@/libs/orpc/client";

/** What a message shares with the model; each context chip turns one off. The career coach uses the last four. */
export type MessageContext = {
	document: boolean;
	posting: boolean;
	applicationId?: string;
	application?: boolean;
	memory?: boolean;
	web?: boolean;
	tab?: WorkspaceTab;
	offerIds?: string[];
};

export type ChatAttachment = { id: string; filename: string; mediaType: string };

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

/**
 * A conversation whose connection was switched off or removed continues on `provider` (the default, which its privacy
 * line names), rather than failing on send.
 */
export function useConversationConnection(
	summary: { id: string; aiProviderId: string | null } | undefined,
	provider: { id: string } | undefined,
) {
	const queryClient = useQueryClient();
	const staleId = summary && provider && summary.aiProviderId !== provider.id ? summary.id : null;
	const providerId = provider?.id;
	useEffect(() => {
		if (!staleId || !providerId) return;
		void client.agent.threads
			.update({ id: staleId, aiProviderId: providerId })
			.then(() => queryClient.invalidateQueries({ queryKey: orpc.agent.threads.key() }))
			.catch(() => undefined);
	}, [staleId, providerId, queryClient]);
}
