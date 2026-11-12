import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { generateText } from "ai";
import { buildAgentTools } from "../agent/tools";

const envMock = vi.hoisted(() => ({
	FLAG_ALLOW_UNSAFE_AI_BASE_URL: false,
}));

vi.mock("@reactive-resume/env/server", () => ({ env: envMock }));
vi.mock("@reactive-resume/db/client", () => {
	const database = { insert: () => ({ values: async () => undefined }) };
	return { db: { ...database, transaction: async (run: (tx: typeof database) => Promise<void>) => run(database) } };
});
vi.mock("../ai-providers/identity", async (original) => ({
	...(await original<typeof import("../ai-providers/identity")>()),
	assertProviderAvailable: async () => undefined,
}));
vi.mock("../documents/ownership", async (original) => ({
	...(await original<typeof import("../documents/ownership")>()),
	lockUser: async () => undefined,
}));
// Provider requests still reach the stubbed global fetch; fetchPublic's own network checks are tested in utils.
const fetchPublicMock = vi.hoisted(() => vi.fn((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init)));
vi.mock("@reactive-resume/utils/url-security.node", async (original) => ({
	...(await original<typeof import("@reactive-resume/utils/url-security.node")>()),
	fetchPublic: fetchPublicMock,
}));

afterEach(() => {
	vi.unstubAllGlobals();
});

function stubOpenAIResponse() {
	let requestBody: unknown;
	let requestHeaders: Headers | undefined;

	const fetchMock = vi.fn((input: unknown, init?: { body?: unknown; headers?: HeadersInit }) => {
		const body = JSON.parse(String(init?.body ?? "{}")) as {
			max_tokens?: number;
			max_completion_tokens?: number;
			max_output_tokens?: number;
		};
		requestBody = body;
		requestHeaders = new Headers(init?.headers);
		const hasEnoughOutputTokens = (body.max_tokens ?? body.max_completion_tokens ?? body.max_output_tokens ?? 0) >= 128;
		const text = hasEnoughOutputTokens ? "1" : "";
		if (String(input).endsWith("/responses")) {
			return new Response(
				JSON.stringify({
					id: "resp-test",
					object: "response",
					created_at: 1,
					model: "test-model",
					status: "completed",
					output: [
						{
							type: "message",
							id: "msg-test",
							role: "assistant",
							status: "completed",
							content: [{ type: "output_text", text, annotations: [] }],
						},
					],
					usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
				}),
				{ headers: { "Content-Type": "application/json" } },
			);
		}

		return new Response(
			JSON.stringify({
				id: "chatcmpl-test",
				object: "chat.completion",
				created: 1,
				model: "test-model",
				choices: [
					{
						index: 0,
						message: { role: "assistant", content: text },
						finish_reason: hasEnoughOutputTokens ? "stop" : "length",
					},
				],
				usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
			}),
			{ headers: { "Content-Type": "application/json" } },
		);
	});

	vi.stubGlobal("fetch", fetchMock);

	return { fetchMock, getRequestBody: () => requestBody, getRequestHeaders: () => requestHeaders };
}

const { getAgentModel, testConnection } = await import("./service");
const usage = {
	userId: "user",
	operationId: "test",
	action: "provider-test" as const,
	providerId: "connection",
	label: "Test connection",
	recipientVersion: "test-revision",
};

describe("AI chat service", () => {
	it("tests OpenAI-compatible providers without requiring structured output", async () => {
		const openAiCompatible = stubOpenAIResponse();

		await expect(
			testConnection({
				usage,
				provider: "openai-compatible",
				model: "test-model",
				apiKey: "test-key",
				baseURL: "https://example.test/v1",
			}),
		).resolves.toEqual({ ok: true });

		expect(openAiCompatible.fetchMock).toHaveBeenCalledTimes(1);
		// A user-chosen endpoint is reached only through the public-address transport.
		expect(fetchPublicMock).toHaveBeenCalledTimes(1);
		expect(openAiCompatible.getRequestBody()).not.toHaveProperty("response_format");
		expect(openAiCompatible.getRequestBody()).toMatchObject({ max_tokens: 128 });
	});
	it("tests a keyless OpenAI-compatible provider with only LM Studio-compatible fields", async () => {
		const openAiCompatible = stubOpenAIResponse();

		await expect(
			testConnection({
				usage,
				provider: "openai-compatible",
				model: "test-model",
				apiKey: "",
				baseURL: "https://lmstudio.example.test/v1",
			}),
		).resolves.toEqual({ ok: true });

		const body = openAiCompatible.getRequestBody() as Record<string, unknown>;
		expect(body).toMatchObject({ model: "test-model", max_tokens: 128 });
		for (const field of ["response_format", "tools", "tool_choice", "stream_options", "parallel_tool_calls"])
			expect(body).not.toHaveProperty(field);
		expect(openAiCompatible.getRequestHeaders()?.has("authorization")).toBe(false);
	});
	it("tests OpenAI reasoning models without unsupported setting warnings", async () => {
		const { fetchMock } = stubOpenAIResponse();
		const warnings = vi.fn();
		vi.stubGlobal("AI_SDK_LOG_WARNINGS", warnings);

		await expect(
			testConnection({ usage, provider: "openai", model: "gpt-6.1-sol", apiKey: "test-key", baseURL: "" }),
		).resolves.toEqual({ ok: true });

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(warnings).not.toHaveBeenCalled();
	});
	it.each([
		{ model: "gpt-6-luna", baseURL: "", path: "https://api.openai.com/v1/responses" },
		{ model: "gpt-6.1-sol", baseURL: "", path: "https://api.openai.com/v1/responses" },
		{
			model: "gpt-6-luna",
			baseURL: "https://api.openai.com/v1/",
			path: "https://api.openai.com/v1/responses",
		},
		{ model: "gpt-5-2099-01-01", baseURL: "", path: "https://api.openai.com/v1/responses" },
		{
			model: "gpt-5-mini",
			baseURL: "https://gateway.example/v1",
			path: "https://gateway.example/v1/chat/completions",
		},
	])("uses $path for $model with function tools and reasoning", async ({ model, baseURL, path }) => {
		const { fetchMock: request, getRequestBody } = stubOpenAIResponse();
		const provider = {
			usage,
			provider: "openai" as const,
			model,
			apiKey: "test",
			baseURL,
		};
		const tools = buildAgentTools({
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
			prompt: "Hello",
			providerOptions: { openai: { reasoningEffort: "medium" } },
			maxRetries: 0,
			maxOutputTokens: 128,
		});
		expect(String(request.mock.calls[0]?.[0])).toBe(path);
		expect(result.text).toBe("1");
		const body = getRequestBody() as Record<string, unknown>;
		if (path.endsWith("/responses")) {
			expect(body.reasoning).toMatchObject({ effort: "medium" });
			expect(body.tools).toContainEqual(expect.objectContaining({ type: "function", name: "read_resume" }));
		} else {
			expect(body.tools).toContainEqual(
				expect.objectContaining({ type: "function", function: expect.objectContaining({ name: "read_resume" }) }),
			);
		}
	});
});
