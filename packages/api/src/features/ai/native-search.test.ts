import type { AIProvider } from "@reactive-resume/ai/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateText } from "ai";
import { buildAgentTools } from "../agent/tools";
import { getAgentModel } from "./service";

afterEach(() => vi.unstubAllGlobals());
const source = "https://company.example/job";
const cases = [
	{
		provider: "openai",
		model: "gpt-5-mini",
		path: "/v1/responses",
		response: {
			id: "resp_1",
			object: "response",
			created_at: 1,
			model: "gpt-5-mini",
			status: "completed",
			output: [
				{
					type: "message",
					id: "msg_1",
					role: "assistant",
					status: "completed",
					content: [
						{
							type: "output_text",
							text: "Job",
							annotations: [
								{
									type: "url_citation",
									url: source,
									title: "Job",
									start_index: 0,
									end_index: 3,
								},
							],
						},
					],
				},
			],
			usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
		},
	},
	{
		provider: "anthropic",
		model: "claude-sonnet-4-6",
		path: "/v1/messages",
		response: {
			id: "msg_1",
			type: "message",
			role: "assistant",
			model: "claude-sonnet-4-6",
			content: [
				{
					type: "text",
					text: "Job",
					citations: [
						{
							type: "web_search_result_location",
							url: source,
							title: "Job",
							encrypted_index: "opaque",
							cited_text: "Job",
						},
					],
				},
			],
			stop_reason: "end_turn",
			stop_sequence: null,
			usage: { input_tokens: 1, output_tokens: 1 },
		},
	},
	{
		provider: "gemini",
		model: "gemini-3.8-flash",
		path: "/v1beta/models/gemini-3.8-flash:generateContent",
		response: {
			candidates: [
				{
					content: { role: "model", parts: [{ text: "Job" }] },
					finishReason: "STOP",
					groundingMetadata: {
						groundingChunks: [{ web: { uri: source, title: "Job" } }],
						groundingSupports: [
							{
								segment: { startIndex: 0, endIndex: 3, text: "Job" },
								groundingChunkIndices: [0],
							},
						],
						webSearchQueries: ["company job"],
					},
				},
			],
			usageMetadata: {
				promptTokenCount: 1,
				candidatesTokenCount: 1,
				totalTokenCount: 2,
			},
		},
	},
] satisfies Array<{
	provider: AIProvider;
	model: string;
	path: string;
	response: unknown;
}>;

