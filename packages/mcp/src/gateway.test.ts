import type { MCP_ROUTER } from "./parity";
import type { RouterClient } from "@orpc/server";
import type { RequestAuthentication } from "@reactive-resume/api/context";
import { expect, it, vi } from "vite-plus/test";
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

async function connect(expose: boolean, calls: unknown[] = []) {
	const server = new McpServer({ name: "gateway-test", version: "1.0.0" });
	const apiClient = {
		resume: { listVersions: async (input: unknown) => (calls.push(input), [{ id: "v1" }]) },
	} as unknown as RouterClient<typeof MCP_ROUTER>;
	registerApiGateway(
		server,
		(target) =>
			registerParityTools(target, apiClient, new Headers(), {
				authentication,
				resHeaders: new Headers(),
				locale: "en-US",
				trustedClient: "127.0.0.1",
			}),
		{ expose },
	);
	const client = new Client({ name: "gateway-client", version: "1.0.0" });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await server.connect(serverTransport);
	await client.connect(clientTransport);
	return client;
}

it("lists api_search and api_execute instead of the api_* tools", async () => {
	const client = await connect(true);
	const names = (await client.listTools()).tools.map((tool) => tool.name);
	expect(names).toContain("api_search");
	expect(names).toContain("api_execute");
	expect(names).toContain("open_account_settings");
	expect(names.filter((name) => name.startsWith("api_")).sort()).toEqual(["api_execute", "api_search"]);
});

it("lists no api_* tool when not exposed", async () => {
	const client = await connect(false);
	const names = (await client.listTools()).tools.map((tool) => tool.name);
	expect(names.filter((name) => name.startsWith("api_"))).toEqual([]);
	expect(names).toContain("open_account_settings");
});

it("finds an operation with its input schema, then runs it", async () => {
	const calls: unknown[] = [];
	const client = await connect(true, calls);
	const search = await client.callTool({ name: "api_search", arguments: { query: "resume versions list" } });
	const tools = (search.structuredContent as { tools: { name: string; inputSchema: unknown }[] }).tools;
	const listVersions = tools.find((tool) => tool.name.includes("list_versions"));
	expect(listVersions?.inputSchema).toMatchObject({ type: "object" });

	const run = await client.callTool({
		name: "api_execute",
		arguments: { name: listVersions?.name, arguments: { resumeId: "00000000-0000-0000-0000-000000000000" } },
	});
	expect(run.isError).toBeFalsy();
	expect(calls).toHaveLength(1);
	expect(run.structuredContent).toEqual({ items: [{ id: "v1" }] });
});

it("rejects unknown operations and invalid arguments", async () => {
	const client = await connect(true);
	const unknown = await client.callTool({ name: "api_execute", arguments: { name: "api_nope" } });
	expect(unknown.isError).toBe(true);
	const invalid = await client.callTool({
		name: "api_execute",
		arguments: { name: "api_resume_list_versions", arguments: { resumeId: 42 } },
	});
	expect(invalid.isError).toBe(true);
});

it("lets a read-only credential find and run only read operations", async () => {
	const server = new McpServer({ name: "gateway-test", version: "1.0.0" });
	const readOnly: RequestAuthentication = { ...authentication, permissions: ["read"] };
	const apiClient = {
		resume: { listVersions: async () => [{ id: "v1" }] },
	} as unknown as RouterClient<typeof MCP_ROUTER>;
	registerApiGateway(
		server,
		(target) =>
			registerParityTools(target, apiClient, new Headers(), {
				authentication: readOnly,
				resHeaders: new Headers(),
				locale: "en-US",
				trustedClient: "127.0.0.1",
			}),
		{ expose: true, canWrite: false },
	);
	vi.stubEnv("MCP_API_TOOLS", "search");
	vi.resetModules();
	const { registerToolDiscovery } = await import("./discovery");
	registerToolDiscovery(server, { canWrite: false });
	vi.unstubAllEnvs();
	const client = new Client({ name: "gateway-client", version: "1.0.0" });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await server.connect(serverTransport);
	await client.connect(clientTransport);

	const listed = (await client.listTools()).tools.map((tool) => tool.name);
	expect(listed).toContain("api_search");
	expect(listed).toContain("api_execute");
	const found = await client.callTool({ name: "api_search", arguments: { query: "resume version" } });
	const names = (found.structuredContent as { tools: { name: string }[] }).tools.map((tool) => tool.name);
	expect(names).toContain("api_resume_list_versions");
	expect(names).not.toContain("api_resume_delete_version");
	const run = await client.callTool({
		name: "api_execute",
		arguments: { name: "api_resume_list_versions", arguments: { resumeId: "00000000-0000-0000-0000-000000000000" } },
	});
	expect(run.isError).toBeFalsy();
	const denied = await client.callTool({
		name: "api_execute",
		arguments: { name: "api_resume_delete_version", arguments: {} },
	});
	expect(denied.isError).toBe(true);
});
