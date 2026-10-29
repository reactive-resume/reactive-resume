import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { MCP_TOOL_NAME } from "./mcp-tool-names";
import { PARITY_TOOL_META } from "./parity";
import { TOOL_META } from "./tool-meta";

describe("tool annotations", () => {
	it("keeps reviewer justifications aligned with every registered tool", () => {
		const review = readFileSync(new URL("./fixtures/tool-annotations.md", import.meta.url), "utf8");
		const rows = new Map(
			[
				...review.matchAll(
					/^\| `([^`]+)` +\| (true|false) +\| (true|false) +\| (true|false) +\| (true|false) +\| (.+?) +\|$/gm,
				),
			].map(
				([, name, readOnly, destructive, idempotent, openWorld, reason]) =>
					[
						name,
						{
							annotations: {
								readOnlyHint: readOnly === "true",
								destructiveHint: destructive === "true",
								idempotentHint: idempotent === "true",
								openWorldHint: openWorld === "true",
							},
							reason,
						},
					] as const,
			),
		);
		const tools = { ...TOOL_META, ...PARITY_TOOL_META };
		expect([...rows.keys()].sort()).toEqual(Object.keys(tools).sort());
		for (const [name, tool] of Object.entries(tools)) {
			const row = rows.get(name);
			expect(tool.annotations, name).toMatchObject(row?.annotations ?? {});
			expect(row?.reason?.length, name).toBeGreaterThan(40);
		}
	});

	it("declares all four behavior hints as booleans for every tool", () => {
		for (const [name, tool] of Object.entries({ ...TOOL_META, ...PARITY_TOOL_META })) {
			for (const hint of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const) {
				expect(typeof tool.annotations[hint], `${name}.${hint}`).toBe("boolean");
			}
		}
	});

	it("accounts for destructive effects hidden behind list, rename, copy and test operations", () => {
		for (const name of [
			"api_documents_list",
			"api_documents_rename",
			"api_documents_link_application",
			"api_documents_copy_for_job",
			"api_resume_rename_version",
			"api_cover_letters_rename_version",
			"api_ai_providers_test",
			"api_agent_threads_get",
			"api_ai_parse_pdf",
			"api_web_access_test",
			"api_applications_ai_search_postings",
		]) {
			expect(PARITY_TOOL_META[name]?.annotations, name).toMatchObject({ readOnlyHint: false, destructiveHint: true });
		}
	});

	it("distinguishes internal operations from external AI, search and public sharing", () => {
		for (const name of [
			"api_web_access_status",
			"api_web_access_delete",
			"api_ai_providers_list",
			"api_ai_providers_delete",
			"api_ai_providers_set_default",
			"api_agent_messages_resume",
			"api_agent_attachments_create",
			"api_rest_document_exports_resume",
			"api_rest_document_exports_letter",
			"api_rest_check_pdf",
			"api_rest_match_resume",
			"api_rest_import_resume_file",
		]) {
			expect(PARITY_TOOL_META[name]?.annotations.openWorldHint, name).toBe(false);
		}
		for (const name of [
			"api_agent_messages_send",
			"api_applications_ai_search_postings",
			"api_resume_get_by_slug",
			"api_documents_trash",
			"api_documents_restore",
		]) {
			expect(PARITY_TOOL_META[name]?.annotations.openWorldHint, name).toBe(true);
		}
	});

	it("marks tools that replace or remove existing data as destructive", () => {
		for (const name of [
			MCP_TOOL_NAME.patchResume,
			MCP_TOOL_NAME.updateResume,
			MCP_TOOL_NAME.deleteResume,
			MCP_TOOL_NAME.updateApplication,
			MCP_TOOL_NAME.deleteApplication,
			MCP_TOOL_NAME.updateApplicationTimelineEntry,
			MCP_TOOL_NAME.updateApplicationInterview,
			MCP_TOOL_NAME.bulkUpdateApplications,
			MCP_TOOL_NAME.bulkDeleteApplications,
			MCP_TOOL_NAME.attachApplicationDocument,
			MCP_TOOL_NAME.removeApplicationDocument,
			MCP_TOOL_NAME.scoreApplicationMatch,
			MCP_TOOL_NAME.tailorResumeForApplication,
			MCP_TOOL_NAME.updateCoverLetter,
			MCP_TOOL_NAME.refreshCoverLetterStyle,
			MCP_TOOL_NAME.deleteCoverLetter,
			MCP_TOOL_NAME.autofillApplicationFromJob,
		]) {
			expect(TOOL_META[name].annotations.readOnlyHint, name).toBe(false);
			expect(TOOL_META[name].annotations.destructiveHint, name).toBe(true);
		}
	});
});
