import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { RouterClient } from "@orpc/server";
import type { RequestAuthentication } from "@reactive-resume/api/context";
import type router from "@reactive-resume/api/routers";
import type z from "zod";
import { ORPCError } from "@orpc/server";
import { resolveUserFromRequestHeaders } from "@reactive-resume/api/context";
import { applicationDto } from "@reactive-resume/api/dto/application";
import { coverLetterDto } from "@reactive-resume/api/dto/cover-letter";
import { resumeDto } from "@reactive-resume/api/dto/resume";
import { createResumePdfDownloadUrl } from "@reactive-resume/api/features/resume/export";
import { env } from "@reactive-resume/env/server";
import { readMcpFile } from "./files";
import { MCP_TOOL_NAME as T } from "./mcp-tool-names";
import { getClientCall, json, text, withErrorHandling } from "./results";
import { TOOL_META } from "./tool-meta";

function coerceFollowUpAt(input: Record<string, unknown>): Record<string, unknown> {
	if (!("followUpAt" in input)) return input;

	const followUpAt = input.followUpAt;
	if (followUpAt === undefined || followUpAt === null || followUpAt instanceof Date) return input;

	return { ...input, followUpAt: new Date(String(followUpAt)) };
}

function buildResumeShareUrl(username: string, slug: string): string {
	const base = env.APP_URL.replace(/\/$/, "");
	return `${base}/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`;
}

function resumeShareUrlNotes(input: { isPublic: boolean; hasPassword: boolean }): string {
	const lines = [
		"Anyone can open this link without signing in only when the resume is public (`isPublic: true`).",
		input.isPublic
			? "This resume is currently public."
			: "This resume is currently private; the URL is still your canonical share link if you make it public later.",
	];
	if (input.hasPassword)
		lines.push(
			"Password protection is enabled in the web app; visitors may need that password before content is shown.",
		);
	return lines.join("\n");
}

/** Tools whose structured result is the procedure's own response; the router client validates their input. */
const DIRECT_TOOLS = {
	[T.listResumeTags]: "resume.tags.list",
	[T.getResumeStatistics]: "resume.statistics.getById",
	[T.readCoverLetter]: "coverLetters.getById",
	[T.createCoverLetter]: "coverLetters.create",
	[T.updateCoverLetter]: "coverLetters.update",
	[T.refreshCoverLetterStyle]: "coverLetters.refreshStyle",
	[T.duplicateCoverLetter]: "coverLetters.duplicate",
	[T.exportCoverLetter]: "coverLetters.export",
	[T.importCoverLetter]: "coverLetters.import",
	[T.readApplication]: "applications.getById",
	[T.listApplicationTags]: "applications.tags",
	[T.getApplicationStats]: "applications.stats",
	[T.addApplicationNote]: "applications.addNote",
	[T.addApplicationInterview]: "applications.addInterview",
	[T.updateApplicationInterview]: "applications.updateInterview",
	[T.updateApplicationTimelineEntry]: "applications.updateTimelineEntry",
	[T.deleteApplicationTimelineEntry]: "applications.deleteTimelineEntry",
	[T.bulkUpdateApplications]: "applications.bulkUpdate",
	[T.bulkDeleteApplications]: "applications.bulkDelete",
	[T.removeApplicationDocument]: "applications.removeDocument",
	[T.autofillApplicationFromJob]: "applications.ai.autofill",
	[T.scoreApplicationMatch]: "applications.ai.matchScore",
	[T.tailorResumeForApplication]: "applications.ai.tailorResume",
	[T.draftApplicationMessage]: "applications.ai.draftMessage",
} as const;

type ToolName = keyof typeof TOOL_META;
type ToolHandler<K extends ToolName> = (
	params: z.infer<(typeof TOOL_META)[K]["inputSchema"]>,
) => Promise<CallToolResult>;

