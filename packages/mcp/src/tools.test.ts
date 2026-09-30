// oxlint-disable typescript/no-non-null-assertion -- These tests assert registered tool names before exercising handlers.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORPCError } from "@orpc/server";
import { TOOL_META } from "./tool-meta";

vi.mock("@reactive-resume/api/context", () => ({
	resolveUserFromRequestHeaders: vi.fn(),
}));

vi.mock("@reactive-resume/api/features/resume/export", () => ({
	createResumePdfDownloadUrl: vi.fn(),
}));

vi.mock("@reactive-resume/env/server", () => ({
	env: {
		APP_URL: "https://example.com",
	},
}));

const { MCP_TOOL_NAME } = await import("./mcp-tool-names");
const { registerTools } = await import("./tools");

type ToolHandler = (input: Record<string, unknown>) => Promise<{
	content: Array<{ type: "text"; text: string }>;
	isError?: boolean;
}>;

type Registration = {
	name: string;
	config: {
		title?: string;
		description?: string;
		inputSchema?: unknown;
	};
	handler: ToolHandler;
};

const makeFakeServer = () => {
	const registered: Registration[] = [];
	const server = {
		registerTool: vi.fn((name: string, config: Registration["config"], handler: ToolHandler) => {
			registered.push({ name, config, handler });
		}),
	};
	return { server, registered };
};

const clientMock = {
	resume: {
		getById: vi.fn(),
		list: vi.fn(),
		tags: { list: vi.fn() },
		create: vi.fn(),
		import: vi.fn(),
		duplicate: vi.fn(),
		patch: vi.fn(),
		update: vi.fn(),
		delete: vi.fn(),
		setLocked: vi.fn(),
		statistics: { getById: vi.fn() },
	},
	coverLetters: {
		list: vi.fn(),
		getById: vi.fn(),
		create: vi.fn(),
		update: vi.fn(),
		refreshStyle: vi.fn(),
		duplicate: vi.fn(),
		delete: vi.fn(),
		copyEmbedded: vi.fn(),
		export: vi.fn(),
		import: vi.fn(),
	},
	applications: {
		list: vi.fn(),
		getById: vi.fn(),
		tags: vi.fn(),
		stats: vi.fn(),
		create: vi.fn(),
		update: vi.fn(),
		addNote: vi.fn(),
		addInterview: vi.fn(),
		updateInterview: vi.fn(),
		updateTimelineEntry: vi.fn(),
		deleteTimelineEntry: vi.fn(),
		delete: vi.fn(),
		bulkUpdate: vi.fn(),
		bulkDelete: vi.fn(),
		import: vi.fn(),
		attachDocument: vi.fn(),
		removeDocument: vi.fn(),
		ai: {
			autofill: vi.fn(),
			matchScore: vi.fn(),
			tailorResume: vi.fn(),
			draftMessage: vi.fn(),
		},
	},
};

describe("registerTools", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("creates and duplicates with an automatically generated address", async () => {
		const { server, registered } = makeFakeServer();
		registerTools(server as never, clientMock as never, new Headers());
		clientMock.resume.create.mockResolvedValueOnce("created");
		clientMock.resume.duplicate.mockResolvedValueOnce("copied");
		const create = registered.find((tool) => tool.name === MCP_TOOL_NAME.createResume)!;
		const duplicate = registered.find((tool) => tool.name === MCP_TOOL_NAME.duplicateResume)!;
		await create.handler(TOOL_META[MCP_TOOL_NAME.createResume].inputSchema.parse({ name: "Resume" }));
		await duplicate.handler(TOOL_META[MCP_TOOL_NAME.duplicateResume].inputSchema.parse({ id: "r1" }));
		expect(clientMock.resume.create).toHaveBeenCalledWith({ name: "Resume", tags: [], withSampleData: false });
		expect(clientMock.resume.duplicate).toHaveBeenCalledWith({ id: "r1" });
	});

	it("imports applications with followUpAt coerced to Date and null preserved", async () => {
		clientMock.applications.import.mockResolvedValueOnce({ imported: 2 });
		const { server, registered } = makeFakeServer();
		registerTools(server as never, clientMock as never, new Headers());

		const tool = registered.find((item) => item.name === "import_applications")!;
		const result = await tool.handler({
			items: [
				{ company: "Acme", role: "Engineer", followUpAt: "2026-07-12T12:00:00.000Z" },
				{ company: "Beta", role: "Designer", followUpAt: null },
			],
		});

		expect(clientMock.applications.import).toHaveBeenCalledWith({
			items: [
				{ company: "Acme", role: "Engineer", followUpAt: new Date("2026-07-12T12:00:00.000Z") },
				{ company: "Beta", role: "Designer", followUpAt: null },
			],
		});
		expect(JSON.parse(result.content[0]!.text)).toEqual({ imported: 2 });
	});

	describe("error hints", () => {
		const readResume = (error: unknown) => {
			clientMock.resume.getById.mockRejectedValueOnce(error);

			const { server, registered } = makeFakeServer();
			registerTools(server as never, clientMock as never, new Headers());

			const tool = registered.find((item) => item.name === MCP_TOOL_NAME.getResume)!;
			return tool.handler({ id: "resume-1" });
		};

		// Procedures throw these without a message, so the message is the code itself
		// (or oRPC's default, "Not Found") and the status never appears in it.
		it.each([
			["RESUME_LOCKED", undefined, `Use \`${MCP_TOOL_NAME.unlockResume}\` first.`],
			[
				"NOT_FOUND",
				undefined,
				`\`${MCP_TOOL_NAME.listResumes}\`, \`${MCP_TOOL_NAME.listCoverLetters}\`, and \`${MCP_TOOL_NAME.listApplications}\` return valid ones.`,
			],
			["RESUME_SLUG_ALREADY_EXISTS", 400, "The slug is already in use."],
			["FORBIDDEN", undefined, "Permission denied."],
			["BAD_REQUEST", undefined, "Check the input parameters against the tool's schema."],
		])("hints on %s", async (code, status, expected) => {
			const result = await readResume(new ORPCError(code, status ? { status } : undefined));

			expect(result.isError).toBe(true);
			expect(result.content[0]!.text).toContain(expected);
		});
	});
});
