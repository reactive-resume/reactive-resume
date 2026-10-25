import type { MCP_ROUTER } from "./parity";
import type { RouterClient } from "@orpc/server";
import type { RequestAuthentication } from "@reactive-resume/api/context";
import { expect, it } from "vite-plus/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerToolDiscovery } from "./discovery";
import { buildMcpServerCard } from "./mcp-server-card";
import { registerParityTools } from "./parity";
import { registerTools } from "./tools";

it("matches the complete unmodified SDK tools/list response and server-card schemas", async () => {
	const server = new McpServer({ name: "discovery-test", version: "1.0.0" });
	const apiClient = {} as RouterClient<typeof MCP_ROUTER>;
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
	registerTools(server, apiClient, new Headers(), authentication);
	registerParityTools(server, apiClient, new Headers(), {
		authentication,
		resHeaders: new Headers(),
		locale: "en-US",
		trustedClient: "127.0.0.1",
	});
	const client = new Client({ name: "discovery-client", version: "1.0.0" });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	try {
		await server.connect(serverTransport);
		await client.connect(clientTransport);
		const baseline = JSON.parse(JSON.stringify(await client.listTools()));
		registerToolDiscovery(server);
		const optimized = JSON.parse(JSON.stringify(await client.listTools()));
		expect(optimized).toEqual(baseline);
		expect(buildMcpServerCard("1.0.0").tools).toEqual(
			(await client.listTools()).tools.map(({ execution: _execution, _meta, ...tool }) => tool),
		);
	} finally {
		await client.close();
		await server.close();
	}
}, 30_000);
