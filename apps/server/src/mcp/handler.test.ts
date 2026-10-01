import { beforeEach, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ORPCError } from "@orpc/server";

const mocks = vi.hoisted(() => ({ authentication: vi.fn(), limit: vi.fn() }));
vi.mock("@reactive-resume/env/server", () => ({ env: { APP_URL: "https://resume.example" } }));
vi.mock("@reactive-resume/api/context", () => ({ resolveAuthenticationFromRequestHeaders: mocks.authentication }));
vi.mock("@reactive-resume/api/features/mcp/transport", () => ({
	consumeMcpRequestLimit: mocks.limit,
	consumeMcpUserLimit: mocks.limit,
}));
vi.mock("./server", () => ({
	createMcpServer: () => new McpServer({ name: "transport-test", version: "1.0.0" }),
}));

import { handleMcp } from "./handler";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.limit.mockResolvedValue(undefined);
	mocks.authentication.mockResolvedValue({ user: { id: "user-1" }, method: "bearer", permissions: ["read"] });
});

function initialize(origin?: string) {
	return new Request("https://resume.example/mcp", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
			...(origin && { Origin: origin }),
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } },
		}),
	});
}

it("serves native and same-origin MCP initialization as complete JSON with private response headers", async () => {
	for (const origin of [undefined, "https://resume.example"]) {
		const response = await handleMcp(initialize(origin), "127.0.0.1");
		expect(response.status).toBe(200);
		expect((await response.json()).result.protocolVersion).toBe("2025-11-25");
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
	}
});

it("rejects foreign origins and standalone GET streams before authentication", async () => {
	expect((await handleMcp(initialize("https://attacker.example"))).status).toBe(403);
	const response = await handleMcp(
		new Request("https://resume.example/mcp", { headers: { Accept: "text/event-stream" } }),
	);
	expect(response.status).toBe(405);
	expect(response.headers.get("allow")).toBe("POST");
	expect(mocks.authentication).not.toHaveBeenCalled();
});

it("returns actionable rate limits and conceals unexpected authentication errors", async () => {
	mocks.limit.mockRejectedValueOnce(new ORPCError("TOO_MANY_REQUESTS", { data: { reset: Date.now() + 30_000 } }));
	const limited = await handleMcp(initialize());
	expect(limited.status).toBe(429);
	expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
	mocks.authentication.mockRejectedValueOnce(new Error("private database connection string"));
	const failed = await handleMcp(initialize());
	expect(failed.status).toBe(500);
	expect(await failed.text()).not.toContain("private database connection string");
});
