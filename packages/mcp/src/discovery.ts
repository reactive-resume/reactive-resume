import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { PARITY_TOOL_META, PARITY_WRITE_TOOLS } from "./parity";
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

let readOnlyDiscovery: { tools: ReturnType<typeof buildToolDefinitions> } | undefined;

/** The tools a read-only credential can call. Saves context and stops agents planning writes. */
function prepareReadOnlyMcpDiscovery() {
	return (readOnlyDiscovery ??= {
		// Read-only by annotation and by the permission its route needs: a POST that only reads still needs write.
		tools: prepareMcpDiscovery().tools.filter(
			(tool) => tool.annotations?.readOnlyHint === true && !PARITY_WRITE_TOOLS.has(tool.name),
		),
	});
}

type ToolDiscoveryOptions = { canWrite?: boolean };

/**
 * Install after tool registration so SDK tools/call validation and callbacks remain intact. A credential that can't
 * write lists only read-only tools; calling another one still answers with the permission it needs.
 */
export function registerToolDiscovery(server: McpServer, { canWrite = true }: ToolDiscoveryOptions = {}) {
	const metadata = canWrite ? prepareMcpDiscovery() : prepareReadOnlyMcpDiscovery();
	// The public low-level handler API avoids SDK tools/list reconverting every schema per request.
	server.server.setRequestHandler(ListToolsRequestSchema, () => metadata);
}
