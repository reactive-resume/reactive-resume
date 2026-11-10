import type { RouterInput } from "@/api/client";
import { fixtureProposals } from "./fixture-proposals";
import { screenTexts, recordFixtureMessages, fakeBackend } from "./fixtures";
let failAt: number | undefined;
export function setFakeStreamFailure(afterChunks?: number) {
	failAt = afterChunks;
}
export async function fakeReplyStream(
	threadId: string,
	input: RouterInput["agent"]["messages"]["send"] | undefined,
	signal: AbortSignal,
	replay: boolean,
): Promise<AsyncIterator<string>> {
	if (!replay && input?.message) recordFixtureMessages(threadId, input.message);
	const conversation = await fakeBackend.read("conversation", { id: threadId });
	const coach = conversation.thread.scope === "career";
	const copy = screenTexts(coach ? "C2-Coach" : "B16-Assistant");
	const text = coach
		? [copy[2], `${copy[4]}${copy[3]}`, `${copy[6]}${copy[5]}`].join("\n")
		: (copy.find((text) => text.startsWith("Three edits")) ?? "");
	const source = conversation.thread.sourceResumeId;
	const proposals = !coach && source ? fixtureProposals((await fakeBackend.read("resume", { id: source })).data) : [];
	const sources =
		!coach && input?.context?.posting !== false
			? [
					{
						type: "source-url",
						sourceId: "lumen-posting",
						url: "https://lumen.com/careers",
						title: "Lumen · Senior product designer",
					},
				]
			: [];
	const replyId = `reply-${conversation.messages.findLast((message) => message.role === "user")?.id ?? threadId}`;
	async function* stream() {
		const chunks = [
			{ type: "start", messageId: replyId },
			{ type: "text-start", id: "text" },
			...[0, 1, 2].map((index) => ({
				type: "text-delta",
				id: "text",
				delta: text.slice(Math.floor((text.length * index) / 3), Math.floor((text.length * (index + 1)) / 3)),
			})),
			{ type: "text-end", id: "text" },
			...sources,
			...(proposals.length
				? [{ type: "tool-output-available", toolCallId: `edits-${replyId}`, output: { edits: proposals } }]
				: []),
			{ type: "finish" },
		];
		for (const [index, chunk] of chunks.entries()) {
			signal.throwIfAborted();
			if (failAt !== undefined && index >= failAt) throw new Error("Fixture stream failed.");
			yield `data: ${JSON.stringify(chunk)}\n\n`;
			await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		}
		recordFixtureMessages(threadId, undefined, text, proposals, sources);
	}
	return stream();
}
