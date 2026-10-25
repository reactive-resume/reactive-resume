import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { PARITY_TOOL_META } from "./parity";
import { TOOL_META } from "./tool-meta";

function buildToolDefinitions() {
	return Object.entries({ ...TOOL_META, ...PARITY_TOOL_META }).map(
		([name, { title, description, inputSchema, outputSchema, annotations }]) => ({
			name,
			title,
			description,
			inputSchema: toJsonSchemaCompat(inputSchema, {
				strictUnions: true,
				pipeStrategy: "input",
			}) as Tool["inputSchema"],
			outputSchema: toJsonSchemaCompat(outputSchema, { strictUnions: true, pipeStrategy: "output" }) as NonNullable<
				Tool["outputSchema"]
			>,
			annotations,
			// SDK registerTool declares ordinary callbacks as non-task tools.
			execution: { taskSupport: "forbidden" as const },
		}),
	);
}

let discovery: { tools: ReturnType<typeof buildToolDefinitions> } | undefined;

/** Run before accepting HTTP traffic. Reads only static metadata; creates no clients or callbacks. */
export function prepareMcpDiscovery() {
	return (discovery ??= { tools: buildToolDefinitions() });
}

/** Install after tool registration so SDK tools/call validation and callbacks remain intact. */
export function registerToolDiscovery(server: McpServer) {
	const metadata = prepareMcpDiscovery();
	// The public low-level handler API avoids SDK tools/list reconverting every schema per request.
	server.server.setRequestHandler(ListToolsRequestSchema, () => metadata);
}
