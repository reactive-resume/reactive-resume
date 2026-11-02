import type { TranscriptLabels } from "@reactive-resume/ai/tools/transcript";
import type { WorkspaceTab } from "@reactive-resume/schema/career";
import type { FileUIPart, UIMessage } from "ai";
import { t } from "@lingui/core/macro";
import { transcriptOf as sharedTranscriptOf } from "@reactive-resume/ai/tools/transcript";

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

type TranscriptNames = { user: string; assistant: string; sources: string };

/** Copy transcript's wording in the reader's language: speakers, edits with their outcome, and question answers. */
export function transcriptLabels(names: TranscriptNames): TranscriptLabels {
	const statusLabel = { pending: t`proposed`, accepted: t`accepted`, rejected: t`rejected` };
	return {
		...names,
		edit: ({ number, location, before, after, status }) => {
			const outcome = statusLabel[status];
			return before.trim()
				? t`Edit ${number} · ${location}: "${before}" → "${after}" (${outcome})`
				: t`Edit ${number} · ${location}: added "${after}" (${outcome})`;
		},
		question: (question, answer) => (answer === null ? t`Q: ${question}` : `${t`Q: ${question}`}\n${t`A: ${answer}`}`),
	};
}

/** The conversation as plain text for Copy transcript; `statusOf` gives edits' latest decisions. */
export const transcriptOf = (
	messages: readonly UIMessage[],
	names: TranscriptNames,
	statusOf?: (id: string) => "pending" | "accepted" | "rejected" | undefined,
) => sharedTranscriptOf(messages, transcriptLabels(names), statusOf);

export const fileToBase64 = (file: File) =>
	new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
		reader.onerror = reject;
		reader.readAsDataURL(file);
	});