export function registerTools(
	server: McpServer,
	client: RouterClient<typeof router>,
	requestHeaders: Headers,
	authentication?: RequestAuthentication,
) {
	const handlers: { [K in Exclude<ToolName, keyof typeof DIRECT_TOOLS>]: ToolHandler<K> } = {
		[T.listResumes]: withErrorHandling("listing resumes", async (params) => {
			const resumes = await client.resume.list(params);
			return text(JSON.stringify(resumes, null, 2), {
				items: resumes,
				limit: params.limit,
				offset: params.offset,
				nextOffset: resumes.length === params.limit ? params.offset + resumes.length : null,
			});
		}),

		[T.getResume]: withErrorHandling("getting resume", async ({ id }) => {
			const resume = await client.resume.getById({ id });

			return text(JSON.stringify(resume.data, null, 2), resume);
		}),

		[T.downloadResumePdf]: withErrorHandling("creating PDF download URL", async ({ id }) => {
			const resume = await client.resume.getById({ id });
			const user = authentication?.user ?? (await resolveUserFromRequestHeaders(requestHeaders));
			if (!user) throw new ORPCError("UNAUTHORIZED");

			const signedUrl = createResumePdfDownloadUrl({ resumeId: id, userId: user.id });

			return json({
				resumeId: id,
				name: resume.name,
				downloadUrl: signedUrl.url,
				expiresAt: signedUrl.expiresAt,
				expiresInSeconds: signedUrl.expiresInSeconds,
				contentType: "application/pdf",
			});
		}),

		[T.createResume]: withErrorHandling("creating resume", async (params) => {
			const { name, slug, withSampleData } = params;
			const id = await client.resume.create(params);

			return text(
				`Created resume "${name}" (ID: ${id}) ${slug ? `with slug "${slug}"` : "with a generated address"}.${withSampleData ? " Pre-filled with sample data." : ""}\n\nNext steps: Use \`${T.getResume}\` to view it, or \`${T.patchResume}\` to start editing.`,
				{ id },
			);
		}),

		[T.importResume]: withErrorHandling("importing resume", async ({ data }) => {
			const parsed = resumeDto.import.input.safeParse({ data });
			if (!parsed.success)
				return {
					isError: true,
					content: [
						{
							type: "text",
							text: `Invalid ResumeData: ${parsed.error.message}\n\nHint: Ensure the JSON matches the schema at resume://_meta/schema`,
						},
					],
				};

			const id = await client.resume.import(parsed.data);

			return text(
				`Imported resume (ID: ${id}).\n\nNext steps: Use \`${T.getResume}\` to inspect metadata (name/slug were auto-generated), or \`${T.updateResume}\` / \`${T.patchResume}\` to adjust.`,
				{ id },
			);
		}),

		[T.duplicateResume]: withErrorHandling("duplicating resume", async ({ id, name, slug, tags }) => {
			const newId = await client.resume.duplicate({
				id,
				...(name ? { name } : {}),
				...(slug ? { slug } : {}),
				...(tags ? { tags } : {}),
			});

			return text(
				`Duplicated resume${name ? ` as "${name}"` : ""} (ID: ${newId}) ${slug ? `with slug "${slug}"` : "with a generated address"}.\n\nNext steps: Use \`${T.getResume}\` to view it, or \`${T.patchResume}\` to customize.`,
				{ id: newId },
			);
		}),

		[T.patchResume]: withErrorHandling("patching resume", async (params) => {
			const { operations } = params;
			const resume = await client.resume.patch(resumeDto.patch.input.parse(params));
			const summary = operations.map((op) => `${op.op} ${op.path}`).join(", ");

			return text(`Applied ${operations.length} operation(s) to "${resume.name}": ${summary}`, resume);
		}),

		[T.updateResume]: withErrorHandling("updating resume", async (params) => {
			const input = resumeDto.update.input.parse(params);
			if (!Object.entries(input).some(([key, value]) => key !== "id" && key !== "sessionId" && value !== undefined))
				throw new ORPCError("BAD_REQUEST", { message: "Provide at least one field to update." });
			const resume = await client.resume.update(input);

			const user = authentication?.user ?? (await resolveUserFromRequestHeaders(requestHeaders));
			const username =
				user && "username" in user && typeof (user as { username: unknown }).username === "string"
					? (user as { username: string }).username
					: "";
			const shareUrl =
				username !== ""
					? buildResumeShareUrl(username, resume.slug)
					: "(could not build share URL: missing username on account)";

			const payload = {
				id: resume.id,
				name: resume.name,
				slug: resume.slug,
				tags: resume.tags,
				isPublic: resume.isPublic,
				hasPassword: resume.hasPassword,
				shareUrl,
			};

			return text(
				[
					JSON.stringify(payload, null, 2),
					"",
					resumeShareUrlNotes({ isPublic: resume.isPublic, hasPassword: resume.hasPassword }),
				].join("\n"),
				payload,
			);
		}),

		[T.deleteResume]: withErrorHandling("deleting resume", async ({ id }) => {
			await client.resume.delete({ id });

			return text(`Moved resume (${id}) to Trash. Restore it within 30 days.`);
		}),

		[T.lockResume]: withErrorHandling("locking resume", async ({ id }) => {
			await client.resume.setLocked({ id, isLocked: true });

			return text(`Resume (${id}) is now locked. It cannot be edited, patched, or deleted until unlocked.`);
		}),

		[T.unlockResume]: withErrorHandling("unlocking resume", async ({ id }) => {
			await client.resume.setLocked({ id, isLocked: false });

			return text(`Resume (${id}) is now unlocked. It can be edited, patched, and deleted.`);
		}),

		[T.listCoverLetters]: withErrorHandling("listing cover letters", async (params) => {
			const result = await client.coverLetters.list(coverLetterDto.list.input.parse(params));
			return text(JSON.stringify(result, null, 2), {
				...result,
				limit: params.limit,
				offset: params.offset,
				nextOffset: params.offset + result.items.length < result.total ? params.offset + result.items.length : null,
			});
		}),

		[T.deleteCoverLetter]: withErrorHandling("deleting cover letter", async (params) => {
			await client.coverLetters.delete(coverLetterDto.delete.input.parse(params));
			return text(`Moved cover letter to Trash (${params.id}).`);
		}),

		[T.listApplications]: withErrorHandling("listing applications", async (params) => {
			const items = await client.applications.list(params);
			return text(JSON.stringify(items, null, 2), {
				items,
				limit: params.limit,
				offset: params.offset,
				nextOffset: items.length === params.limit ? params.offset + items.length : null,
			});
		}),

		[T.createApplication]: withErrorHandling("creating application", async (params) => {
			const id = await client.applications.create(applicationDto.create.input.parse(coerceFollowUpAt(params)));
			return json({ id });
		}),

		[T.updateApplication]: withErrorHandling("updating application", async (params) =>
			json(await client.applications.update(applicationDto.update.input.parse(coerceFollowUpAt(params)))),
		),

		[T.deleteApplication]: withErrorHandling("deleting application", async ({ id }) => {
			await client.applications.delete({ id });
			return text(`Deleted application (${id}).`);
		}),

		[T.importApplications]: withErrorHandling("importing applications", async (params) =>
			json(
				await client.applications.import(
					applicationDto.import.input.parse({ items: params.items.map(coerceFollowUpAt) }),
				),
			),
		),

		[T.attachApplicationDocument]: withErrorHandling("attaching application document", async (params) => {
			const user = authentication?.user ?? (await resolveUserFromRequestHeaders(requestHeaders));
			if (!user) throw new ORPCError("UNAUTHORIZED");
			const file = await readMcpFile(
				{
					name: params.fileName,
					contentType: params.contentType,
					...(params.dataBase64 !== undefined
						? { dataBase64: params.dataBase64 }
						: { storagePath: params.storagePath }),
				},
				user.id,
			);
			if ((await file.slice(0, 5).text()) !== "%PDF-")
				throw new ORPCError("BAD_REQUEST", { message: "Supply a PDF file." });
			return json(await client.applications.attachDocument({ id: params.id, kind: params.kind, file }));
		}),
	};

	// Register in TOOL_META order so the SDK's tools/list matches the static discovery list.
	for (const [name, meta] of Object.entries(TOOL_META)) {
		const path = DIRECT_TOOLS[name as keyof typeof DIRECT_TOOLS];
		const handler =
			handlers[name as keyof typeof handlers] ??
			withErrorHandling(`calling ${name}`, async (params: unknown) => json(await getClientCall(client, path)(params)));
		server.registerTool(name, meta, handler as never);
	}
}
