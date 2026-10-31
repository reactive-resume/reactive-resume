import type { ModelMessage, UIMessage } from "ai";
import { describe, expect, it } from "vite-plus/test";
import { estimateTokens, knowledgeWithdrawals, pruneAgentModelContext, withdrawKnowledgeReply } from "./context";

const BIG_RESUME = { basics: { name: "Alice" }, sections: { summary: { content: "x".repeat(2_000) } } };

function readResumeExchange(callId: string, toolName = "read_resume"): ModelMessage[] {
	return [
		{
			role: "assistant",
			content: [{ type: "tool-call", toolCallId: callId, toolName, input: {} }],
		},
		{
			role: "tool",
			content: [
				{
					type: "tool-result",
					toolCallId: callId,
					toolName,
					output: { type: "json", value: { id: "resume-1", data: BIG_RESUME } },
				},
			],
		},
	] as ModelMessage[];
}

function patchExchange(callId: string): ModelMessage[] {
	return [
		{
			role: "assistant",
			content: [{ type: "tool-call", toolCallId: callId, toolName: "apply_resume_patch", input: { title: "Edit" } }],
		},
		{
			role: "tool",
			content: [
				{
					type: "tool-result",
					toolCallId: callId,
					toolName: "apply_resume_patch",
					output: { type: "json", value: { actionId: `action-${callId}`, resume: BIG_RESUME } },
				},
			],
		},
	] as ModelMessage[];
}

function user(text: string): ModelMessage {
	return { role: "user", content: [{ type: "text", text }] };
}

function messageParts(message: ModelMessage | undefined) {
	return (message?.content ?? []) as Array<Record<string, unknown>>;
}

function snapshotValue(message: ModelMessage | undefined) {
	const part = messageParts(message)[0];
	return ((part?.output ?? {}) as { value?: Record<string, unknown> }).value ?? {};
}

describe("pruneAgentModelContext — tier 0 (snapshot supersession)", () => {
	it("keeps only the last cover letter snapshot too", () => {
		const messages = [
			user("hi"),
			...readResumeExchange("call-1", "read_letter"),
			...readResumeExchange("call-2", "read_letter"),
		];

		const pruned = pruneAgentModelContext(messages, 1_000_000);

		expect(snapshotValue(pruned[2])).not.toHaveProperty("data");
		expect(snapshotValue(pruned[4])).toHaveProperty("data");
	});
});

describe("pruneAgentModelContext — tier 3 (turn dropping)", () => {
	function textTurn(userText: string, assistantText: string): ModelMessage[] {
		return [
			{ role: "user", content: [{ type: "text", text: userText }] },
			{ role: "assistant", content: [{ type: "text", text: assistantText }] },
		];
	}

	it("drops tool call/result pairs atomically with their turn", () => {
		const messages = [
			...textTurn("intro ".repeat(60), "ok"),
			{ role: "user", content: [{ type: "text", text: "edit please ".repeat(60) }] } as ModelMessage,
			...patchExchange("call-old"),
			...textTurn("follow up ".repeat(30), "done"),
			...textTurn("latest question", "latest answer"),
		];

		const pruned = pruneAgentModelContext(messages, 40);

		// The dropped turn takes both the tool call and its result with it — no orphaned side.
		const text = JSON.stringify(pruned);
		expect(text).not.toContain("call-old");
		expect(text).not.toContain('"tool-result"');
		expect(text).toContain("latest question");
	});

	it("never drops the final two turns even when still over budget", () => {
		const messages = [
			...textTurn("first question ".repeat(100), "first answer ".repeat(100)),
			...textTurn("second question ".repeat(100), "second answer ".repeat(100)),
			...textTurn("third question ".repeat(100), "third answer ".repeat(100)),
		];

		const pruned = pruneAgentModelContext(messages, 10);

		// Only the oldest turn is droppable; the penultimate and final turns must both survive
		// even though the result is still over budget.
		expect(pruned).toHaveLength(4);
		expect(JSON.stringify(pruned)).not.toContain("first question");
		expect(JSON.stringify(pruned)).toContain("second question");
		expect(JSON.stringify(pruned)).toContain("third question");
	});
});

describe("estimateTokens", () => {
	it("treats binary attachment data as opaque bytes instead of serializing it", () => {
		const bytes = new Uint8Array(1024 * 1024);
		const message = { role: "user", content: [{ type: "image", image: bytes, mediaType: "image/png" }] };

		const estimate = estimateTokens(message);

		// ~bytes/4 tokens, computed without expanding each byte into JSON.
		expect(estimate).toBeGreaterThan(200_000);
		expect(estimate).toBeLessThan(300_000);
	});
});

it("withdraws every reply from the first Knowledge lookup on, words and proposals included", () => {
	const at = (hour: number) => new Date(Date.UTC(2030, 0, 1, hour));
	const reply = (id: string, parts: unknown[]) => ({ id, role: "assistant", parts }) as unknown as UIMessage;
	const user = (id: string) => ({ id, role: "user", parts: [{ type: "text", text: "Go on" }] }) as unknown as UIMessage;
	const history = [
		{ message: reply("before", [{ type: "text", text: "Hello" }]), createdAt: at(1) },
		{
			message: reply("lookup", [{ type: "tool-read_knowledge", state: "output-available", output: { facts: [] } }]),
			createdAt: at(2),
		},
		{ message: user("u1"), createdAt: at(3) },
		// Repeats the fact from history without another lookup, or asks about it.
		{ message: reply("derived", [{ type: "text", text: "Private fact" }]), createdAt: at(4) },
		{
			message: reply("question", [{ type: "tool-ask_user_question", input: { question: "Private fact?" } }]),
			createdAt: at(5),
		},
	];

	expect([...knowledgeWithdrawals(history, null)]).toEqual([]);
	expect([...knowledgeWithdrawals(history, null, false)]).toEqual(["lookup", "derived", "question"]);
	expect([...knowledgeWithdrawals(history, at(6))]).toEqual(["lookup", "derived", "question"]);
	// A fact changed after the first replies began: later ones were written without them.
	expect([...knowledgeWithdrawals(history, at(4))]).toEqual(["lookup", "derived"]);
	const derived = history[3]?.message as UIMessage;
	expect(JSON.stringify(withdrawKnowledgeReply(derived))).not.toContain("Private fact");
	expect(JSON.stringify(withdrawKnowledgeReply(derived, true))).not.toContain("Private fact");
});
