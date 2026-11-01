import type { WorkspaceTab } from "@reactive-resume/schema/career";
import type { FileUIPart, UIMessage } from "ai";
import { agentWebSources } from "@reactive-resume/ai/tools/agent-tool-contracts";

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
