import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterClient } from "@orpc/server";
import type router from "@reactive-resume/api/routers";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ORPCError } from "@orpc/server";
import { createResumeDataJsonSchema } from "@reactive-resume/schema/resume/json-schema";
import { MCP_TOOL_NAME as T } from "./mcp-tool-names";
import { safeMcpError } from "./results";

export function registerResources(server: McpServer, client: RouterClient<typeof router>) {
	// ── Resource: resume://{id} ──────────────────────────────────
	// Template resource: read resume JSON by ID. Discovery is via list tool (tools), not resources/list.
	const resumeTemplate = new ResourceTemplate("resume://{id}", { list: undefined });

	server.registerResource(
		"resume",
		resumeTemplate,
		{
			title: "Resume Data",
			mimeType: "application/json",
			description: [
				"Full resume data as JSON, including basics, summary, sections, custom sections, and metadata.",
				`Discover resume IDs with the \`${T.listResumes}\` tool, then read \`resume://{id}\` or use \`${T.getResume}\`.`,
				"Appears in `resources/templates/list`; not enumerated in `resources/list`.",
				"Embedded as context in MCP prompts (build_resume, improve_resume, etc.).",
			].join(" "),
		},
		async (uri: URL) => {
			try {
				const match = /^resume:\/\/([^/?#]+)$/.exec(uri.href);
				const id = match?.[1] ? decodeURIComponent(match[1]) : "";
				if (!id || /[\s/?#@]/.test(id))
					throw new ORPCError("BAD_REQUEST", { message: "Invalid resume URI. Expected format: resume://{id}" });

				const resume = await client.resume.getById({ id });

				return {
					contents: [
						{
							uri: uri.href,
							mimeType: "application/json" as const,
							text: JSON.stringify(resume.data, null, 2),
						},
					],
				};
			} catch (error) {
				throw safeMcpError(error, "reading resume resource");
			}
		},
	);

	// ── Resource: resume://_meta/schema ───────────────────────────
	// Static resource containing the JSON Schema for resume data.
	// LLMs should reference this when generating JSON Patch operations
	// to ensure paths and values conform to the expected structure.
	server.registerResource(
		"resume-schema",
		"resume://_meta/schema",
		{
			title: "Resume Data JSON Schema",
			mimeType: "application/json",
			description: [
				"The JSON Schema describing the complete resume data structure.",
				"Reference this when generating JSON Patch operations to ensure paths and value types are valid.",
				"Covers: basics, summary, picture, sections (experience, education, skills, etc.),",
				"custom sections, and metadata (template, layout, typography, colors, CSS).",
			].join(" "),
		},
		(uri: URL) => {
			try {
				return {
					contents: [
						{
							uri: uri.href,
							mimeType: "application/json" as const,
							// Generated from the Zod schema, like /schema.json, so it never drifts from what writes accept.
							text: JSON.stringify(createResumeDataJsonSchema(), null, 2),
						},
					],
				};
			} catch (error) {
				throw safeMcpError(error, "reading resume schema resource");
			}
		},
	);
}
