// oxlint-disable typescript/no-non-null-assertion -- These tests assert registered tool names before exercising handlers.

import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ORPCError } from "@orpc/server";
import { TOOL_META } from "./tool-meta";

vi.mock("@reactive-resume/api/context", () => ({
	resolveUserFromRequestHeaders: vi.fn(),
}));

vi.mock("./files", () => ({ readMcpFile: vi.fn() }));

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
	structuredContent?: Record<string, unknown>;
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

	it("preserves the application-letter review and provenance envelope without saving generated text", async () => {
		const draft = {
			text: "Fictional reviewed body",
			coverLetterId: "letter",
			reviewRequired: true,
			aiOperationIds: ["operation"],
			aiUsage: {
				requests: 1,
				models: [{ providerId: "provider", label: "Fictional AI", provider: "openai", model: "original-model" }],
			},
		};
		clientMock.applications.ai.draftMessage.mockResolvedValueOnce(draft);
		const { server, registered } = makeFakeServer();
		registerTools(server as never, clientMock as never, new Headers());
		const tool = registered.find((tool) => tool.name === MCP_TOOL_NAME.draftApplicationMessage)!;
		const input = { id: "application", kind: "cover-letter" };
		const result = await tool.handler(TOOL_META[MCP_TOOL_NAME.draftApplicationMessage].inputSchema.parse(input));
		expect(clientMock.applications.ai.draftMessage).toHaveBeenCalledWith(input);
		expect(result.structuredContent).toEqual(draft);
		expect(clientMock.coverLetters.update).not.toHaveBeenCalled();
		expect(TOOL_META[MCP_TOOL_NAME.draftApplicationMessage].outputSchema.parse({ text: "Legacy follow-up" })).toEqual({
			text: "Legacy follow-up",
		});
	});

	it("preserves pending tailoring review metadata and the legacy resume reference", async () => {
		const draft = { resumeId: "copy", name: "Fictional copy", reviewRequired: true, generationStatus: "interrupted" };
		clientMock.applications.ai.tailorResume.mockResolvedValueOnce(draft);
		const { server, registered } = makeFakeServer();
		registerTools(server as never, clientMock as never, new Headers());
		const tool = registered.find((tool) => tool.name === MCP_TOOL_NAME.tailorResumeForApplication)!;
		const result = await tool.handler({ id: "application" });
		expect(clientMock.applications.ai.tailorResume).toHaveBeenCalledWith({ id: "application" });
		expect(result.structuredContent).toEqual(draft);
		expect(TOOL_META[MCP_TOOL_NAME.tailorResumeForApplication].outputSchema.parse(draft)).toEqual(draft);
		expect(
			TOOL_META[MCP_TOOL_NAME.tailorResumeForApplication].outputSchema.parse({ resumeId: "old", name: "Old" }),
		).toEqual({ resumeId: "old", name: "Old" });
		expect(clientMock.resume.patch).not.toHaveBeenCalled();
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

	it("returns resume revision metadata and forwards the timestamp when patching", async () => {
		const updatedAt = new Date("2026-10-01T10:00:00.000Z");
		const resume = { id: "r1", name: "Resume", updatedAt, data: { basics: { name: "Before" } } };
		clientMock.resume.getById.mockResolvedValueOnce(resume);
		clientMock.resume.patch.mockResolvedValueOnce(resume);
		const { server, registered } = makeFakeServer();
		registerTools(server as never, clientMock as never, new Headers());
		const read = registered.find((tool) => tool.name === MCP_TOOL_NAME.getResume)!;
		const patch = registered.find((tool) => tool.name === MCP_TOOL_NAME.patchResume)!;
		const result = await read.handler({ id: "r1" });
		expect(result.structuredContent?.updatedAt).toBe("2026-10-01T10:00:00.000Z");
		expect(JSON.parse(result.content[0]!.text)).toEqual(resume.data);
		await patch.handler(
			TOOL_META[MCP_TOOL_NAME.patchResume].inputSchema.parse({
				id: "r1",
				expectedUpdatedAt: result.structuredContent?.updatedAt,
				operations: [{ op: "replace", path: "/basics/name", value: "After" }],
			}),
		);
		expect(clientMock.resume.patch.mock.calls[0]?.[0].expectedUpdatedAt).toEqual(updatedAt);
	});

	describe("error hints", () => {
		const readResume = (error: unknown) => {
			clientMock.resume.getById.mockRejectedValueOnce(error);

			const { server, registered } = makeFakeServer();
			registerTools(server as never, clientMock as never, new Headers());

			const tool = registered.find((item) => item.name === MCP_TOOL_NAME.getResume)!;
			return tool.handler({ id: "resume-1" });
		};

		it("hides unexpected internal failure details", async () => {
			const result = await readResume(new Error("postgresql://private-credentials/internal"));
			expect(result.isError).toBe(true);
			expect(result.content[0]!.text).toContain("Unexpected failure");
			expect(result.content[0]!.text).not.toContain("private-credentials");
		});

		// Procedures throw these without a message, so the message is the code itself
		// (or oRPC's default, "Not Found") and the status never appears in it.
		it.each([
			["RESUME_LOCKED", undefined, `Ask the user before unlocking with \`${MCP_TOOL_NAME.unlockResume}\`.`],
			[
				"NOT_FOUND",
				undefined,
				`\`${MCP_TOOL_NAME.listResumes}\`, \`${MCP_TOOL_NAME.listCoverLetters}\`, and \`${MCP_TOOL_NAME.listApplications}\` return valid ones.`,
			],
			["RESUME_SLUG_ALREADY_EXISTS", 400, "The slug is already in use."],
			["FORBIDDEN", undefined, "Not allowed."],
			["BAD_REQUEST", undefined, "Check the input parameters against the tool's schema."],
		])("hints on %s", async (code, status, expected) => {
			const result = await readResume(new ORPCError(code, status ? { status } : undefined));

			expect(result.isError).toBe(true);
			expect(result.content[0]!.text).toContain(expected);
		});
	});
});
