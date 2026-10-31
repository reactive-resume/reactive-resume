import type { ReadPageOutput } from "@reactive-resume/ai/tools/agent-tool-contracts";
import type { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
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
type ToolConfig = Parameters<typeof buildAgentTools>[0];

function build(externalSearch = false, signal = new AbortController().signal) {
	const handlers = {
		readDocument: vi.fn(async () => ({ text: "Resume" })),
		readAttachment: vi.fn(async () => ({})),
		proposeEdits: vi.fn(async () => ({})),
		searchWeb: vi.fn<ToolConfig["handlers"]["searchWeb"]>(async () => [
			{ url: "https://example.com/job", title: "Job" },
		]),
		readPage: vi.fn<ToolConfig["handlers"]["readPage"]>(async () => page),
	};
	return {
		handlers,
		tools: buildAgentTools({
			document: "resume",
			externalSearch,
			signal,
			handlers,
		}),
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});
const options = { toolCallId: "call", messages: [] };
function execute(tools: ReturnType<typeof buildAgentTools>, name: string, input: unknown) {
	const run = tools[name]?.execute;
	if (!run) throw new Error(`Missing executable tool ${name}`);
	return (run as unknown as (input: unknown, executionOptions: typeof options) => unknown)(input, options);
}

describe("assistant web tools", () => {
	it("exposes typed resume operations and refuses legacy prose-only requests to create sections", () => {
		const schema = build().tools.propose_edits?.inputSchema as z.ZodType;
		expect(
			schema.safeParse({
				title: "Add Patents",
				edits: [{ passageId: "project", text: "## Patents: ...", why: "Adds dedicated section." }],
			}).success,
		).toBe(false);
		expect(
			schema.safeParse({
				title: "أضف قسم براءات الاختراع",
				changes: [
					{
						kind: "section",
						type: "publications",
						title: "براءات الاختراع",
						entriesJson: "[]",
						why: "Requested section.",
					},
				],
			}).success,
		).toBe(true);
	});
	it("respects an explicit connection while keeping reading available without search credentials", async () => {
		const fallback = build();
		expect(fallback.tools.web_search).toBeUndefined();
		expect(fallback.tools.google_search).toBeUndefined();
		expect(fallback.tools.search_web).toBeUndefined();
		expect(await execute(fallback.tools, "read_page", { url: page.requestedUrl })).toEqual(page);
		const external = build(true);
		expect(external.tools.web_search).toBeUndefined();
		expect(await execute(external.tools, "search_web", { query: "Example company" })).toEqual([
			{ url: "https://example.com/job", title: "Job" },
		]);
		expect(external.handlers.searchWeb).toHaveBeenCalledWith("Example company", expect.any(AbortSignal));
	});

	it("shares one allowance across reading and search", async () => {
		const calls = MAX_AGENT_WEB_CALLS;
		const { tools, handlers } = build(true);
		for (let i = 0; i < calls - 1; i++) await execute(tools, "read_page", { url: page.requestedUrl });
		await execute(tools, "search_web", { query: "Company" });
		await expect(async () => execute(tools, "read_page", { url: page.requestedUrl })).rejects.toThrow(
			"Web access limit",
		);
		await expect(async () => execute(tools, "search_web", { query: "Company follow-up" })).rejects.toThrow(
			"Web access limit",
		);
		expect(handlers.readPage).toHaveBeenCalledTimes(calls - 1);
		expect(handlers.searchWeb).toHaveBeenCalledTimes(1);
	});

	it("never starts an aborted request", async () => {
		const controller = new AbortController();
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
				searchTool: "search_web",
				canReadPage: true,
			}),
		).toContain("Use `search_web`");
	});

	it("explains partial translation and unsupported fields before suggesting resume edits", () => {
		const instructions = buildAgentInstructions({
			document: { kind: "resume", name: "Resume" },
			posting: null,
			searchTool: null,
			canReadPage: true,
		});
		expect(instructions).toContain("Whole-resume translation is NOT supported");
		expect(instructions).toContain("never claim the whole resume is translated");
		expect(instructions).toContain("For mixed requests, propose each supported change");
		expect(instructions).toContain("route to Write");
		expect(instructions).not.toContain("{{EDIT_SCOPE}}");
	});

	it("offers Knowledge only when shared, and tells the model not to tailor a shared base resume", () => {
		const signal = new AbortController().signal;
		const handlers = {
			readDocument: vi.fn(),
			readAttachment: vi.fn(),
			proposeEdits: vi.fn(),
			searchWeb: vi.fn(),
			readPage: vi.fn(),
		};
		expect(buildAgentTools({ document: "resume", externalSearch: false, signal, handlers })).not.toHaveProperty(
			"read_knowledge",
		);
		expect(
			buildAgentTools({
				document: "resume",
				externalSearch: false,
				signal,
				handlers: { ...handlers, readKnowledge: vi.fn() },
			}),
		).toHaveProperty("read_knowledge");

		const posting = { role: "Designer", company: "Lumen", text: "Design systems", jobCopy: false };
		const instructions = buildAgentInstructions({
			document: { kind: "resume", name: "Base" },
			posting,
			searchTool: null,
			canReadPage: false,
		});
		expect(instructions).toContain("isn't the copy made for this job");
		expect(instructions).toContain("Knowledge isn't shared");
	});
});
