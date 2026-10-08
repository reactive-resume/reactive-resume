import type { RouterClient } from "@orpc/server";
import type { RequestAuthentication } from "@reactive-resume/api/context";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ORPCError } from "@orpc/server";

const storage = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@reactive-resume/api/features/storage", () => ({
	getStorageService: () => ({ read: storage.read }),
}));

import type { MCP_ROUTER } from "./parity";
import { buildMcpServerCard } from "./mcp-server-card";
import { registerParityTools } from "./parity";
import { registerPrompts } from "./prompts";
import { registerTools } from "./tools";

let client: Client;
let server: McpServer;
const calls = {
	auth: { deleteAccount: vi.fn() },
	resume: { listVersions: vi.fn(), getById: vi.fn() },
	rest: { fileUpload: vi.fn(), documentExports: { resume: vi.fn() } },
	coverLetters: { draft: vi.fn() },
};

beforeEach(async () => {
	vi.clearAllMocks();
	server = new McpServer({ name: "parity-test", version: "1.0.0" });
	const context = {
		authentication: {
			user: {
				id: "owner-1",
				name: "Owner",
				email: "owner@example.test",
				emailVerified: true,
				createdAt: new Date(0),
				updatedAt: new Date(0),
			},
			method: "bearer",
			permissions: ["read", "write", "delete"],
		} satisfies RequestAuthentication,
		resHeaders: new Headers(),
		locale: "en-US" as const,
		trustedClient: "127.0.0.1",
	};
	registerTools(server, calls as unknown as RouterClient<typeof MCP_ROUTER>, new Headers(), context.authentication);
	registerParityTools(server, calls as unknown as RouterClient<typeof MCP_ROUTER>, new Headers(), context);
	registerPrompts(server, calls as unknown as RouterClient<typeof MCP_ROUTER>);
	client = new Client({ name: "parity-client", version: "1.0.0" });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await server.connect(serverTransport);
	await client.connect(clientTransport);
});

afterEach(async () => {
	await client?.close();
	await server?.close();
});

it("hands account deletion to browser settings without invoking the API", async () => {
	const result = await client.callTool({ name: "api_auth_delete_account", arguments: {} });
	expect(result.isError).not.toBe(true);
	expect(result.structuredContent).toMatchObject({ action: "auth.deleteAccount", requiresBrowser: true });
	expect(new URL((result.structuredContent as { url: string }).url).pathname).toBe("/dashboard/settings/account");
	expect(calls.auth.deleteAccount).not.toHaveBeenCalled();
});

