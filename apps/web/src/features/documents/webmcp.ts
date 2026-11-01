import type { WebMcpTool } from "@/libs/webmcp";
import { useRouter } from "@tanstack/react-router";
import { useMemo } from "react";
import z from "zod";
import { client } from "@/libs/orpc/client";
import { defineWebMcpTool, useWebMcpTools } from "@/libs/webmcp";

const documentTypeSchema = z.enum(["resume", "letter"]);

function createDocumentTools(router: ReturnType<typeof useRouter>): readonly WebMcpTool[] {
	const listDocuments = defineWebMcpTool({
		name: "list_documents",
		title: "List documents",
		description: [
			"List the signed-in user's resumes and saved cover letters (type resume or letter), most recently edited first,",
			"with their tags, whether they're locked, and the job application each was made for.",
			"Open one with open_document to read or edit it.",
		].join(" "),
		input: z.object({}),
		annotations: { readOnlyHint: true, untrustedContentHint: true },
		execute: async (_, signal) => {
			const documents = await client.documents.list({ trashed: false }, signal ? { signal } : {});
			return [...documents]
				.sort((a, b) => b.editedAt.getTime() - a.editedAt.getTime())
				.map(({ type, id, name, tags, isLocked, updatedAt, editedAt, application }) => ({
					type,
					id,
					name,
					tags,
					isLocked,
					updatedAt,
					editedAt,
					application,
				}));
		},
	});

	const openDocument = defineWebMcpTool({
		name: "open_document",
		title: "Open document",
		description: [
			"Open a resume or cover letter from list_documents in the editor. The editor's tools (read_resume,",
			"apply_resume_patch and check_resume for a resume; read_cover_letter and update_cover_letter for a letter)",
			"become available once it has loaded.",
		].join(" "),
		input: z.object({
			type: documentTypeSchema.describe("resume, or letter (a saved cover letter)."),
			id: z.string().min(1).describe("The document's ID from list_documents."),
		}),
		execute: async ({ type, id }, signal) => {
			const documents = await client.documents.list({ trashed: false }, signal ? { signal } : {});
			const document = documents.find((item) => item.type === type && item.id === id);
			if (!document) throw new Error(`No ${type} with ID ${id}. Use list_documents to find one.`);

			if (type === "letter")
				await router.navigate({ to: "/builder/letter/$coverLetterId", params: { coverLetterId: id } });
			else await router.navigate({ to: "/builder/$resumeId", params: { resumeId: id } });

			return `Opened “${document.name}” in the editor.`;
		},
	});

	return [listDocuments, openDocument];
}

/** Offers the signed-in user's documents to the browser's AI agent on every page. */
export function useDocumentWebMcpTools(enabled: boolean) {
	const router = useRouter();
	const tools = useMemo(() => (enabled ? createDocumentTools(router) : []), [enabled, router]);
	useWebMcpTools(tools);
}
