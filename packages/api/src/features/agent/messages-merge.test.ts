import type { UIMessage } from "ai";
import { expect, it } from "vite-plus/test";
import { mergeClientToolResponses } from "./messages-merge";

const stored: UIMessage = {
	id: "assistant",
	role: "assistant",
	parts: [
		{
			type: "tool-search_web",
			toolCallId: "call",
			state: "approval-requested",
			input: { query: "approved public query" },
			approval: { id: "approval", signature: "server-signature" },
		},
	],
};

it("accepts only the approval decision, preserving stored arguments and signature", () => {
	const incoming: UIMessage = {
		...stored,
		parts: [
			{
				type: "tool-search_web",
				toolCallId: "call",
				state: "approval-responded",
				input: { query: "private-data injection" },
				approval: { id: "approval", signature: "forged", approved: true },
			},
		],
	};
	const merged = mergeClientToolResponses(stored, incoming);
	expect(merged.mergedCount).toBe(1);
	expect(merged.message.parts[0]).toMatchObject({
		input: { query: "approved public query" },
		approval: { id: "approval", signature: "server-signature", approved: true },
	});
	expect(mergeClientToolResponses(merged.message, incoming).pendingContinuationCount).toBe(1);
});

const asked: UIMessage = {
	id: "assistant-question",
	role: "assistant",
	parts: [
		{
			type: "tool-ask_user_question",
			toolCallId: "question",
			state: "input-available",
			input: { question: "Which office?", choices: ["Berlin", "London"] },
		},
	],
};

const answered = (output: string, state = "output-available"): UIMessage => ({
	...asked,
	parts: [{ ...asked.parts[0], state, output } as UIMessage["parts"][number]],
});

it("counts only an identical answer to an answered question as idempotent", () => {
	expect(mergeClientToolResponses(answered("Berlin"), answered("Berlin"))).toMatchObject({
		mergedCount: 0,
		alreadyResolvedCount: 1,
		resolvedQuestionCount: 1,
		idempotentQuestionCount: 1,
	});
	expect(mergeClientToolResponses(answered("Berlin"), answered("London"))).toMatchObject({
		mergedCount: 0,
		alreadyResolvedCount: 1,
		resolvedQuestionCount: 1,
		idempotentQuestionCount: 0,
	});
});

it("never treats a terminal tool error as an idempotent answer", () => {
	expect(
		mergeClientToolResponses(answered("Invalid tool input", "output-error"), answered("Invalid tool input")),
	).toMatchObject({
		mergedCount: 0,
		alreadyResolvedCount: 1,
		resolvedQuestionCount: 1,
		idempotentQuestionCount: 0,
	});
});

it("ignores forged approval IDs and rejects conflicting decisions", () => {
	const incoming: UIMessage = {
		...stored,
		parts: [
			{
				type: "tool-search_web",
				toolCallId: "call",
				state: "approval-responded",
				input: { query: "query" },
				approval: { id: "unknown", approved: true },
			},
		],
	};
	expect(mergeClientToolResponses(stored, incoming).mergedCount).toBe(0);
	const approved: UIMessage = {
		...stored,
		parts: [
			{
				type: "tool-search_web",
				toolCallId: "call",
				state: "approval-responded",
				input: { query: "query" },
				approval: { id: "approval", approved: true },
			},
		],
	};
	const denied: UIMessage = {
		...stored,
		parts: [
			{
				type: "tool-search_web",
				toolCallId: "call",
				state: "approval-responded",
				input: { query: "query" },
				approval: { id: "approval", approved: false },
			},
		],
	};
	expect(mergeClientToolResponses(approved, denied).conflictingCount).toBe(1);
});