it("discovers API-derived contracts and exchanges native files and dates through the SDK", async () => {
	const { tools } = await client.listTools();
	const cardTools = new Map(buildMcpServerCard("1.0.0").tools.map((tool) => [tool.name, tool]));
	for (const tool of tools) {
		expect(tool.inputSchema, tool.name).toEqual(cardTools.get(tool.name)?.inputSchema);
		expect(tool.outputSchema, tool.name).toEqual(cardTools.get(tool.name)?.outputSchema);
	}
	expect(tools.find((tool) => tool.name === "api_resume_list_versions")?.outputSchema).toBeDefined();
	expect(tools.find((tool) => tool.name === "update_resume")?.inputSchema.properties?.data).toBeDefined();
	calls.resume.listVersions.mockResolvedValueOnce([
		{ id: "version-1", kind: "named", name: "Submitted", createdAt: new Date("2026-09-15T10:00:00Z") },
	]);
	const versions = await client.callTool({ name: "api_resume_list_versions", arguments: { resumeId: "resume-1" } });
	expect(versions.isError).not.toBe(true);
	expect(versions.structuredContent).toMatchObject({ items: [{ createdAt: "2026-09-15T10:00:00.000Z" }] });

	calls.rest.fileUpload.mockImplementationOnce(async ({ file }: { file: File }) => {
		expect(file).toBeInstanceOf(File);
		expect(await file.text()).toBe("%PDF-file-content");
		return {
			url: "https://resume.example/api/uploads/owner-1/pictures/input.pdf",
			path: "uploads/owner-1/pictures/input.pdf",
			contentType: "application/pdf",
		};
	});
	const uploaded = await client.callTool({
		name: "api_rest_file_upload",
		arguments: {
			file: {
				name: "input.pdf",
				contentType: "application/pdf",
				dataBase64: Buffer.from("%PDF-file-content").toString("base64"),
			},
		},
	});
	expect(uploaded.isError).not.toBe(true);

	calls.resume.getById.mockResolvedValueOnce({ id: "resume-1" });
	const exported = await client.callTool({
		name: "api_rest_document_exports_resume",
		arguments: { id: "resume-1", format: "pdf" },
	});
	expect(exported.isError).not.toBe(true);
	expect(exported.structuredContent).toMatchObject({ requiresAuthentication: true });
	const descriptor = exported.structuredContent as { url: string };
	expect(new URL(descriptor.url).pathname).toBe("/api/openapi/resumes/resume-1/exports/pdf");
	expect(calls.rest.documentExports.resume).not.toHaveBeenCalled();
	calls.resume.getById.mockRejectedValueOnce(new ORPCError("NOT_FOUND"));
	expect(
		(
			await client.callTool({
				name: "api_rest_document_exports_resume",
				arguments: { id: "foreign-resume", format: "pdf" },
			})
		).isError,
	).toBe(true);
});

it("rejects foreign and traversing file references before reading storage or invoking the API", async () => {
	for (const storagePath of ["uploads/other-user/pictures/private.pdf", "uploads/owner-1/pictures/../private.pdf"]) {
		const result = await client.callTool({
			name: "api_rest_file_upload",
			arguments: { file: { name: "input.pdf", contentType: "application/pdf", storagePath } },
		});
		expect(result.isError).toBe(true);
		expect(result.content).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: "text", text: expect.stringContaining("uploaded by this account") }),
			]),
		);
	}
	expect(storage.read).not.toHaveBeenCalled();
	expect(calls.rest.fileUpload).not.toHaveBeenCalled();
});

it("collects streaming drafts within the documented bound and closes the producer when truncated", async () => {
	let closed = false;
	calls.coverLetters.draft.mockImplementationOnce(async function* () {
		try {
			yield "Draft introduction";
			yield "x".repeat(500_000);
		} finally {
			closed = true;
		}
	});
	const result = await client.callTool({
		name: "api_cover_letters_draft",
		arguments: { id: "letter-1", variant: "draft" },
	});
	expect(result.isError).not.toBe(true);
	expect(result.structuredContent).toEqual({ events: ["Draft introduction"], truncated: true });
	expect(closed).toBe(true);
});

it("embeds actual resume JSON in prompts and propagates inaccessible-document errors", async () => {
	const data = { basics: { name: "Morgan Lee" }, summary: { content: "Verified content" } };
	calls.resume.getById.mockResolvedValueOnce({ data });
	const prompt = await client.getPrompt({ name: "review_resume", arguments: { id: "resume-1" } });
	const resource = prompt.messages.find(
		(message) => message.content.type === "resource" && message.content.resource.uri === "resume://resume-1",
	)?.content;
	expect(resource?.type).toBe("resource");
	if (resource?.type !== "resource" || !("text" in resource.resource)) throw new Error("Prompt lacks resume JSON");
	expect(JSON.parse(resource.resource.text)).toEqual(data);
	calls.resume.getById.mockRejectedValueOnce(new ORPCError("NOT_FOUND"));
	await expect(client.getPrompt({ name: "review_resume", arguments: { id: "foreign-resume" } })).rejects.toThrow();
	calls.resume.getById.mockRejectedValueOnce(new Error("credential secret"));
	await expect(client.getPrompt({ name: "review_resume", arguments: { id: "resume-1" } })).rejects.not.toThrow(
		"credential secret",
	);
});
