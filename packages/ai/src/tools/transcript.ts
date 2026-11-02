import type { ProposeEditsOutput } from "./agent-tool-contracts";
import type { UIMessage } from "ai";
import { agentWebSources } from "./agent-tool-contracts";

type EditStatus = ProposeEditsOutput["edits"][number]["status"];

export type TranscriptEdit = {
	/** 1-based, counted across the conversation, as the cards number them. */
	number: number;
	location: string;
	before: string;
	after: string;
	status: EditStatus;
};

export type TranscriptLabels = {
	user: string;
	assistant: string;
	sources: string;
	/** One line per proposed edit, e.g. `Edit 2 · Northwind Labs · bullet 1: "…" → "…" (accepted)`. */
	edit: (edit: TranscriptEdit) => string;
	/** A question the assistant asked, with the user's answer when there is one. */
	question: (question: string, answer: string | null) => string;
};

type ToolPart = { type: string; state?: string; input?: unknown; output?: unknown };

/**
 * The conversation as plain text, speaker by speaker, for Copy transcript: what was said, the edits proposed with what
 * became of each, and the questions with their answers. `statusOf` gives an edit's current decision when the app
 * knows a newer one than the stored output (a receipt).
 */
export function transcriptOf(
	messages: readonly UIMessage[],
	labels: TranscriptLabels,
	statusOf: (id: string) => EditStatus | undefined = () => undefined,
) {
	let count = 0;
	return messages
		.flatMap((message) => {
			const blocks: string[] = [];
			for (const part of message.parts as ToolPart[]) {
				if (part.type === "text") {
					const text = (part as { text?: string }).text?.trim();
					if (text) blocks.push(text);
					continue;
				}
				if (part.type === "tool-propose_edits" && part.state === "output-available") {
					const edits = (part.output as ProposeEditsOutput | undefined)?.edits ?? [];
					const lines = edits.map((edit) =>
						labels.edit({
							number: ++count,
							location: edit.location,
							before: edit.before,
							after: edit.after,
							status: statusOf(edit.id) ?? edit.status,
						}),
					);
					if (lines.length > 0) blocks.push(lines.join("\n"));
					continue;
				}
				if (part.type === "tool-ask_user_question") {
					const question = (part.input as { question?: unknown } | undefined)?.question;
					if (typeof question !== "string" || !question.trim()) continue;
					const answer = part.state === "output-available" && typeof part.output === "string" ? part.output : null;
					blocks.push(labels.question(question.trim(), answer));
				}
			}
			const sources = agentWebSources(message)
				.map((source) => `${source.title}: ${source.url}`)
				.join("\n");
			if (sources) blocks.push(`${labels.sources}:\n${sources}`);
			return blocks.length > 0
				? [`${message.role === "user" ? labels.user : labels.assistant}: ${blocks.join("\n\n")}`]
				: [];
		})
		.join("\n\n");
}
