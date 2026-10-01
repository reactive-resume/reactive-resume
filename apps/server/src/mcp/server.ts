import type { RouterClient } from "@orpc/server";
import type { RequestAuthentication } from "@reactive-resume/api/context";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { onError } from "@orpc/client";
import { createRouterClient } from "@orpc/server";
import {
	buildMcpServerInfo,
	MCP_TOOL_NAME,
	MCP_ROUTER,
	registerParityTools,
	registerPrompts,
	registerResources,
	registerTools,
} from "@reactive-resume/mcp";
import { appVersion } from "../app-version";
import { getRequestLocale } from "../rpc/locale";

function createRequestClient(
	request: Request,
	authentication: RequestAuthentication,
	trustedClient: string,
	resHeaders: Headers,
): RouterClient<typeof MCP_ROUTER> {
	const reqHeaders = new Headers(request.headers);
	reqHeaders.delete("cookie");
	return createRouterClient(MCP_ROUTER, {
		interceptors: [
			(options) => {
				request.signal.throwIfAborted();
				return options.next({
					...options,
					signal: options.signal ? AbortSignal.any([request.signal, options.signal]) : request.signal,
				});
			},
			onError((error) => {
				console.error("[MCP oRPC]", { name: error instanceof Error ? error.name : "Unknown" });
			}),
		],
		context: () => ({
			locale: getRequestLocale(request),
			reqHeaders,
			resHeaders,
			trustedClient,
			authentication,
		}),
	});
}

export function createMcpServer(
	request: Request,
	authentication: RequestAuthentication,
	trustedClient: string,
	resHeaders: Headers,
) {
	const server = new McpServer(buildMcpServerInfo(appVersion), {
		instructions: [
			"You are connected to Reactive Resume over MCP.",
			"Authenticate with OAuth (recommended) or an API key (`x-api-key`).",
			`Discover resume IDs with \`${MCP_TOOL_NAME.listResumes}\` (not \`resources/list\`).`,
			`List distinct tags with \`${MCP_TOOL_NAME.listResumeTags}\`.`,
			`Read schema at \`resume://_meta/schema\`; read resume JSON via \`resume://{id}\` or \`${MCP_TOOL_NAME.getResume}\`.`,
			`Apply body edits with JSON Patch through \`${MCP_TOOL_NAME.patchResume}\`.`,
			`Change name, slug, tags, or public visibility with \`${MCP_TOOL_NAME.updateResume}\` (returns canonical share URL; anonymous access only when \`isPublic\` is true).`,
			`Create short-lived authenticated PDF download URLs with \`${MCP_TOOL_NAME.downloadResumePdf}\`. Export letters separately with \`${MCP_TOOL_NAME.exportCoverLetter}\`.`,
			`Import full ResumeData JSON with \`${MCP_TOOL_NAME.importResume}\`.`,
		].join(" "),
	});

	const client = createRequestClient(request, authentication, trustedClient, resHeaders);
	const headers = new Headers(request.headers);
	headers.delete("cookie");
	registerResources(server, client);
	registerTools(server, client, headers, authentication);
	registerParityTools(server, client, headers, {
		authentication,
		resHeaders,
		trustedClient,
		locale: getRequestLocale(request),
		signal: request.signal,
	});
	registerPrompts(server, client);

	return server;
}
