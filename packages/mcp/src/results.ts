import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { ORPCError } from "@orpc/server";
import z from "zod";
import { MCP_TOOL_NAME } from "./mcp-tool-names";

function errorMessage(error: unknown): string {
	if (error instanceof ORPCError && error.status < 500) return error.message;
	if (error instanceof z.ZodError) return "Invalid input. Check the tool schema.";
	return "Unexpected failure. Retry; contact the administrator if it persists.";
}

/**
 * Maps a failed router call to an actionable next step for the model.
 *
 * Matches on the error's `code` and `status` rather than its message: procedures
 * throw `new ORPCError("RESUME_LOCKED")` and friends without a message, so the
 * message is the code itself (`"RESUME_LOCKED"`) or oRPC's own default
 * (`"Not Found"` for `NOT_FOUND`), and HTTP status never appears in it at all.
 */
function errorHint(error: unknown): string {
	if (!(error instanceof ORPCError)) return "";

	const { unlockResume, listResumes, listApplications } = MCP_TOOL_NAME;
	const { code, status } = error;

	// Check codes before statuses: RESUME_SLUG_ALREADY_EXISTS is thrown with status 400.
	if (code === "RESUME_SLUG_ALREADY_EXISTS") return "\n\nHint: The slug is already in use. Try a different one.";
	if (code === "INVALID_SLUG")
		return "\n\nHint: Use lowercase letters and numbers joined by single dashes, e.g. 'product-designer'.";
	if (code === "RESUME_LOCKED")
		return `\n\nHint: This resume is locked. Ask the user before unlocking with \`${unlockResume}\`.`;
	// Every tool shares this handler, so the wording stays entity-agnostic: `NOT_FOUND` is
	// thrown by the application procedures too, and resume-flavoured advice misdirects there.
	if (code === "NOT_FOUND" || status === 404)
		return `\n\nHint: Not found. Check the ID — \`${listResumes}\`, \`${MCP_TOOL_NAME.listCoverLetters}\`, and \`${listApplications}\` return valid ones.`;
	if (code === "FORBIDDEN" || status === 403)
		return "\n\nHint: Permission denied. This account cannot access that record.";
	if (code === "CONFLICT" || status === 409)
		return "\n\nHint: Reread the document and recompute changes using its latest timestamp or revision.";
	if (status === 401) return "\n\nHint: Reconnect with OAuth or supply a valid API key.";
	if (status === 429) return "\n\nHint: Rate limit exceeded. Wait before retrying.";
	if (status === 400) return "\n\nHint: Invalid request. Check the input parameters against the tool's schema.";
	return "";
}

/**
 * Wraps an async tool handler with consistent error formatting.
 * On success, returns the handler's result directly.
 * On failure, returns `{ isError: true, content: [{ type: "text", text }] }` with actionable hints.
 */
export function withErrorHandling<T, Args extends unknown[]>(
	label: string,
	handler: (params: T, ...args: Args) => Promise<CallToolResult>,
) {
	return async (params: T, ...args: Args): Promise<CallToolResult> => {
		try {
			return await handler(params, ...args);
		} catch (error) {
			const reference =
				(error instanceof ORPCError && error.status < 500) || error instanceof z.ZodError ? undefined : randomUUID();
			if (reference) console.error("MCP tool failure", { reference, operation: label });
			return {
				isError: true,
				content: [
					{
						type: "text",
						text: `Error ${label}: ${errorMessage(error)}${errorHint(error)}${reference ? `\n\nReference: ${reference}` : ""}`,
					},
				],
			};
		}
	};
}

export function text(value: string, structured: Record<string, unknown> = { message: value }): CallToolResult {
	return { content: [{ type: "text", text: value }], structuredContent: JSON.parse(JSON.stringify(structured)) };
}

export function json(value: unknown): CallToolResult {
	const structured = Array.isArray(value)
		? { items: value }
		: value !== null && typeof value === "object"
			? value
			: { result: value ?? null };
	return text(JSON.stringify(value ?? null, null, 2), structured as Record<string, unknown>);
}

/** Protocol callbacks cannot return tool isError results; emit sanitized JSON-RPC errors. */
export function safeMcpError(error: unknown, operation: string): McpError {
	const invalidInput = error instanceof z.ZodError || error instanceof URIError;
	const known = error instanceof ORPCError && error.status < 500;
	const reference = known || invalidInput ? undefined : randomUUID();
	if (reference) console.error("MCP callback failure", { reference, operation });
	const message = invalidInput ? "Invalid input. Check the resource URI or prompt arguments." : errorMessage(error);
	return new McpError(
		known || invalidInput ? ErrorCode.InvalidParams : ErrorCode.InternalError,
		`${message}${errorHint(error)}${reference ? `\n\nReference: ${reference}` : ""}`,
		{
			code: known ? error.code : invalidInput ? "INVALID_INPUT" : "INTERNAL_ERROR",
			...(reference ? { reference } : {}),
		},
	);
}