describe("native search SDK protocol", () => {
	it.each([400, 200])("retains Anthropic search failures returned with HTTP %i", async (status) => {
		const provider = { provider: "anthropic" as const, model: "claude-sonnet-4-6", apiKey: "test" };
		const message = "Web search is not enabled for this organization.";
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify(
							status === 400
								? { type: "error", error: { type: "invalid_request_error", message } }
								: {
										...cases[1]?.response,
										content: [
											{ type: "server_tool_use", id: "search_1", name: "web_search", input: { query: "company job" } },
											{
												type: "web_search_tool_result",
												tool_use_id: "search_1",
												content: { type: "web_search_tool_result_error", error_code: "unavailable" },
											},
										],
									},
						),
						{ status, headers: { "content-type": "application/json" } },
					),
			),
		);
		const tools = buildAgentTools({
			provider,
			document: "resume",
			externalSearch: false,
			signal: new AbortController().signal,
			handlers: {
				readDocument: async () => ({}),
				readAttachment: async () => ({}),
				proposeEdits: async () => ({}),
				searchWeb: async () => [],
				readPage: () => Promise.reject(new Error("Not used")),
			},
		});
		const response = generateText({
			model: getAgentModel(provider),
			tools,
			prompt: "Search company job",
			maxRetries: 0,
		});
		if (status === 400) {
			await expect(response).rejects.toMatchObject({ statusCode: 400, message });
		} else {
			const result = await response;
			expect(result.content).toContainEqual(
				expect.objectContaining({
					type: "tool-error",
					toolName: "web_search",
					error: { type: "web_search_tool_result_error", errorCode: "unavailable" },
				}),
			);
			expect(result.sources).toEqual([]);
		}
	});
	it("does not select Responses or a native tool for an unknown dated model", async () => {
		const request = vi.fn(
			async (url: unknown) =>
				new Response(
					JSON.stringify(
						String(url).includes("/responses")
							? cases[0]?.response
							: {
									id: "chat",
									object: "chat.completion",
									created: 1,
									model: "gpt-5-2099-01-01",
									choices: [
										{
											index: 0,
											message: { role: "assistant", content: "Answer" },
											finish_reason: "stop",
										},
									],
									usage: {
										prompt_tokens: 1,
										completion_tokens: 1,
										total_tokens: 2,
									},
								},
					),
					{ headers: { "content-type": "application/json" } },
				),
		);
		vi.stubGlobal("fetch", request);
		const provider = {
			provider: "openai" as const,
			model: "gpt-5-2099-01-01",
			apiKey: "test",
		};
		const tools = buildAgentTools({
			provider,
			document: "resume",
			externalSearch: false,
			signal: new AbortController().signal,
			handlers: {
				readDocument: async () => ({}),
				readAttachment: async () => ({}),
				proposeEdits: async () => ({}),
				searchWeb: async () => [],
				readPage: () => Promise.reject(new Error("Not used")),
			},
		});
		await generateText({
			model: getAgentModel(provider),
			tools,
			prompt: "Hello",
			maxRetries: 0,
		});
		expect(String(request.mock.calls[0]?.[0])).toContain("/v1/chat/completions");
		expect(tools.web_search).toBeUndefined();
		expect(tools.read_resume).toBeDefined();
	});
	it.each(cases)(
		"keeps native search and document tools in the $provider request and returns sources",
		async (entry) => {
			const request = vi.fn(
				async (_url: unknown, _init: RequestInit | undefined) =>
					new Response(JSON.stringify(entry.response), {
						headers: { "content-type": "application/json" },
					}),
			);
			vi.stubGlobal("fetch", request);
			const provider = {
				provider: entry.provider,
				model: entry.model,
				apiKey: "test-only",
			};
			const tools = buildAgentTools({
				provider,
				document: "resume",
				externalSearch: false,
				signal: new AbortController().signal,
				handlers: {
					readDocument: async () => ({}),
					readAttachment: async () => ({}),
					proposeEdits: async () => ({}),
					searchWeb: async () => [],
					readPage: () => Promise.reject(new Error("Not used")),
				},
			});
			const result = await generateText({
				model: getAgentModel(provider),
				tools,
				prompt: "Search company job",
				maxRetries: 0,
				maxOutputTokens: 64,
			});
			expect(String(request.mock.calls[0]?.[0])).toContain(entry.path);
			const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body));
			if (entry.provider === "gemini") {
				expect(body.tools).toContainEqual({ googleSearch: {} });
				expect(
					body.tools
						.flatMap((tool: { functionDeclarations?: Array<{ name: string }> }) => tool.functionDeclarations ?? [])
						.map((tool: { name: string }) => tool.name),
				).toContain("read_resume");
				expect(body.toolConfig.includeServerSideToolInvocations).toBe(true);
			} else {
				expect(body.tools.map((tool: { name?: string }) => tool.name)).toContain("read_resume");
				expect(
					body.tools.some(
						(tool: { type: string }) =>
							tool.type === (entry.provider === "openai" ? "web_search" : "web_search_20250305"),
					),
				).toBe(true);
			}
			expect(result.sources.map((item) => (item.sourceType === "url" ? item.url : ""))).toContain(source);
			expect(result.warnings).not.toContainEqual(
				expect.objectContaining({
					feature: "combination of function and provider-defined tools",
				}),
			);
		},
	);

	it.each([
		{ provider: "openai", model: "unknown-model" },
		{
			provider: "anthropic",
			model: "claude-sonnet-4-6",
			baseURL: "https://gateway.example/v1",
		},
		{ provider: "gemini", model: "gemini-2.5-flash" },
		{ provider: "gemini", model: "gemini-future" },
	] satisfies Array<{ provider: AIProvider; model: string; baseURL?: string }>)(
		"retains function tools without falsely advertising native search for $model",
		(provider) => {
			const tools = buildAgentTools({
				provider: { ...provider, apiKey: "test" },
				document: "resume",
				externalSearch: false,
				signal: new AbortController().signal,
				handlers: {
					readDocument: async () => ({}),
					readAttachment: async () => ({}),
					proposeEdits: async () => ({}),
					searchWeb: async () => [],
					readPage: () => Promise.reject(new Error("Not used")),
				},
			});
			expect(tools.web_search).toBeUndefined();
			expect(tools.google_search).toBeUndefined();
			expect(tools.read_resume).toBeDefined();
			expect(tools.read_page).toBeDefined();
		},
	);
});
