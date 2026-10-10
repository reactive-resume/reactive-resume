import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { randomUUID } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ORPCError } from "@orpc/server";
import { consumeMcpRequestLimit, consumeMcpUserLimit } from "@reactive-resume/api/features/mcp/transport";
import { env } from "@reactive-resume/env/server";
import { getTrustedOrigins } from "@reactive-resume/utils/trusted-origins";
import { AuthError, authenticateRequest } from "./auth";
import { createMcpServer } from "./server";

const TRUSTED_ORIGINS = getTrustedOrigins(env.APP_URL);
const responseHeaders = {
	"Cache-Control": "no-store",
	"X-Content-Type-Options": "nosniff",
};

function errorResponse(status: number, message: string, headers?: Record<string, string>) {
	return Response.json(
		{ id: null, jsonrpc: "2.0", error: { code: -32603, message } },
		{ status, headers: { ...responseHeaders, ...headers } },
	);
}

export async function handleMcp(request: Request, trustedClient = "unknown") {
	let server: McpServer | undefined;
	let transport: WebStandardStreamableHTTPServerTransport | undefined;
	try {
		const origin = request.headers.get("origin");
		if (origin !== null && !TRUSTED_ORIGINS.includes(origin)) {
			return errorResponse(403, "Origin is not allowed. Use the configured application origin or a native MCP client.");
		}
		if (request.method !== "POST") {
			return errorResponse(405, "This stateless MCP endpoint accepts POST requests.", { Allow: "POST" });
		}
		await consumeMcpRequestLimit(trustedClient);
		const authentication = await authenticateRequest(request);
		await consumeMcpUserLimit(authentication.user.id);
		const resHeaders = new Headers(responseHeaders);
		server = createMcpServer(request, authentication, trustedClient, resHeaders);
		transport = new WebStandardStreamableHTTPServerTransport({
			enableJsonResponse: true,
			// Larger files use authenticated upload references rather than base64 in JSON-RPC.
			maxRequestBodySize: 4 * 1024 * 1024,
		});
		await server.connect(transport);
		const response = await transport.handleRequest(request);
		const headers = new Headers(response.headers);
		for (const [key, value] of resHeaders) headers.set(key, value);
		return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
	} catch (error) {
		if (error instanceof AuthError) {
			return errorResponse(401, "Unauthorized", {
				"WWW-Authenticate": `Bearer resource_metadata="${env.APP_URL}/.well-known/oauth-protected-resource"`,
			});
		}
		if (error instanceof ORPCError && error.code === "TOO_MANY_REQUESTS") {
			const reset = (error.data as { reset?: number } | undefined)?.reset;
			return errorResponse(429, "Too many MCP requests. Retry after the rate limit resets.", {
				"Retry-After": String(reset ? Math.max(1, Math.ceil((reset - Date.now()) / 1000)) : 60),
			});
		}
		const diagnosticId = randomUUID();
		console.error("[MCP] Request failed", { diagnosticId, name: error instanceof Error ? error.name : "Unknown" });
		return errorResponse(500, `MCP request failed. Retry or contact support with diagnostic ID ${diagnosticId}.`);
	} finally {
		// JSON responses are complete before handleRequest resolves; no standalone streams remain.
		try {
			if (server) await server.close();
			else if (transport) await transport.close();
		} catch {
			console.error("[MCP] Transport cleanup failed");
		}
	}
}
