import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createServer } from "node:http";
import { COACH_ANSWER, careerJson, letterText } from "./ai-stub-career.ts";

/**
 * A scripted OpenAI-compatible provider for the assistant spec. It answers the connection test, and plays a small
 * conversation: read the document, propose an edit to its first passage, then say what changed. A message asking
 * for "a question" makes it ask one first; "slowly" streams a long reply that can be stopped. Structured career work,
 * letter drafts and the workspace coach get the persona's words from ai-stub-career.ts.
 */

type ChatMessage = { role: string; content?: unknown; tool_call_id?: string; tool_calls?: unknown[] };
type ChatRequest = {
	messages: ChatMessage[];
	tools?: Array<{ function: { name: string; parameters?: { properties?: Record<string, unknown> } } }>;
	stream?: boolean;
};

const text = (content: unknown) =>
	typeof content === "string"
		? content
		: Array.isArray(content)
			? content.map((part) => (part as { text?: string }).text ?? "").join("")
			: "";

function chunk(response: ServerResponse, delta: Record<string, unknown>, finish: string | null = null) {
	const body = {
		id: "chatcmpl-stub",
		object: "chat.completion.chunk",
		created: 0,
		model: "stub",
		choices: [{ index: 0, delta, finish_reason: finish }],
	};
	response.write(`data: ${JSON.stringify(body)}\n\n`);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function streamText(response: ServerResponse, words: string[], delayMs = 0) {
	chunk(response, { role: "assistant", content: "" });
	for (const word of words) {
		if (response.destroyed) return;
		chunk(response, { content: word });
		if (delayMs) await wait(delayMs);
	}
	chunk(response, {}, "stop");
	response.end("data: [DONE]\n\n");
}

function streamToolCall(response: ServerResponse, name: string, args: unknown) {
	chunk(response, {
		role: "assistant",
		content: null,
		tool_calls: [
			{
				index: 0,
				id: `call_${name}_${Date.now()}`,
				type: "function",
				function: { name, arguments: JSON.stringify(args) },
			},
		],
	});
	chunk(response, {}, "tool_calls");
	response.end("data: [DONE]\n\n");
}

const systemText = (messages: ChatMessage[]) =>
	messages
		.filter((message) => message.role === "system" || message.role === "developer")
		.map((message) => text(message.content))
		.join("\n");

function reply(request: ChatRequest, response: ServerResponse) {
	const messages = request.messages;
	const tools = new Set((request.tools ?? []).map((tool) => tool.function.name));
	const lastUser = [...messages].reverse().find((message) => message.role === "user");
	const said = text(lastUser?.content).toLowerCase();
	const sinceUser = messages.slice(messages.lastIndexOf(lastUser as ChatMessage) + 1);
	const lastTool = [...sinceUser].reverse().find((message) => message.role === "tool");
	const readTool = tools.has("read_letter") ? "read_letter" : "read_resume";

	response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
	const letter = letterText(systemText(messages), text(lastUser?.content));
	if (letter) return streamText(response, letter.split(/(?<= )/));
	if (said.includes("slowly"))
		return streamText(
			response,
			Array.from({ length: 60 }, (_, index) => `word${index} `),
			150,
		);
	const asked = sinceUser.some((message) =>
		(message.tool_calls as Array<{ function?: { name?: string } }> | undefined)?.some(
			(call) => call.function?.name === "ask_user_question",
		),
	);
	if (said.includes("question") && !asked && tools.has("ask_user_question"))
		return streamToolCall(response, "ask_user_question", {
			question: "The posting mentions accessibility. Have you done accessibility work?",
			choices: ["Yes, I have", "No, skip it"],
		});
	// The career coach: propose remembering what the user said about Harbour Studio, then answer.
	if (tools.has("remember_fact") && !tools.has("propose_edits")) {
		const remembered = sinceUser.some((message) => message.role === "tool");
		const quote = text(lastUser?.content).match(/I designed invoicing[^.?!]*[.?!]?/)?.[0];
		if (quote && !remembered) return streamToolCall(response, "remember_fact", { quote, category: "experience" });
		return streamText(response, COACH_ANSWER.split(/(?<= )/));
	}
	if (!tools.has("propose_edits"))
		return streamText(response, [
			asked ? "Thanks. I'll use your answer as we continue." : "You left the document out.",
		]);

	// The tool that produced the last result: read first, then propose, then say what changed.
	const calls = sinceUser.flatMap(
		(message) => (message.tool_calls as Array<{ id: string; function: { name: string } }> | undefined) ?? [],
	);
	const lastToolName = calls.find((call) => call.id === lastTool?.tool_call_id)?.function.name;
	if (!lastTool || lastToolName === "ask_user_question") return streamToolCall(response, readTool, {});

	let result: { data?: { passages?: Array<{ id: string; sectionId?: string; text: string }> } } = {};
	try {
		result = JSON.parse(text(lastTool.content) || "{}");
	} catch {
		// Not a read result.
	}
	const passage =
		lastToolName === readTool ? result.data?.passages?.find((item) => item.text && item.text !== "(empty)") : undefined;
	if (passage) {
		const structured = request.tools?.find((tool) => tool.function.name === "propose_edits")?.function.parameters
			?.properties?.changes;
		const edits = [
			{ passageId: passage.id, text: `${passage.text} (tightened by the stub)`, why: "Leads with the outcome." },
		];
		const title = "Tighten the first passage";
		return streamToolCall(
			response,
			"propose_edits",
			structured
				? { title, changes: edits.map((edit) => ({ ...edit, kind: "text", sectionId: passage.sectionId })) }
				: { title, edits },
		);
	}

	return streamText(response, [
		"I ",
		"tightened ",
		"one ",
		"passage. ",
		"Accept ",
		"it ",
		"if ",
		"it ",
		"reads ",
		"right.",
	]);
}

function handle(request: IncomingMessage, response: ServerResponse, requests: ChatRequest[]) {
	let body = "";
	request.on("data", (data) => {
		body += data;
	});
	request.on("end", () => {
		if (!request.url?.endsWith("/chat/completions")) {
			response.writeHead(404).end();
			return;
		}
		const parsed = JSON.parse(body || "{}") as ChatRequest;
		requests.push(parsed);
		// The connection test asks for a single character, without streaming; structured career work asks for JSON.
		if (!parsed.stream) {
			const prompt = text([...parsed.messages].reverse().find((message) => message.role === "user")?.content);
			const structured = careerJson(prompt);
			response.writeHead(200, { "content-type": "application/json" });
			response.end(
				JSON.stringify({
					id: "chatcmpl-stub",
					object: "chat.completion",
					created: 0,
					model: "stub",
					choices: [
						{
							index: 0,
							message: { role: "assistant", content: structured ? JSON.stringify(structured) : "1" },
							finish_reason: "stop",
						},
					],
					usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
				}),
			);
			return;
		}
		void reply(parsed, response);
	});
}

export async function startAiStub(port = 0) {
	// Retain synthetic requests in memory so browser tests can inspect the actual provider boundary.
	const requests: ChatRequest[] = [];
	const server = createServer((request, response) => handle(request, response, requests));
	await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
	const { port: bound } = server.address() as AddressInfo;
	return {
		baseURL: `http://127.0.0.1:${bound}/v1`,
		requests,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}
