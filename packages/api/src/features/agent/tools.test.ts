import type { ReadPageOutput } from "@reactive-resume/ai/tools/agent-tool-contracts";
import { describe, expect, it, vi } from "vitest";
import { buildAgentInstructions, buildAgentTools, MAX_AGENT_WEB_CALLS } from "./tools";

const page: ReadPageOutput = {
	requestedUrl: "https://example.com/job",
	content: "Job description",
	format: "text",
	retrievedAt: "2026-09-30T12:00:00Z",
	method: "builtin",
	truncated: false,
	completeness: "unknown",
};
function build(externalSearch = false, signal = new AbortController().signal) {
	const handlers = {
		readDocument: vi.fn(async () => ({ text: "Resume" })),
		readAttachment: vi.fn(async () => ({})),
		proposeEdits: vi.fn(async () => ({})),
		searchWeb: vi.fn(async () => [{ url: "https://example.com/job", title: "Job" }]),
		readPage: vi.fn(async () => page),
	};
	return {
		handlers,
		tools: buildAgentTools({
			provider: { provider: "openai", model: "gpt-5-mini", apiKey: "test" },
			document: "resume",
			externalSearch,
			signal,
			handlers,
		}),
	};
}
const options = { toolCallId: "call", messages: [] };
function execute(tools: ReturnType<typeof buildAgentTools>, name: string, input: unknown) {
	const run = tools[name]?.execute;
	if (!run) throw new Error(`Missing executable tool ${name}`);
	return (run as unknown as (input: unknown, executionOptions: typeof options) => unknown)(input, options);
}

describe("assistant web tools", () => {
	it("respects an explicit connection while keeping reading available without search credentials", async () => {
		const native = build();
		expect(native.tools.web_search).toBeDefined();
		expect(native.tools.search_web).toBeUndefined();
		expect(await execute(native.tools, "read_page", { url: page.requestedUrl })).toEqual(page);
		const external = build(true);
		expect(external.tools.web_search).toBeUndefined();
		expect(await execute(external.tools, "search_web", { query: "Example company" })).toEqual([
			{ url: "https://example.com/job", title: "Job" },
		]);
		expect(external.handlers.searchWeb).toHaveBeenCalledWith("Example company", expect.any(AbortSignal));
	});

	it("shares one allowance across reading and search and never starts an aborted request", async () => {
		const controller = new AbortController();
		const { tools, handlers } = build(true, controller.signal);
		for (let i = 0; i < MAX_AGENT_WEB_CALLS - 1; i++) await execute(tools, "read_page", { url: page.requestedUrl });
		await execute(tools, "search_web", { query: "Company" });
		await expect(async () => execute(tools, "read_page", { url: page.requestedUrl })).rejects.toThrow(
			"Web access limit",
		);
		expect(handlers.readPage).toHaveBeenCalledTimes(MAX_AGENT_WEB_CALLS - 1);
		const pending = build(true, controller.signal);
		controller.abort(new DOMException("Stopped", "AbortError"));
		await expect(async () => execute(pending.tools, "search_web", { query: "Company" })).rejects.toThrow("Stopped");
		expect(pending.handlers.searchWeb).not.toHaveBeenCalled();
	});

	it("describes reader-only capabilities truthfully and names the selected search tool", () => {
		const reader = buildAgentInstructions({
			document: null,
			posting: null,
			searchTool: null,
			canReadPage: true,
		});
		expect(reader).toContain("Web search is unavailable");
		expect(reader).toContain("Use `read_page`");
		expect(reader).not.toContain("can't browse");
		expect(
			buildAgentInstructions({
				document: null,
				posting: null,
				searchTool: "google_search",
				canReadPage: true,
			}),
		).toContain("Use `google_search`");
	});
});
