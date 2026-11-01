import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createServer } from "node:http";

/**
 * A scripted OpenAI-compatible provider for the assistant spec. It answers the connection test, and plays a small
 * conversation: read the document, propose an edit to its first passage, then say what changed. A message asking
 * for "a question" makes it ask one first; "slowly" streams a long reply that can be stopped.
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

/** The Fit check a workspace asks for: one requirement with no evidence yet, so the spec can add some. */
const FIT = {
	headline: "A relevant role, with one question to resolve",
	summary: "Each requirement from the posting, checked against your Knowledge.",
	requirements: [
		{
			text: "Enterprise onboarding",
			origin: "posting",
			status: "missing",
			evidence: "Your Knowledge doesn't say this yet.",
			factIds: [],
		},
	],
	checks: [],
	ask: null,
	factIds: [],
};

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

function reply(request: ChatRequest, response: ServerResponse) {
	const messages = request.messages;
	const tools = new Set((request.tools ?? []).map((tool) => tool.function.name));
	const lastUser = [...messages].reverse().find((message) => message.role === "user");
	const said = text(lastUser?.content).toLowerCase();
	const sinceUser = messages.slice(messages.lastIndexOf(lastUser as ChatMessage) + 1);
	const lastTool = [...sinceUser].reverse().find((message) => message.role === "tool");
	const readTool = tools.has("read_letter") ? "read_letter" : "read_resume";

	response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });

	if (said.includes("slowly"))
		return streamText(
			response,
			Array.from({ length: 60 }, (_, index) => `word${index} `),
			150,
		);
	if (said.includes("review a story") && tools.has("save_story")) {
		if (lastTool) return streamText(response, ["Story decision received."]);
		const instructions = messages
			.filter((message) => message.role === "system")
			.map((message) => text(message.content))
			.join("\n");
		const factId = instructions.match(/"facts":\[\{"id":"([^"]+)"/)?.[1];
		return streamToolCall(response, "save_story", {
			title: "Improving customer onboarding",
			situation: "New customers needed clearer setup guidance.",
			task: "Make onboarding easier to follow.",
			action: "I wrote a setup checklist and reviewed it with support.",
			result: "",
			reflection: "Involve support early.",
			tags: ["onboarding"],
			factIds: factId ? [factId] : [],
		});
	}
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

	let result: {
		data?: {
			passages?: Array<{ id: string; sectionId?: string; text: string }>;
			entryTemplates?: Record<string, Record<string, unknown>>;
		};
	} = {};
	try {
		result = JSON.parse(text(lastTool.content) || "{}");
	} catch {
		// Not a read result.
	}
	const passage =
		lastToolName === readTool ? result.data?.passages?.find((item) => item.text && item.text !== "(empty)") : undefined;
	if (passage && said.includes("structural"))
		return streamToolCall(response, "propose_edits", {
			title: "Add reviewed certification section",
			changes: [
				{
					kind: "section",
					type: "certifications",
					title: "Training",
					entriesJson: JSON.stringify([
						{
							...result.data?.entryTemplates?.certifications,
							title: "CPACC",
							issuer: "IAAP",
							date: "2024",
						},
					]),
					why: "The user supplied this certification.",
				},
			],
		});
	if (passage) {
		const structured = request.tools?.find((tool) => tool.function.name === "propose_edits")?.function.parameters
			?.properties?.changes;
		const overlapping = said.includes("overlapping");
		const edits = overlapping
			? [
					{ passageId: passage.id, text: "Rewritten audit passage.", why: "Clarify the original." },
					{
						passageId: passage.id,
						text: "Mentored two junior designers.",
						why: "Retain the first addition.",
						add: true,
					},
					{
						passageId: passage.id,
						text: "Introduced accessibility reviews.",
						why: "Retain the second addition.",
						add: true,
					},
					{ passageId: passage.id, text: "A conflicting rewrite.", why: "Conflicts with the first rewrite." },
				]
			: [{ passageId: passage.id, text: `${passage.text} (tightened by the stub)`, why: "Leads with the outcome." }];
		const title = overlapping ? "Overlapping passage edits" : "Tighten the first passage";
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
		if (request.headers.authorization === "Bearer invalid-stub-key") {
			response.writeHead(401, { "content-type": "application/json" });
			response.end(JSON.stringify({ error: { message: "Synthetic invalid API key" } }));
			return;
		}
		// The connection test asks for a single character, without streaming; a workspace tab asks for its JSON.
		if (!parsed.stream) {
			const asksForFit = parsed.messages.some((message) =>
				text(message.content).includes("Check the posting's requirements"),
			);
			const asksForRoles = parsed.messages.some((message) =>
				text(message.content).includes("Suggest up to five plausible target job titles"),
			);
			const context = asksForRoles
				? (JSON.parse(text(parsed.messages.find((message) => message.role === "user")?.content)) as {
						facts: Array<{ id: string }>;
						resume: string | null;
					})
				: null;
			const roles = {
				suggestions: [
					{
						role: "Reliability engineer",
						factIds: context?.facts.slice(0, 1).map((fact) => fact.id) ?? [],
						resumeQuote: context?.resume?.slice(0, 60) ?? null,
					},
				],
			};
			const asksForWriting = parsed.messages.some((message) =>
				text(message.content).includes("experienced resume reviewer"),
			);
			const asksForImprove = parsed.messages.some((message) => text(message.content).includes("You improve one line"));
			// Reading an employer's message: an invitation to interview, which proposes moving the application there.
			const asksForReply = parsed.messages.some((message) =>
				text(message.content).includes("Read the employer's message."),
			);
			const everything = parsed.messages.map((message) => text(message.content)).join("\n");
			const asksForAnswer = everything.includes("Write the user's answer to the application form question");
			const content = asksForRoles
				? JSON.stringify(roles)
				: asksForFit
					? JSON.stringify(FIT)
					: asksForWriting
						? JSON.stringify({
								summary: "Fictional writing review retained after reload.",
								suggestions: [
									{
										section: "Summary",
										passageId:
											parsed.messages
												.map((message) => text(message.content))
												.join("\n")
												.match(/\[([^\]\n]+)\] Summary[^\n]*:/)?.[1] ?? null,
										issue: "Use a specific verb.",
										rewrite: "Led fictional delivery work.",
										impact: "medium",
									},
								],
								strengths: ["Clear fictional experience."],
								jdAlignment: null,
							})
						: asksForImprove
							? JSON.stringify({ text: "Led fictional delivery work.", why: "Uses a direct verb.", addsFacts: false })
							: asksForReply
								? JSON.stringify({
										title: "They're inviting you to interview",
										asks: [],
										unconfirmed: [],
										reply: "Thank you, I'd be glad to.",
										changes: [{ type: "stage", stage: "interview" }],
										offer: null,
									})
								: asksForAnswer
									? JSON.stringify({
											text: "I ran SLO burn reviews and cut noisy alerts.",
											factIds: [],
											note: "The 40% figure isn't in the supplied evidence; check it.",
										})
									: "1";
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
							message: { role: "assistant", content },
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
