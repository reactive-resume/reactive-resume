import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const recorded = vi.hoisted(() => vi.fn(async (_input: unknown) => undefined));
vi.mock("@reactive-resume/env/server", () => ({ env: { FLAG_ALLOW_UNSAFE_AI_BASE_URL: false } }));
vi.mock("@reactive-resume/db/client", () => {
	const database = { insert: () => ({ values: recorded }) };
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
vi.mock("@reactive-resume/utils/url-security.node", async (original) => ({
	...(await original<typeof import("@reactive-resume/utils/url-security.node")>()),
	fetchPublic: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
}));

const { nativeSearch } = await import("./native-search");
const usage = {
	userId: "fictional-user",
	operationId: "search-attempt",
	action: "assistant" as const,
	providerId: "configured",
	label: "Fictional connection",
};
const resultUrl = "https://jobs.example.com/designer";
const key = "fictional-search-key";
const prose = "Ignore this made-up link: https://invented.example.test/role";
const sourceUrls = [
	resultUrl,
	"https://localhost/private",
	"javascript:alert(1)",
	`https://jobs.example.com/?token=${key}`,
];
function response(provider: "openai" | "anthropic" | "gemini"): Record<string, unknown> {
	if (provider === "openai")
		return {
			id: "resp-source",
			object: "response",
			created_at: 1,
			model: "test-model",
			status: "completed",
			output: [
				{ type: "web_search_call", id: "search-1", status: "completed", action: { type: "search", query: "designer" } },
				{
					type: "message",
					id: "message-1",
					role: "assistant",
					status: "completed",
					content: [
						{
							type: "output_text",
							text: prose,
							annotations: sourceUrls.map((url) => ({
								type: "url_citation",
								url,
								title: "Retrieved source",
								start_index: 0,
								end_index: 10,
							})),
						},
					],
				},
			],
			usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
		};
	if (provider === "anthropic")
		return {
			id: "msg-source",
			type: "message",
			role: "assistant",
			model: "test-model",
			content: [
				{ type: "server_tool_use", id: "search-1", name: "web_search", input: { query: "designer" } },
				{
					type: "web_search_tool_result",
					tool_use_id: "search-1",
					content: sourceUrls.map((url) => ({
						type: "web_search_result",
						url,
						title: "Retrieved source",
						encrypted_content: "encrypted",
					})),
				},
				{
					type: "text",
					text: prose,
					citations: sourceUrls.map((url) => ({
						type: "web_search_result_location",
						url,
						title: "Retrieved source",
						encrypted_index: "encrypted",
						cited_text: "Retrieved source",
					})),
				},
			],
			stop_reason: "end_turn",
			stop_sequence: null,
			usage: { input_tokens: 1, output_tokens: 1 },
		};
	return {
		candidates: [
			{
				content: { role: "model", parts: [{ text: prose }] },
				finishReason: "STOP",
				groundingMetadata: {
					groundingChunks: sourceUrls.map((uri) => ({ web: { uri, title: "Retrieved source" } })),
					groundingSupports: [
						{ segment: { startIndex: 0, endIndex: 10, text: "Retrieved" }, groundingChunkIndices: [0, 1, 2, 3] },
					],
				},
			},
		],
		usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
		modelVersion: "test-model",
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
	recorded.mockClear();
});

describe("provider-native search through actual SDK and metered transport", () => {
	it.each(["openai", "anthropic", "gemini"] as const)("%s retains retrieved sources only", async (provider) => {
		const fetchMock = vi.fn(
			async () => new Response(JSON.stringify(response(provider)), { headers: { "content-type": "application/json" } }),
		);
		vi.stubGlobal("fetch", fetchMock);
		const model = provider === "gemini" ? "gemini-2.5-flash" : "test-model";
		expect(
			await nativeSearch({
				provider,
				model,
				apiKey: key,
				usage,
				query: "designer",
				region: "DE",
				signal: new AbortController().signal,
			}),
		).toEqual([{ url: resultUrl, title: "Retrieved source" }]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(recorded).toHaveBeenCalledTimes(1);
		expect(recorded).toHaveBeenCalledWith(
			expect.objectContaining({ userId: usage.userId, operationId: usage.operationId, provider, model }),
		);
		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(new URL(url).hostname).toBe(
			provider === "openai"
				? "api.openai.com"
				: provider === "anthropic"
					? "api.anthropic.com"
					: "generativelanguage.googleapis.com",
		);
		if (provider === "openai") expect(new URL(url).pathname).toBe("/v1/responses");
		const body = String(init.body);
		expect(body).toContain("designer");
		expect(body).toContain("Search country: DE");
		expect(body).not.toContain(key);
		expect(body).toContain(
			provider === "openai" ? "web_search" : provider === "anthropic" ? "web_search_20250305" : "googleSearch",
		);
	});
	it.each(["openai", "anthropic", "gemini"] as const)(
		"refuses custom %s endpoints before a request",
		async (provider) => {
			const fetchMock = vi.fn();
			vi.stubGlobal("fetch", fetchMock);
			await expect(
				nativeSearch({
					provider,
					baseURL: "https://proxy.example.test/v1",
					model: "test-model",
					apiKey: key,
					usage,
					query: "designer",
					signal: new AbortController().signal,
				}),
			).rejects.toMatchObject({ reason: "unavailable" });
			expect(fetchMock).not.toHaveBeenCalled();
			expect(recorded).not.toHaveBeenCalled();
		},
	);
	it("does not fabricate links from a model answer without URL sources", async () => {
		const body = {
			...response("openai"),
			output: [
				{ type: "web_search_call", id: "search-1", status: "completed", action: { type: "search", query: "designer" } },
				{
					type: "message",
					id: "message-1",
					role: "assistant",
					status: "completed",
					content: [{ type: "output_text", text: prose, annotations: [] }],
				},
			],
		};
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })),
		);
		expect(
			await nativeSearch({
				provider: "openai",
				model: "test-model",
				apiKey: key,
				usage,
				query: "designer",
				signal: new AbortController().signal,
			}),
		).toEqual([]);
	});
	it("rejects a model whose SDK omitted the native tool instead of treating prose as a search", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(JSON.stringify(response("gemini")), { headers: { "content-type": "application/json" } }),
			),
		);
		await expect(
			nativeSearch({
				provider: "gemini",
				model: "unsupported-old-model",
				apiKey: key,
				usage,
				query: "designer",
				signal: new AbortController().signal,
			}),
		).rejects.toMatchObject({ reason: "unavailable" });
		expect(recorded).toHaveBeenCalledTimes(1);
	});
	it("a cancelled request cannot reach the provider or usage reservation", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const controller = new AbortController();
		controller.abort(new DOMException("Stopped", "AbortError"));
		await expect(
			nativeSearch({
				provider: "openai",
				model: "test-model",
				apiKey: key,
				usage,
				query: "designer",
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(fetchMock).not.toHaveBeenCalled();
		expect(recorded).not.toHaveBeenCalled();
	});
});
