import type { RouterClient } from "@orpc/server";
import type { RequestAuthentication } from "@reactive-resume/api/context";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { onError } from "@orpc/client";
import { createRouterClient } from "@orpc/server";
import { env } from "@reactive-resume/env/server";
import {
	buildMcpServerInfo,
	MCP_TOOL_NAME,
	MCP_ROUTER,
	registerParityTools,
	registerPrompts,
	registerResources,
	registerTools,
	registerToolDiscovery,
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
	const server = new McpServer(buildMcpServerInfo(appVersion, env.APP_URL), {
		instructions: [
			"Reactive Resume holds the user's resumes, cover letters and job applications.",
			`Find resume IDs with \`${MCP_TOOL_NAME.listResumes}\` and read one with \`${MCP_TOOL_NAME.getResume}\`; the resume JSON Schema is the \`resume://_meta/schema\` resource.`,
			`Edit resume content with JSON Patch through \`${MCP_TOOL_NAME.patchResume}\`, and change a resume's name, slug, tags or public visibility with \`${MCP_TOOL_NAME.updateResume}\`.`,
			`Track job applications with the application tools, starting from \`${MCP_TOOL_NAME.listApplications}\`.`,
			`Get a short-lived PDF link with \`${MCP_TOOL_NAME.downloadResumePdf}\`; export cover letters with \`${MCP_TOOL_NAME.exportCoverLetter}\`.`,
			"Tools named api_* expose the rest of the Reactive Resume API. Tools that involve passwords, API keys or AI provider keys return a link to finish in the app.",
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
	registerToolDiscovery(server, { canWrite: authentication.permissions.includes("write") });

	return server;
}
