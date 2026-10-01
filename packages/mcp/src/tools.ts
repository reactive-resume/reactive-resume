import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
import { MCP_TOOL_NAME } from "./mcp-tool-names";
import { json, text, withErrorHandling } from "./results";
import { TOOL_META } from "./tool-meta";

// ── Shared Helpers ───────────────���──────────────────────────────

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

// ── Shared Zod Fragments ─────────────��──────────────────────────

const T = MCP_TOOL_NAME;

// ── Tool Registration ────────────────────���──────────────────────

export function registerTools(
	server: McpServer,
	client: RouterClient<typeof router>,
	requestHeaders: Headers,
	authentication?: RequestAuthentication,
) {
	// ── List Resumes ──────────────────���───────────────────────────
	server.registerTool(
		T.listResumes,
		TOOL_META[T.listResumes],
		withErrorHandling(
			"listing resumes",
			async (params: z.infer<(typeof TOOL_META)[typeof T.listResumes]["inputSchema"]>) => {
				const resumes = await client.resume.list(params);
				return text(JSON.stringify(resumes, null, 2), {
					items: resumes,
					limit: params.limit,
					offset: params.offset,
					nextOffset: resumes.length === params.limit ? params.offset + resumes.length : null,
				});
			},
		),
	);

	// ── List Resume Tags ───────────────────���──────────────────────
	server.registerTool(
		T.listResumeTags,
		TOOL_META[T.listResumeTags],
		withErrorHandling("listing resume tags", async () => {
			const tags = await client.resume.tags.list();

			return json(tags);
		}),
	);

	// ── Read Resume ────────────────���──────────────────────────────
	server.registerTool(
		T.getResume,
		TOOL_META[T.getResume],
		withErrorHandling("getting resume", async ({ id }: { id: string }) => {
			const resume = await client.resume.getById({ id });

			return text(JSON.stringify(resume.data, null, 2), resume);
		}),
	);

	// ── Download Resume PDF ───────────────────────────────────────
	server.registerTool(
		T.downloadResumePdf,
		TOOL_META[T.downloadResumePdf],
		withErrorHandling("creating PDF download URL", async ({ id }: { id: string }) => {
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
	);

	// ── Create Resume ─────────────────────────────────────────────
	server.registerTool(
		T.createResume,
		TOOL_META[T.createResume],
		withErrorHandling(
			"creating resume",
			async (params: z.infer<(typeof TOOL_META)[typeof T.createResume]["inputSchema"]>) => {
				const { name, slug, withSampleData } = params;
				const id = await client.resume.create(params);

				return text(
					`Created resume "${name}" (ID: ${id}) ${slug ? `with slug "${slug}"` : "with a generated address"}.${withSampleData ? " Pre-filled with sample data." : ""}\n\nNext steps: Use \`${T.getResume}\` to view it, or \`${T.patchResume}\` to start editing.`,
					{ id },
				);
			},
		),
	);

	// ── Import Resume ─────────────��───────────────────────────────
	server.registerTool(
		T.importResume,
		TOOL_META[T.importResume],
		withErrorHandling("importing resume", async ({ data }: { data: unknown }) => {
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
	);

	// ── Duplicate Resume ────────────────────���─────────────────────
	server.registerTool(
		T.duplicateResume,
		TOOL_META[T.duplicateResume],
		withErrorHandling(
			"duplicating resume",
			async ({
				id,
				name,
				slug,
				tags,
			}: {
				id: string;
				name?: string | undefined;
				slug?: string | undefined;
				tags?: string[] | undefined;
			}) => {
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
			},
		),
	);

	// ── Apply Resume Patch ────────────────────────────────────────
	server.registerTool(
		T.patchResume,
		TOOL_META[T.patchResume],
		withErrorHandling(
			"patching resume",
			async (params: z.infer<(typeof TOOL_META)[typeof T.patchResume]["inputSchema"]>) => {
				const { operations } = params;
				const resume = await client.resume.patch(resumeDto.patch.input.parse(params));
				const summary = operations.map((op) => `${op.op} ${op.path}`).join(", ");

				return text(`Applied ${operations.length} operation(s) to "${resume.name}": ${summary}`, resume);
			},
		),
	);

	// ── Update Resume (metadata) ─────────────────��───────────────
	server.registerTool(
		T.updateResume,
		TOOL_META[T.updateResume],
		withErrorHandling("updating resume", async (params) => {
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
	);

	// ── Delete Resume ────────────────────────────────────────��────
	server.registerTool(
		T.deleteResume,
		TOOL_META[T.deleteResume],
		withErrorHandling("deleting resume", async ({ id }: { id: string }) => {
			await client.resume.delete({ id });

			return text(`Moved resume (${id}) to Trash. Restore it within 30 days.`);
		}),
	);

	// ── Lock Resume ────────────────���──────────────────────────────
	server.registerTool(
		T.lockResume,
		TOOL_META[T.lockResume],
		withErrorHandling("locking resume", async ({ id }: { id: string }) => {
			await client.resume.setLocked({ id, isLocked: true });

			return text(`Resume (${id}) is now locked. It cannot be edited, patched, or deleted until unlocked.`);
		}),
	);

	// ── Unlock Resume ───────────────���─────────────────────────────
	server.registerTool(
		T.unlockResume,
		TOOL_META[T.unlockResume],
		withErrorHandling("unlocking resume", async ({ id }: { id: string }) => {
			await client.resume.setLocked({ id, isLocked: false });

			return text(`Resume (${id}) is now unlocked. It can be edited, patched, and deleted.`);
		}),
	);

	// ── Get Resume Statistics ────────────────────────────────────
	server.registerTool(
		T.getResumeStatistics,
		TOOL_META[T.getResumeStatistics],
		withErrorHandling("getting resume statistics", async ({ id }: { id: string }) => {
			const stats = await client.resume.statistics.getById({ id });

			return json(stats);
		}),
	);

	// ── Independent Cover Letters + Applications ────────────────────
	server.registerTool(
		T.listCoverLetters,
		TOOL_META[T.listCoverLetters],
		withErrorHandling(
			"listing cover letters",
			async (params: z.infer<(typeof TOOL_META)[typeof T.listCoverLetters]["inputSchema"]>) => {
				const result = await client.coverLetters.list(coverLetterDto.list.input.parse(params));
				return text(JSON.stringify(result, null, 2), {
					...result,
					limit: params.limit,
					offset: params.offset,
					nextOffset: params.offset + result.items.length < result.total ? params.offset + result.items.length : null,
				});
			},
		),
	);

	server.registerTool(
		T.readCoverLetter,
		TOOL_META[T.readCoverLetter],
		withErrorHandling("reading cover letter", async ({ id }: { id: string }) =>
			json(await client.coverLetters.getById({ id })),
		),
	);

	server.registerTool(
		T.createCoverLetter,
		TOOL_META[T.createCoverLetter],
		withErrorHandling(
			"creating cover letter",
			async (params: z.infer<(typeof TOOL_META)[typeof T.createCoverLetter]["inputSchema"]>) =>
				json(await client.coverLetters.create(coverLetterDto.create.input.parse(params))),
		),
	);

	server.registerTool(
		T.updateCoverLetter,
		TOOL_META[T.updateCoverLetter],
		withErrorHandling(
			"updating cover letter",
			async (params: z.infer<(typeof TOOL_META)[typeof T.updateCoverLetter]["inputSchema"]>) =>
				json(await client.coverLetters.update(coverLetterDto.update.input.parse(params))),
		),
	);

	server.registerTool(
		T.refreshCoverLetterStyle,
		TOOL_META[T.refreshCoverLetterStyle],
		withErrorHandling(
			"refreshing cover letter style",
			async (params: z.infer<(typeof TOOL_META)[typeof T.refreshCoverLetterStyle]["inputSchema"]>) =>
				json(await client.coverLetters.refreshStyle(coverLetterDto.refreshStyle.input.parse(params))),
		),
	);

	server.registerTool(
		T.duplicateCoverLetter,
		TOOL_META[T.duplicateCoverLetter],
		withErrorHandling(
			"duplicating cover letter",
			async (params: z.infer<(typeof TOOL_META)[typeof T.duplicateCoverLetter]["inputSchema"]>) =>
				json(await client.coverLetters.duplicate(coverLetterDto.duplicate.input.parse(params))),
		),
	);

	server.registerTool(
		T.deleteCoverLetter,
		TOOL_META[T.deleteCoverLetter],
		withErrorHandling(
			"deleting cover letter",
			async (params: z.infer<(typeof TOOL_META)[typeof T.deleteCoverLetter]["inputSchema"]>) => {
				await client.coverLetters.delete(coverLetterDto.delete.input.parse(params));
				return text(`Moved cover letter to Trash (${params.id}).`);
			},
		),
	);

	server.registerTool(
		T.exportCoverLetter,
		TOOL_META[T.exportCoverLetter],
		withErrorHandling("exporting cover letter", async ({ id }: { id: string }) =>
			json(await client.coverLetters.export({ id })),
		),
	);

	server.registerTool(
		T.importCoverLetter,
		TOOL_META[T.importCoverLetter],
		withErrorHandling(
			"importing cover letter",
			async (params: z.infer<(typeof TOOL_META)[typeof T.importCoverLetter]["inputSchema"]>) =>
				json(await client.coverLetters.import(params)),
		),
	);

	server.registerTool(
		T.listApplications,
		TOOL_META[T.listApplications],
		withErrorHandling(
			"listing applications",
			async (params: z.infer<(typeof TOOL_META)[typeof T.listApplications]["inputSchema"]>) => {
				const items = await client.applications.list(params);
				return text(JSON.stringify(items, null, 2), {
					items,
					limit: params.limit,
					offset: params.offset,
					nextOffset: items.length === params.limit ? params.offset + items.length : null,
				});
			},
		),
	);

	server.registerTool(
		T.readApplication,
		TOOL_META[T.readApplication],
		withErrorHandling("reading application", async ({ id }: { id: string }) =>
			json(await client.applications.getById({ id })),
		),
	);

	server.registerTool(
		T.listApplicationTags,
		TOOL_META[T.listApplicationTags],
		withErrorHandling("listing application tags", async () => json(await client.applications.tags())),
	);

	server.registerTool(
		T.getApplicationStats,
		TOOL_META[T.getApplicationStats],
		withErrorHandling("getting application stats", async () => json(await client.applications.stats())),
	);

	server.registerTool(
		T.createApplication,
		TOOL_META[T.createApplication],
		withErrorHandling(
			"creating application",
			async (params: z.infer<(typeof TOOL_META)[typeof T.createApplication]["inputSchema"]>) => {
				const id = await client.applications.create(applicationDto.create.input.parse(coerceFollowUpAt(params)));
				return json({ id });
			},
		),
	);

	server.registerTool(
		T.updateApplication,
		TOOL_META[T.updateApplication],
		withErrorHandling(
			"updating application",
			async (params: z.infer<(typeof TOOL_META)[typeof T.updateApplication]["inputSchema"]>) =>
				json(await client.applications.update(applicationDto.update.input.parse(coerceFollowUpAt(params)))),
		),
	);

	server.registerTool(
		T.addApplicationNote,
		TOOL_META[T.addApplicationNote],
		withErrorHandling(
			"adding application note",
			async ({ id, text: noteText, date }: { id: string; text: string; date?: string | undefined }) =>
				json(await client.applications.addNote({ id, text: noteText, date })),
		),
	);

	server.registerTool(
		T.addApplicationInterview,
		TOOL_META[T.addApplicationInterview],
		withErrorHandling(
			"adding application interview",
			async (params: z.infer<(typeof TOOL_META)[typeof T.addApplicationInterview]["inputSchema"]>) =>
				json(await client.applications.addInterview(applicationDto.addInterview.input.parse(params))),
		),
	);

	server.registerTool(
		T.updateApplicationInterview,
		TOOL_META[T.updateApplicationInterview],
		withErrorHandling(
			"updating application interview",
			async (params: z.infer<(typeof TOOL_META)[typeof T.updateApplicationInterview]["inputSchema"]>) =>
				json(await client.applications.updateInterview(applicationDto.updateInterview.input.parse(params))),
		),
	);

	server.registerTool(
		T.updateApplicationTimelineEntry,
		TOOL_META[T.updateApplicationTimelineEntry],
		withErrorHandling(
			"updating application timeline entry",
			async (params: z.infer<(typeof TOOL_META)[typeof T.updateApplicationTimelineEntry]["inputSchema"]>) =>
				json(await client.applications.updateTimelineEntry(applicationDto.updateTimelineEntry.input.parse(params))),
		),
	);

	server.registerTool(
		T.deleteApplicationTimelineEntry,
		TOOL_META[T.deleteApplicationTimelineEntry],
		withErrorHandling("deleting application timeline entry", async ({ id, entryId }: { id: string; entryId: string }) =>
			json(await client.applications.deleteTimelineEntry({ id, entryId })),
		),
	);

	server.registerTool(
		T.deleteApplication,
		TOOL_META[T.deleteApplication],
		withErrorHandling("deleting application", async ({ id }: { id: string }) => {
			await client.applications.delete({ id });
			return text(`Deleted application (${id}).`);
		}),
	);

	server.registerTool(
		T.bulkUpdateApplications,
		TOOL_META[T.bulkUpdateApplications],
		withErrorHandling(
			"bulk updating applications",
			async (params: z.infer<(typeof TOOL_META)[typeof T.bulkUpdateApplications]["inputSchema"]>) =>
				json(await client.applications.bulkUpdate(applicationDto.bulkUpdate.input.parse(params))),
		),
	);

	server.registerTool(
		T.bulkDeleteApplications,
		TOOL_META[T.bulkDeleteApplications],
		withErrorHandling("bulk deleting applications", async ({ ids }: { ids: string[] }) =>
			json(await client.applications.bulkDelete({ ids })),
		),
	);

	server.registerTool(
		T.importApplications,
		TOOL_META[T.importApplications],
		withErrorHandling(
			"importing applications",
			async (params: z.infer<(typeof TOOL_META)[typeof T.importApplications]["inputSchema"]>) =>
				json(
					await client.applications.import(
						applicationDto.import.input.parse({ items: params.items.map(coerceFollowUpAt) }),
					),
				),
		),
	);

	server.registerTool(
		T.attachApplicationDocument,
		TOOL_META[T.attachApplicationDocument],
		withErrorHandling(
			"attaching application document",
			async (params: z.infer<(typeof TOOL_META)[typeof T.attachApplicationDocument]["inputSchema"]>) => {
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
			},
		),
	);

	server.registerTool(
		T.removeApplicationDocument,
		TOOL_META[T.removeApplicationDocument],
		withErrorHandling(
			"removing application document",
			async ({ id, kind }: { id: string; kind: "resume" | "cover-letter" }) =>
				json(await client.applications.removeDocument({ id, kind })),
		),
	);

	server.registerTool(
		T.autofillApplicationFromJob,
		TOOL_META[T.autofillApplicationFromJob],
		withErrorHandling(
			"autofilling application from job",
			async (params: z.infer<(typeof TOOL_META)[typeof T.autofillApplicationFromJob]["inputSchema"]>) =>
				json(await client.applications.ai.autofill(params)),
		),
	);

	server.registerTool(
		T.scoreApplicationMatch,
		TOOL_META[T.scoreApplicationMatch],
		withErrorHandling("scoring application match", async ({ id }: { id: string }) =>
			json(await client.applications.ai.matchScore({ id })),
		),
	);

	server.registerTool(
		T.tailorResumeForApplication,
		TOOL_META[T.tailorResumeForApplication],
		withErrorHandling("tailoring resume for application", async ({ id }: { id: string }) =>
			json(await client.applications.ai.tailorResume({ id })),
		),
	);

	server.registerTool(
		T.draftApplicationMessage,
		TOOL_META[T.draftApplicationMessage],
		withErrorHandling(
			"drafting application message",
			async ({ id, kind }: { id: string; kind: "cover-letter" | "follow-up" }) =>
				json(await client.applications.ai.draftMessage({ id, kind })),
		),
	);
}
