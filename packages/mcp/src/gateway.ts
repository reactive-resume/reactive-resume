import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import z from "zod";
import { env } from "@reactive-resume/env/server";
import { READ_IDEMPOTENT, WRITE_DESTRUCTIVE_EXTERNAL } from "./annotations";
import { PARITY_TOOL_META, PARITY_WRITE_TOOLS } from "./parity";
import { json } from "./results";

/**
 * MCP_API_TOOLS: "all" lists every api_* tool, "search" serves them through api_search + api_execute,
 * "none" leaves them out. Listed, the api_* tools are most of tools/list (~0.5 MB of ~0.7 MB).
 */
export function apiToolsMode() {
	return env.MCP_API_TOOLS;
}

export const isApiTool = (name: string) => name.startsWith("api_");

const searchTitle = "Search the Reactive Resume API";
const executeTitle = "Run a Reactive Resume API operation";

export const API_GATEWAY_TOOL_META = {
	api_search: {
		title: searchTitle,
		description:
			"Find Reactive Resume API operations beyond the dedicated tools (resume versions, AI, career profile and facts, cover letter versions, documents, statistics, agent threads, AI providers…) by keywords. Returns each match's name, description and input JSON Schema; run one with api_execute.",
		inputSchema: z.object({
			query: z.string().describe("Keywords, e.g. 'resume versions' or 'career facts'."),
			limit: z.number().int().min(1).max(20).optional().describe("Most matches to return, default 8."),
		}),
		outputSchema: z.object({
			tools: z.array(
				z.object({ name: z.string(), title: z.string(), description: z.string(), inputSchema: z.unknown().optional() }),
			),
		}),
		annotations: { title: searchTitle, ...READ_IDEMPOTENT },
	},
	api_execute: {
		title: executeTitle,
		description:
			"Run an operation found with api_search, by its name. `arguments` must match that operation's input schema.",
		inputSchema: z.object({
			name: z.string().describe("Operation name from api_search, e.g. api_resume_list_versions."),
			arguments: z.record(z.string(), z.unknown()).optional(),
		}),
		outputSchema: z.looseObject({}),
		annotations: { title: executeTitle, ...WRITE_DESTRUCTIVE_EXTERNAL },
	},
};

export const GATEWAY_TOOL_NAMES: ReadonlySet<string> = new Set(["api_search", "api_execute"]);

/** Same rule as read-only discovery: read-only by annotation and by the permission its route needs. */
const readableWithoutWrite = (name: string) =>
	PARITY_TOOL_META[name]?.annotations.readOnlyHint === true && !PARITY_WRITE_TOOLS.has(name);

function searchApiTools(callable: ReadonlySet<string>, query: string, limit = 8) {
	const words = query
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
	const scored = Object.entries(PARITY_TOOL_META)
		.filter(([name]) => callable.has(name))
		.map(([name, meta]) => {
			const haystack = `${name.replaceAll("_", " ")} ${meta.title} ${meta.description}`.toLowerCase();
			const score = words.reduce(
				(total, word) => total + (name.includes(word) ? 3 : haystack.includes(word) ? 1 : 0),
				0,
			);
			return { name, meta, score };
		})
		.filter(({ score }) => score > 0)
		.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
		.slice(0, limit);
	return scored.map(({ name, meta }) => ({
		name,
		title: meta.title,
		description: meta.description,
		inputSchema: toJsonSchemaCompat(meta.inputSchema as z.ZodType, { strictUnions: true, pipeStrategy: "input" }),
	}));
}

type ToolCallback = (args: unknown, extra: unknown) => CallToolResult | Promise<CallToolResult>;

const toolError = (text: string): CallToolResult => ({ isError: true, content: [{ type: "text", text }] });

/**
 * Runs `register` against a server whose api_* registrations are captured instead of
 * listed; with `expose`, they are reachable through api_search and api_execute.
 */
export function registerApiGateway(
	server: McpServer,
	register: (target: McpServer) => void,
	{ expose, canWrite = true }: { expose: boolean; canWrite?: boolean },
) {
	const handlers = new Map<string, ToolCallback>();
	const capture = new Proxy(server, {
		get(target, property, receiver) {
			if (property !== "registerTool") return Reflect.get(target, property, receiver);
			return (name: string, meta: unknown, callback: ToolCallback) => {
				if (isApiTool(name)) handlers.set(name, callback);
				else
					(target.registerTool as unknown as (...args: [string, unknown, ToolCallback]) => void).call(
						target,
						name,
						meta,
						callback,
					);
			};
		},
	});
	register(capture);
	if (!expose) return;

	// A read-only credential only finds, and only runs, what it may call.
	const callable = new Set([...handlers.keys()].filter((name) => canWrite || readableWithoutWrite(name)));
	server.registerTool("api_search", API_GATEWAY_TOOL_META.api_search, ({ query, limit }) =>
		json({ tools: searchApiTools(callable, query, limit) }),
	);
	server.registerTool("api_execute", API_GATEWAY_TOOL_META.api_execute, ({ name, arguments: args }, extra) => {
		const handler = handlers.get(name);
		const meta = PARITY_TOOL_META[name];
		if (!handler || !meta) return toolError(`Unknown operation ${name}. Find one with api_search.`);
		if (!callable.has(name)) return toolError(`${name} needs write access; this credential is read-only.`);
		const parsed = (meta.inputSchema as z.ZodType).safeParse(args ?? {});
		if (!parsed.success) return toolError(`Invalid arguments for ${name}:\n${z.prettifyError(parsed.error)}`);
		return handler(parsed.data, extra);
	});
}
