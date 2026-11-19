import type { MCP_ROUTER } from "./parity";
import type { RouterClient } from "@orpc/server";
import type { RequestAuthentication } from "@reactive-resume/api/context";
import { expect, it, onTestFinished, vi } from "vite-plus/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerApiGateway } from "./gateway";
import { registerParityTools } from "./parity";

const authentication: RequestAuthentication = {
	user: {
		id: "owner",
		name: "Owner",
		email: "owner@example.test",
		emailVerified: true,
		createdAt: new Date(0),
		updatedAt: new Date(0),
	},
	method: "bearer",
	permissions: ["read", "write", "delete"],
};

const version = { id: "v1", kind: "named", name: "Application version", createdAt: new Date(0) };
const versionIds = { resumeId: "r1", versionId: version.id };
const deleteOperation = { name: "api_resume_delete_version", arguments: versionIds };
const listOperation = { name: "api_resume_list_versions", arguments: { resumeId: versionIds.resumeId } };

async function connect(
	mode: "all" | "search" | "none",
	{
		permissions = authentication.permissions,
		listVersions = async () => [version],
		deleteVersion = async () => undefined,
		useDiscovery = false,
	}: {
		permissions?: RequestAuthentication["permissions"];
		listVersions?: (input: unknown) => Promise<unknown>;
		deleteVersion?: (input: unknown) => Promise<undefined>;
		useDiscovery?: boolean;
	} = {},
) {
	const server = new McpServer({ name: "gateway-test", version: "1.0.0" });
	const apiClient = { resume: { listVersions, deleteVersion } } as unknown as RouterClient<typeof MCP_ROUTER>;
	const scopedAuthentication = { ...authentication, permissions };
	const register = (target: McpServer) =>
		registerParityTools(target, apiClient, new Headers(), {
			authentication: scopedAuthentication,
			resHeaders: new Headers(),
			locale: "en-US",
			trustedClient: "127.0.0.1",
		});
	if (mode === "all") register(server);
	else registerApiGateway(server, register, { expose: mode === "search", authentication: scopedAuthentication });
	if (useDiscovery) {
		vi.stubEnv("MCP_API_TOOLS", mode);
		try {
			vi.resetModules();
			const { registerToolDiscovery } = await import("./discovery");
			registerToolDiscovery(server, { canWrite: permissions.includes("write") });
		} finally {
			vi.unstubAllEnvs();
		}
	}
	const client = new Client({ name: "gateway-client", version: "1.0.0" });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	onTestFinished(async () => {
		await client.close();
		await server.close();
	});
	await server.connect(serverTransport);
	await client.connect(clientTransport);
	return client;
}

function execute(client: Client, operation: { name: string; arguments?: Record<string, unknown> }) {
	return client.callTool({ name: "api_execute", arguments: operation });
}

async function search(client: Client, query: string) {
	const result = await client.callTool({ name: "api_search", arguments: { query, limit: 20 } });
	expect(result.isError).toBeFalsy();
	return (result.structuredContent as { tools: { name: string; inputSchema: unknown }[] }).tools;
}

it("lists api_search and api_execute instead of the api_* tools", async () => {
	const client = await connect("search");
	const names = (await client.listTools()).tools.map((tool) => tool.name);
	expect(names).toContain("open_account_settings");
	expect(names.filter((name) => name.startsWith("api_")).sort()).toEqual(["api_execute", "api_search"]);
});

it("lists no api_* tool when not exposed", async () => {
	const client = await connect("none");
	const names = (await client.listTools()).tools.map((tool) => tool.name);
	expect(names.filter((name) => name.startsWith("api_"))).toEqual([]);
	expect(names).toContain("open_account_settings");
});

it("finds an operation with its input schema, then runs it", async () => {
	const listVersions = vi.fn(async () => [version]);
	const client = await connect("search", { listVersions });
	const tools = await search(client, "resume versions list");
	const listVersionsTool = tools.find((tool) => tool.name === listOperation.name);
	expect(listVersionsTool?.inputSchema).toMatchObject({ type: "object" });

	const run = await execute(client, listOperation);
	expect(run.isError).toBeFalsy();
	expect(listVersions).toHaveBeenCalledOnce();
	expect(run.structuredContent).toEqual({ items: [{ ...version, createdAt: version.createdAt.toISOString() }] });
});

it("rejects unknown operations and invalid arguments", async () => {
	const client = await connect("search");
	expect((await execute(client, { name: "api_nope" })).isError).toBe(true);
	expect((await execute(client, { name: listOperation.name, arguments: { resumeId: 42 } })).isError).toBe(true);
});

it("lets a read-only credential find and run only read operations", async () => {
	const deleteVersion = vi.fn(async () => undefined);
	const client = await connect("search", { permissions: ["read"], deleteVersion, useDiscovery: true });

	const listed = (await client.listTools()).tools.map((tool) => tool.name);
	expect(listed).toContain("api_search");
	expect(listed).toContain("api_execute");
	const names = (await search(client, "resume version")).map((tool) => tool.name);
	expect(names).toContain(listOperation.name);
	expect(names).not.toContain(deleteOperation.name);
	expect((await execute(client, listOperation)).isError).toBeFalsy();
	expect(await execute(client, deleteOperation)).toMatchObject({
		isError: true,
		content: [{ type: "text", text: expect.stringContaining("api:delete") }],
	});
	expect(deleteVersion).not.toHaveBeenCalled();
});

it("allows a credential with delete but no write to find and run a delete operation", async () => {
	const deleteVersion = vi.fn(async () => undefined);
	const client = await connect("search", { permissions: ["read", "delete"], deleteVersion });

	const names = (await search(client, "resume delete version")).map((tool) => tool.name);
	expect(names).toContain(deleteOperation.name);
	expect(names).not.toContain("api_resume_rename_version");
	expect(await execute(client, deleteOperation)).toMatchObject({ structuredContent: { result: null } });
	expect(deleteVersion).toHaveBeenCalledWith(versionIds);
});

it("excludes delete operations from search for a credential with write but no delete", async () => {
	const deleteVersion = vi.fn(async () => undefined);
	const client = await connect("search", { permissions: ["read", "write"], deleteVersion });

	const names = (await search(client, "resume delete version")).map((tool) => tool.name);
	expect(names).toContain("api_resume_rename_version");
	expect(names).not.toContain(deleteOperation.name);
	expect(await execute(client, deleteOperation)).toMatchObject({
		isError: true,
		content: [{ type: "text", text: expect.stringContaining("api:delete") }],
	});
	expect(deleteVersion).not.toHaveBeenCalled();
});

it("rejects successful handler output that violates the operation contract in either mode", async () => {
	const listVersions = async () => [{ id: "incomplete" }];
	const direct = await connect("all", { listVersions });
	const gateway = await connect("search", { listVersions });

	expect((await direct.callTool(listOperation)).isError).toBe(true);
	expect((await execute(gateway, listOperation)).isError).toBe(true);
});
