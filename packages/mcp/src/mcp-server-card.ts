import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { MCP_TOOL_NAME as T } from "./mcp-tool-names";
import { PARITY_TOOL_META } from "./parity";
import { PROMPT_META } from "./prompts";
import { TOOL_META } from "./tool-meta";

const RESUME_ID_ARGUMENT = [{ name: "id", description: "Resume ID.", required: true }] as const;

/** Shared server identity for both the live MCP server and the static server card. */
export function buildMcpServerInfo(version: string) {
	return {
		name: "reactive-resume",
		version,
		title: "Reactive Resume",
		websiteUrl: "https://rxresu.me",
		description:
			"Reactive Resume is a free and open-source resume builder. Use this MCP server to interact with your resume using an LLM of your choice.",
		icons: [
			{ src: "https://rxresu.me/icon/light.svg", mimeType: "image/svg+xml", theme: "light" as const },
			{ src: "https://rxresu.me/icon/dark.svg", mimeType: "image/svg+xml", theme: "dark" as const },
		],
	};
}

/**
 * Static MCP server card (SEP-1649 / well-known `mcp/server-card.json`).
 * Kept in sync with `registerTools`, `registerResources`, and `registerPrompts`.
 *
 * Some registries only surface the `resources` array in their UI, not `resourceTemplates`.
 * The parameterized resume URI is therefore duplicated here so discovery matches the live template.
 */
export function buildMcpServerCard(appVersion: string) {
	// ponytail: derived from TOOL_META; title/description/inputSchema/annotations declared once
	const tools = Object.entries({ ...TOOL_META, ...PARITY_TOOL_META }).map(
		([name, { title, description, inputSchema, outputSchema, annotations }]) => ({
			name,
			title,
			description,
			inputSchema: toJsonSchemaCompat(inputSchema, { strictUnions: true, pipeStrategy: "input" }),
			outputSchema: toJsonSchemaCompat(outputSchema, { strictUnions: true, pipeStrategy: "output" }),
			annotations,
		}),
	);

	const prompts = Object.entries(PROMPT_META).map(([name, meta]) => ({
		name,
		...meta,
		arguments: [...RESUME_ID_ARGUMENT],
	}));

	const resources = [
		{
			name: "resume-schema",
			title: "Resume Data JSON Schema",
			uri: "resume://_meta/schema",
			description: [
				"The JSON Schema describing the complete resume data structure.",
				"Reference when generating JSON Patch operations so paths and value types are valid.",
			].join(" "),
			mimeType: "application/json",
		},
		{
			name: "resume",
			title: "Resume Data",
			uri: "resume://{id}",
			description: [
				"Full resume JSON for one resume. Substitute a real ID for `{id}` (UUID from your account).",
				"On the wire this is a resource template (`resources/templates/list`), not a row in `resources/list`.",
				`Discover IDs with \`${T.listResumes}\`; read via \`resources/read\` on e.g. \`resume://<id>\` or use \`${T.getResume}\`.`,
			].join(" "),
			mimeType: "application/json",
		},
	];

	const resourceTemplates = [
		{
			name: "resume",
			title: "Resume Data",
			uriTemplate: "resume://{id}",
			description: "Full resume data as JSON. Discover IDs with the list tool; read via resources/read or read_resume.",
			mimeType: "application/json",
		},
	];

	return {
		/**
		 * Optional session fields for gateways. OAuth is primary; API key is optional for clients that support custom headers.
		 */
		configurationSchema: {
			type: "object",
			properties: {
				apiKey: {
					type: "string",
					title: "API key",
					description:
						"Optional. Create a key under Settings → AI & developer → API keys. Forwarded as the x-api-key header when not using OAuth.",
					"x-from": { header: "x-api-key" },
				},
			},
		},
		serverInfo: buildMcpServerInfo(appVersion),
		tools,
		prompts,
		resources,
		resourceTemplates,
		authentication: {
			required: true,
			schemes: ["oauth2", "bearer", "apiKey"],
		},
	};
}
