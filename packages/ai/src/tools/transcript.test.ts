import type { UIMessage } from "ai";
import { describe, expect, it } from "vite-plus/test";
import { transcriptOf } from "./transcript";

const labels = {
	user: "You",
	assistant: "Assistant",
	sources: "Sources",
	edit: ({
		number,
		location,
		before,
		after,
		status,
	}: {
		number: number;
		location: string;
		before: string;
		after: string;
		status: string;
	}) => `Edit ${number} · ${location}: "${before}" → "${after}" (${status})`,
	question: (question: string, answer: string | null) =>
		answer === null ? `Q: ${question}` : `Q: ${question}\nA: ${answer}`,
};

const edit = (id: string, before: string, after: string) => ({
	id,
	location: "Northwind Labs · bullet 1",
	before,
	after,
	status: "pending",
	target: { sectionId: "experience", field: "description" },
});

describe("transcriptOf", () => {
	it("separates text parts and lists edits and answered questions", () => {
		const messages = [
			{ id: "1", role: "user", parts: [{ type: "text", text: "Tighten my bullets" }] },
			{
				id: "2",
				role: "assistant",
				parts: [
					{ type: "text", text: "Here is one as a duplicate." },
					{
						type: "tool-propose_edits",
						state: "output-available",
						output: {
							edits: [edit("a", "Led work", "Led the redesign"), edit("b", "Ran tests", "Ran usability tests")],
							skipped: [],
						},
					},
					{ type: "text", text: "I proposed two edits." },
					{
						type: "tool-ask_user_question",
						state: "output-available",
						input: { question: "Did you lead it?", choices: ["Yes", "No"] },
						output: "Yes",
					},
				],
			},
		] as unknown as UIMessage[];

		expect(transcriptOf(messages, labels, (id) => (id === "a" ? "accepted" : undefined))).toBe(
			[
				"You: Tighten my bullets",
				[
					"Assistant: Here is one as a duplicate.",
					'Edit 1 · Northwind Labs · bullet 1: "Led work" → "Led the redesign" (accepted)\nEdit 2 · Northwind Labs · bullet 1: "Ran tests" → "Ran usability tests" (pending)',
					"I proposed two edits.",
					"Q: Did you lead it?\nA: Yes",
				].join("\n\n"),
			].join("\n\n"),
		);
	});

	it("leaves out messages with nothing to copy and unanswered questions keep their question", () => {
		const messages = [
			{ id: "1", role: "assistant", parts: [{ type: "step-start" }] },
			{
				id: "2",
				role: "assistant",
				parts: [{ type: "tool-ask_user_question", state: "input-available", input: { question: "Which role?" } }],
			},
		] as unknown as UIMessage[];
		expect(transcriptOf(messages, labels)).toBe("Assistant: Q: Which role?");
	});
});
