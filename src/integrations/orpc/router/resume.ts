import { ORPCError } from "@orpc/client";
import z from "zod";
import { commentAnchorSchema, commentSeveritySchema } from "@/schema/resume/comment-anchor";
import { sampleResumeData } from "@/schema/resume/sample";
import { generateRandomName, slugify } from "@/utils/string";
import { protectedProcedure, publicProcedure, serverOnlyProcedure } from "../context";
import { resumeDto } from "../dto/resume";
import { checkPlacementCredit, consumePlacementCredit } from "../helpers/placement-access";
import { assertReviewStaff, getReviewAccess, requireReviewer, requireReviewerInOrg } from "../helpers/review-access";
import { resumeService } from "../services/resume";
import { aiService as resumeAiService } from "../services/resume-ai";
import { userInfoService } from "../services/user-info";
import { dashboardRouter } from "./dashboard";

// Feedback tables (resume_comment, resume_checklist, resume_evaluation, ...) FK their
// actor columns (author_id, faculty_id, evaluated_by) to the eng-labs `users` table.
// Resolve both id and tenantId server-side — the client-supplied tenantId comes from
// localStorage (sso_context) and can drift from the user's real tenant.
async function resolveEngLabsActor(email: string): Promise<{ id: string; tenantId: string }> {
	const { getEngLabsUserByEmail, getStaffTenantIds } = await import("@/integrations/eng-labs");
	const engUser = await getEngLabsUserByEmail(email);
	if (!engUser) {
		throw new ORPCError("FORBIDDEN", {
			message: "Authenticated user is not provisioned in the institutional directory.",
		});
	}
	// Mapped staff can have no tenant on their own users row; their mapping / unit assignment gives it.
	const tenantId = engUser.tenantId ?? (await getStaffTenantIds(engUser.id))[0];
	if (!tenantId) {
		throw new ORPCError("FORBIDDEN", {
			message: "Authenticated user has no tenant assignment.",
		});
	}
	return { id: engUser.id, tenantId };
}

const commentOutputSchema = z.object({
	id: z.string(),
	resumeId: z.string(),
	parentId: z.string().uuid().nullable(),
	content: z.string(),
	scope: z.string(),
	status: z.string(),
	authorId: z.string(),
	anchor: commentAnchorSchema.nullable(),
	severity: z.string().nullable(),
	suggestion: z.string().nullable(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

const tagsRouter = {
	list: protectedProcedure
		.route({
			method: "GET",
			path: "/resumes/tags",
			tags: ["Resumes"],
			operationId: "listResumeTags",
			summary: "List all resume tags",
			description:
				"Returns a sorted list of all unique tags across the authenticated user's resumes. Useful for populating tag filters in the dashboard. Requires authentication.",
			successDescription: "A sorted array of unique tag strings.",
		})
		.output(z.array(z.string()))
		.handler(async ({ context }) => {
			return await resumeService.tags.list({ userId: context.user.id });
		}),
};

const statisticsRouter = {
	getById: protectedProcedure
		.route({
			method: "GET",
			path: "/resumes/{id}/statistics",
			tags: ["Resume Statistics"],
			operationId: "getResumeStatistics",
			summary: "Get resume statistics",
			description:
				"Returns view and download statistics for the specified resume, including total counts and the timestamps of the last view and download. Requires authentication.",
			successDescription: "The resume's view and download statistics.",
		})
		.input(z.object({ id: z.string().describe("The unique identifier of the resume.") }))
		.output(
			z.object({
				isPublic: z.boolean().describe("Whether the resume is currently public."),
				views: z.number().describe("Total number of times the resume has been viewed."),
				downloads: z.number().describe("Total number of times the resume has been downloaded."),
				lastViewedAt: z.date().nullable().describe("Timestamp of the last view, or null if never viewed."),
				lastDownloadedAt: z.date().nullable().describe("Timestamp of the last download, or null if never downloaded."),
			}),
		)
		.handler(async ({ context, input }) => {
			return await resumeService.statistics.getById({ id: input.id, userId: context.user.id });
		}),

	increment: publicProcedure
		.route({ tags: ["Internal"], operationId: "incrementResumeStatistics", summary: "Increment resume statistics" })
		.input(z.object({ id: z.string(), views: z.boolean().default(false), downloads: z.boolean().default(false) }))
		.handler(async ({ input }) => {
			return await resumeService.statistics.increment(input);
		}),
};

export const resumeRouter = {
	tags: tagsRouter,
	statistics: statisticsRouter,
	dashboard: dashboardRouter,

	list: protectedProcedure
		.route({
			method: "GET",
			path: "/resumes",
			tags: ["Resumes"],
			operationId: "listResumes",
			summary: "List all resumes",
			description:
				"Returns a list of all resumes belonging to the authenticated user. Results can be filtered by tags and sorted by last updated date, creation date, or name. Resume data is not included in the response for performance; use the get endpoint to fetch full resume data. Requires authentication.",
			successDescription: "A list of resumes with their metadata (without full resume data).",
		})
		.input(resumeDto.list.input.optional().default({ tags: [], sort: "lastUpdatedAt" }))
		.output(resumeDto.list.output)
		.handler(async ({ input, context }) => {
			return await resumeService.list({
				userId: context.user.id,
				tags: input.tags,
				sort: input.sort,
			});
		}),

	getById: protectedProcedure
		.route({
			method: "GET",
			path: "/resumes/{id}",
			tags: ["Resumes"],
			operationId: "getResume",
			summary: "Get resume by ID",
			description:
				"Returns a single resume with its full data, identified by its unique ID. Only resumes belonging to the authenticated user can be retrieved. Requires authentication.",
			successDescription: "The resume with its full data.",
		})
		.input(resumeDto.getById.input)
		.output(resumeDto.getById.output)
		.handler(async ({ context, input }) => {
			return await resumeService.getById({ id: input.id, userId: context.user.id });
		}),

	getByIdForPrinter: serverOnlyProcedure
		.route({ tags: ["Internal"], operationId: "getResumeForPrinter", summary: "Get resume by ID for printer" })
		.input(resumeDto.getById.input)
		.handler(async ({ input }) => {
			return await resumeService.getByIdForPrinter({ id: input.id });
		}),

	getBySlug: publicProcedure
		.route({
			method: "GET",
			path: "/resumes/{username}/{slug}",
			tags: ["Resume Sharing"],
			operationId: "getResumeBySlug",
			summary: "Get public resume by username and slug",
			description:
				"Returns a publicly shared resume identified by the owner's username and the resume's slug. If the resume is password-protected and the viewer has not yet verified the password, a 401 error with code NEED_PASSWORD is returned. No authentication required for public resumes; if authenticated as the owner, private resumes are also accessible.",
			successDescription: "The public resume with its full data.",
		})
		.input(resumeDto.getBySlug.input)
		.output(resumeDto.getBySlug.output)
		.handler(async ({ input, context }) => {
			return await resumeService.getBySlug({ ...input, currentUserId: context.user?.id });
		}),

	create: protectedProcedure
		.route({
			method: "POST",
			path: "/resumes",
			tags: ["Resumes"],
			operationId: "createResume",
			summary: "Create a new resume",
			description:
				"Creates a new resume with the given name, slug, and tags. Optionally initializes the resume with sample data by setting withSampleData to true. The slug must be unique across the user's resumes. Returns the ID of the newly created resume. Requires authentication.",
			successDescription: "The ID of the newly created resume.",
		})
		.input(resumeDto.create.input)
		.output(resumeDto.create.output)
		.errors({
			RESUME_SLUG_ALREADY_EXISTS: {
				message: "A resume with this slug already exists.",
				status: 400,
			},
		})
		.handler(async ({ context, input }) => {
			// Check RESUME_CREATE credit before allowing creation
			const creditCheck = await checkPlacementCredit(context.user.email, "RESUME_CREATE");
			if (!creditCheck.allowed) {
				throw new ORPCError("FORBIDDEN", {
					message: "No resume creation credits remaining. Purchase a placement package to continue.",
				});
			}

			let data = input.withSampleData ? sampleResumeData : undefined;

			// If the user wants to use their saved info, fetch it and optionally generate via AI
			if (input.useUserInfo) {
				const userInfo = await userInfoService.get({ userId: context.user.id });

				if (userInfo) {
					data = await resumeAiService.generateFromUserInfo({
						userInfo,
						jobDescription: input.jobDescription || "",
					});
				}
			}

			const result = await resumeService.create({
				name: input.name,
				slug: input.slug,
				tags: input.tags,
				locale: context.locale,
				userId: context.user.id,
				data,
			});

			// Consume credit after successful creation
			await consumePlacementCredit(context.user.email, "RESUME_CREATE");

			return result;
		}),

	import: protectedProcedure
		.route({
			method: "POST",
			path: "/resumes/import",
			tags: ["Resumes"],
			operationId: "importResume",
			summary: "Import a resume",
			description:
				"Creates a new resume from an existing ResumeData object (e.g. from a previously exported JSON file). A random name and slug are generated automatically. Returns the ID of the imported resume. Requires authentication.",
			successDescription: "The ID of the imported resume.",
		})
		.input(resumeDto.import.input)
		.output(resumeDto.import.output)
		.errors({
			RESUME_SLUG_ALREADY_EXISTS: {
				message: "A resume with this slug already exists.",
				status: 400,
			},
		})
		.handler(async ({ context, input }) => {
			// Check RESUME_CREATE credit before allowing import
			const creditCheck = await checkPlacementCredit(context.user.email, "RESUME_CREATE");
			if (!creditCheck.allowed) {
				throw new ORPCError("FORBIDDEN", {
					message: "No resume creation credits remaining. Purchase a placement package to continue.",
				});
			}

			const name = generateRandomName();
			const slug = slugify(name);

			const result = await resumeService.create({
				name,
				slug,
				tags: [],
				data: input.data,
				locale: context.locale,
				userId: context.user.id,
			});

			// Consume credit after successful import
			await consumePlacementCredit(context.user.email, "RESUME_CREATE");

			return result;
		}),

	update: protectedProcedure
		.route({
			method: "PUT",
			path: "/resumes/{id}",
			tags: ["Resumes"],
			operationId: "updateResume",
			summary: "Update a resume",
			description:
				"Updates one or more fields of a resume identified by its ID. All fields are optional; only provided fields will be updated. Locked resumes cannot be updated. Requires authentication.",
			successDescription: "The updated resume with its full data.",
		})
		.input(resumeDto.update.input)
		.output(resumeDto.update.output)
		.errors({
			RESUME_SLUG_ALREADY_EXISTS: {
				message: "A resume with this slug already exists.",
				status: 400,
			},
		})
		.handler(async ({ context, input }) => {
			return await resumeService.update({
				id: input.id,
				userId: context.user.id,
				name: input.name,
				slug: input.slug,
				tags: input.tags,
				data: input.data,
				isPublic: input.isPublic,
			});
		}),

	patch: protectedProcedure
		.route({
			method: "PATCH",
			path: "/resumes/{id}",
			tags: ["Resumes"],
			operationId: "patchResume",
			summary: "Patch resume data",
			description:
				"Applies JSON Patch (RFC 6902) operations to partially update a resume's data. This allows small, targeted changes (e.g. updating a single field) without sending the entire resume object. Locked resumes cannot be patched. Requires authentication.",
			successDescription: "The patched resume with its full data.",
		})
		.input(resumeDto.patch.input)
		.output(resumeDto.patch.output)
		.errors({
			INVALID_PATCH_OPERATIONS: {
				message: "The patch operations are invalid or produced an invalid resume.",
				status: 400,
			},
		})
		.handler(async ({ context, input }) => {
			return await resumeService.patch({
				id: input.id,
				userId: context.user.id,
				operations: input.operations,
			});
		}),

	setLocked: protectedProcedure
		.route({
			method: "POST",
			path: "/resumes/{id}/lock",
			tags: ["Resumes"],
			operationId: "setResumeLocked",
			summary: "Set resume lock status",
			description:
				"Toggles the locked status of a resume. When locked, a resume cannot be updated, patched, or deleted. Useful for protecting finalized resumes from accidental edits. Requires authentication.",
			successDescription: "The resume lock status was updated successfully.",
		})
		.input(resumeDto.setLocked.input)
		.output(resumeDto.setLocked.output)
		.handler(async ({ context, input }) => {
			return await resumeService.setLocked({
				id: input.id,
				userId: context.user.id,
				isLocked: input.isLocked,
			});
		}),

	setPassword: protectedProcedure
		.route({
			method: "PUT",
			path: "/resumes/{id}/password",
			tags: ["Resume Sharing"],
			operationId: "setResumePassword",
			summary: "Set resume password",
			description:
				"Sets or updates a password on a resume. When a password is set, viewers of the public resume must enter the password before the resume data is revealed. The password must be between 6 and 64 characters. Requires authentication.",
			successDescription: "The resume password was set successfully.",
		})
		.input(resumeDto.setPassword.input)
		.output(resumeDto.setPassword.output)
		.handler(async ({ context, input }) => {
			return await resumeService.setPassword({
				id: input.id,
				userId: context.user.id,
				password: input.password,
			});
		}),

	verifyPassword: publicProcedure
		.route({
			method: "POST",
			path: "/resumes/{username}/{slug}/password/verify",
			tags: ["Resume Sharing"],
			operationId: "verifyResumePassword",
			summary: "Verify resume password",
			description:
				"Verifies a password for a password-protected public resume. On success, the viewer is granted access to view the resume data for the duration of their session. No authentication required.",
			successDescription: "The password was verified successfully and access has been granted.",
		})
		.input(
			z.object({
				username: z.string().min(1).describe("The username of the resume owner."),
				slug: z.string().min(1).describe("The slug of the resume."),
				password: z.string().min(1).describe("The password to verify."),
			}),
		)
		.output(z.boolean())
		.handler(async ({ input }): Promise<boolean> => {
			return await resumeService.verifyPassword({
				username: input.username,
				slug: input.slug,
				password: input.password,
			});
		}),

	removePassword: protectedProcedure
		.route({
			method: "DELETE",
			path: "/resumes/{id}/password",
			tags: ["Resume Sharing"],
			operationId: "removeResumePassword",
			summary: "Remove resume password",
			description:
				"Removes password protection from a resume. After removal, the resume (if public) can be viewed without entering a password. Requires authentication.",
			successDescription: "The resume password was removed successfully.",
		})
		.input(resumeDto.removePassword.input)
		.output(resumeDto.removePassword.output)
		.handler(async ({ context, input }) => {
			return await resumeService.removePassword({
				id: input.id,
				userId: context.user.id,
			});
		}),

	duplicate: protectedProcedure
		.route({
			method: "POST",
			path: "/resumes/{id}/duplicate",
			tags: ["Resumes"],
			operationId: "duplicateResume",
			summary: "Duplicate a resume",
			description:
				"Creates a copy of an existing resume with the same data. Optionally override the name, slug, and tags for the duplicate. If not provided, the original resume's name, slug, and tags are used. Returns the ID of the duplicated resume. Requires authentication.",
			successDescription: "The ID of the duplicated resume.",
		})
		.input(resumeDto.duplicate.input)
		.output(resumeDto.duplicate.output)
		.handler(async ({ context, input }) => {
			// Check RESUME_CREATE credit before allowing duplicate
			const creditCheck = await checkPlacementCredit(context.user.email, "RESUME_CREATE");
			if (!creditCheck.allowed) {
				throw new ORPCError("FORBIDDEN", {
					message: "No resume creation credits remaining. Purchase a placement package to continue.",
				});
			}

			const original = await resumeService.getById({ id: input.id, userId: context.user.id });

			const result = await resumeService.create({
				userId: context.user.id,
				name: input.name ?? original.name,
				slug: input.slug ?? original.slug,
				tags: input.tags ?? original.tags,
				locale: context.locale,
				data: original.data,
			});

			// Consume credit after successful duplicate
			await consumePlacementCredit(context.user.email, "RESUME_CREATE");

			return result;
		}),

	delete: protectedProcedure
		.route({
			method: "DELETE",
			path: "/resumes/{id}",
			tags: ["Resumes"],
			operationId: "deleteResume",
			summary: "Delete a resume",
			description:
				"Permanently deletes a resume and its associated files (screenshots, PDFs) from storage. Locked resumes cannot be deleted; unlock the resume first. Requires authentication.",
			successDescription: "The resume and its associated files were deleted successfully.",
		})
		.input(resumeDto.delete.input)
		.output(resumeDto.delete.output)
		.handler(async ({ context, input }) => {
			return await resumeService.delete({ id: input.id, userId: context.user.id });
		}),

	setPrimary: protectedProcedure
		.route({
			method: "POST",
			path: "/resumes/{id}/primary",
			tags: ["Resumes"],
			operationId: "setResumePrimary",
			summary: "Set resume as primary (Master Resume)",
			description:
				"Sets the specified resume as the user's primary (Master) resume. Any existing primary resume for the user will be unset. Requires authentication.",
			successDescription: "The resume was set as primary successfully.",
		})
		.input(resumeDto.setPrimary.input)
		.output(resumeDto.setPrimary.output)
		.handler(async ({ context, input }) => {
			return await resumeService.setPrimary({ id: input.id, userId: context.user.id });
		}),

	// ─────────────────────────────────────────────────────────────────────────────
	// Resume Feedback Endpoints (Comments, Checklists, Evaluations)
	// ─────────────────────────────────────────────────────────────────────────────

	comments: {
		create: protectedProcedure
			.route({
				method: "POST",
				path: "/resumes/{resumeId}/comments",
				tags: ["Resume Feedback"],
				operationId: "createResumeComment",
				summary: "Add a comment to a resume",
				description: "Faculty or PO adds feedback comment on a student's resume.",
			})
			.input(
				z.object({
					resumeId: z.string().describe("Resume ID"),
					studentId: z.string().describe("eng-labs student ID"),
					tenantId: z.string().describe("eng-labs tenant ID"),
					parentId: z.string().uuid().optional().describe("Parent comment ID for replies"),
					content: z.string().min(1).max(5000).describe("Comment content"),
					scope: z.enum(["INDIVIDUAL", "SECTION"]).default("INDIVIDUAL").describe("Comment visibility scope"),
					anchor: commentAnchorSchema.optional().describe("Where on the resume the comment points"),
					severity: commentSeveritySchema.optional(),
					suggestion: z.string().min(1).max(2000).optional().describe("Replacement for the anchored quote"),
				}),
			)
			.output(commentOutputSchema)
			.handler(async ({ context, input }) => {
				const { createComment, getCommentById } = await import(
					"@/integrations/drizzle/services/resume-feedback.service"
				);

				await assertReviewStaff(context.user, input.resumeId);
				// A reply belongs to a thread on this same resume.
				if (input.parentId && (await getCommentById(input.parentId))?.resumeId !== input.resumeId) {
					throw new ORPCError("NOT_FOUND", { message: "Comment not found." });
				}
				const { id: authorId, tenantId } = await resolveEngLabsActor(context.user.email);

				// The student is emailed once per review (when the reviewer requests changes or verifies),
				// with every open comment listed — see dashboard.updateStatus — not once per comment.
				return await createComment({
					resumeId: input.resumeId,
					studentId: input.studentId,
					tenantId,
					authorId,
					parentId: input.parentId,
					content: input.content,
					scope: input.scope,
					anchor: input.anchor,
					severity: input.severity,
					suggestion: input.anchor?.quote ? input.suggestion : undefined,
				});
			}),

		createMany: protectedProcedure
			.route({
				method: "POST",
				path: "/resumes/{resumeId}/comments/batch",
				tags: ["Resume Feedback"],
				operationId: "createResumeComments",
				summary: "Add several comments to a resume",
				description:
					"Posts the standard feedback a reviewer ticked for a section as one comment each, in a single transaction.",
			})
			.input(
				z.object({
					resumeId: z.string().describe("Resume ID"),
					studentId: z.string().describe("eng-labs student ID"),
					tenantId: z.string().describe("eng-labs tenant ID"),
					comments: z
						.array(
							z.object({
								content: z.string().min(1).max(5000),
								anchor: commentAnchorSchema.optional(),
								severity: commentSeveritySchema.optional(),
								suggestion: z.string().min(1).max(2000).optional(),
							}),
						)
						.min(1)
						.max(20)
						.describe("The comments to post, each becoming its own thread"),
				}),
			)
			.output(z.array(commentOutputSchema))
			.handler(async ({ context, input }) => {
				const { createComments } = await import("@/integrations/drizzle/services/resume-feedback.service");

				await assertReviewStaff(context.user, input.resumeId);
				const { id: authorId, tenantId } = await resolveEngLabsActor(context.user.email);

				return await createComments(
					input.comments.map((comment) => ({
						resumeId: input.resumeId,
						studentId: input.studentId,
						tenantId,
						authorId,
						content: comment.content,
						anchor: comment.anchor,
						severity: comment.severity,
						suggestion: comment.anchor?.quote ? comment.suggestion : undefined,
					})),
				);
			}),

		delete: protectedProcedure
			.route({
				method: "DELETE",
				path: "/resumes/comments/{id}",
				tags: ["Resume Feedback"],
				operationId: "deleteResumeComment",
				summary: "Delete a comment",
				description:
					"Permanently removes a comment and any replies to it. Only the reviewer who wrote it can delete it.",
			})
			.input(z.object({ id: z.string() }))
			.handler(async ({ context, input }) => {
				const { deleteComment, getCommentById } = await import(
					"@/integrations/drizzle/services/resume-feedback.service"
				);

				const comment = await getCommentById(input.id);
				if (!comment) throw new ORPCError("NOT_FOUND", { message: "Comment not found." });

				// Staff of the student's tenant first — so a stranger cannot probe which ids exist — then the
				// author. Deleting feedback is the author's call alone: a Placement Officer outranks a faculty
				// member on a verdict, but not on whether their written feedback ever happened.
				await assertReviewStaff(context.user, comment.resumeId);
				const { id: actorId } = await resolveEngLabsActor(context.user.email);
				if (comment.authorId !== actorId) {
					throw new ORPCError("FORBIDDEN", { message: "Only the reviewer who wrote a comment can delete it." });
				}

				await deleteComment(input.id);
			}),

		list: protectedProcedure
			.route({
				method: "GET",
				path: "/resumes/{resumeId}/comments",
				tags: ["Resume Feedback"],
				operationId: "listResumeComments",
				summary: "List comments on a resume",
			})
			.input(z.object({ resumeId: z.string() }))
			.output(z.array(commentOutputSchema))
			.handler(async ({ context, input }) => {
				const { getCommentsByResumeId } = await import("@/integrations/drizzle/services/resume-feedback.service");
				await getReviewAccess(context.user, input.resumeId);
				return await getCommentsByResumeId(input.resumeId);
			}),

		updateStatus: protectedProcedure
			.route({
				method: "PATCH",
				path: "/resumes/comments/{id}/status",
				tags: ["Resume Feedback"],
				operationId: "updateCommentStatus",
				summary: "Update comment status",
			})
			.input(
				z.object({
					id: z.string(),
					status: z.enum(["OPEN", "ADDRESSED", "RESOLVED"]),
				}),
			)
			.handler(async ({ context, input }) => {
				const { getCommentById, updateCommentStatus } = await import(
					"@/integrations/drizzle/services/resume-feedback.service"
				);
				const comment = await getCommentById(input.id);
				if (!comment) throw new ORPCError("NOT_FOUND", { message: "Comment not found." });

				// Students can only flag their own feedback as addressed (or undo that); reviewers decide RESOLVED.
				const access = await getReviewAccess(context.user, comment.resumeId);
				if (access === "owner" && (input.status === "RESOLVED" || comment.status === "RESOLVED")) {
					throw new ORPCError("FORBIDDEN", { message: "Only reviewers can resolve or reopen feedback." });
				}

				return await updateCommentStatus(input.id, input.status);
			}),
	},

	// Comment bank shared by a tenant's reviewers. Reviewer-only; tenant comes from eng-labs, not the client.
	reviewSnippets: {
		list: protectedProcedure
			.route({ method: "GET", path: "/review-snippets", tags: ["Resume Feedback"], summary: "List the comment bank" })
			.output(z.array(z.object({ id: z.string(), content: z.string(), usageCount: z.number() })))
			.handler(async ({ context }) => {
				const { listSnippets } = await import("@/integrations/drizzle/services/resume-feedback.service");
				const { tenantId, organisationId } = await requireReviewerInOrg(context.user.email);
				return await listSnippets(tenantId, organisationId);
			}),

		create: protectedProcedure
			.route({ method: "POST", path: "/review-snippets", tags: ["Resume Feedback"], summary: "Save to comment bank" })
			.input(z.object({ content: z.string().trim().min(1).max(500) }))
			.handler(async ({ context, input }) => {
				const { createSnippet } = await import("@/integrations/drizzle/services/resume-feedback.service");
				const { id, tenantId, organisationId } = await requireReviewerInOrg(context.user.email);
				await createSnippet(tenantId, organisationId, id, input.content);
			}),

		delete: protectedProcedure
			.route({
				method: "DELETE",
				path: "/review-snippets/{id}",
				tags: ["Resume Feedback"],
				summary: "Remove from bank",
			})
			.input(z.object({ id: z.string() }))
			.handler(async ({ context, input }) => {
				const { deleteSnippet } = await import("@/integrations/drizzle/services/resume-feedback.service");
				const { tenantId } = await requireReviewer(context.user.email);
				await deleteSnippet(tenantId, input.id);
			}),

		use: protectedProcedure
			.route({ method: "POST", path: "/review-snippets/{id}/use", tags: ["Resume Feedback"], summary: "Count a use" })
			.input(z.object({ id: z.string() }))
			.handler(async ({ context, input }) => {
				const { useSnippet } = await import("@/integrations/drizzle/services/resume-feedback.service");
				const { tenantId } = await requireReviewer(context.user.email);
				await useSnippet(tenantId, input.id);
			}),
	},

	checklists: {
		create: protectedProcedure
			.route({
				method: "POST",
				path: "/resumes/checklists",
				tags: ["Resume Feedback"],
				operationId: "createChecklist",
				summary: "Create evaluation checklist",
				description: "Faculty creates a checklist for evaluating student resumes.",
			})
			.input(
				z.object({
					title: z.string().min(1).max(200),
					description: z.string().max(1000).optional(),
					courseId: z.string().optional(),
					tenantId: z.string().describe("eng-labs tenant ID"),
					items: z
						.array(
							z.object({
								title: z.string().min(1),
								description: z.string().optional(),
								weight: z.number().min(0).max(100).default(1.0),
								order: z.number().int().min(0).default(0),
							}),
						)
						.min(1),
				}),
			)
			.output(
				z.object({
					id: z.string(),
					title: z.string(),
					description: z.string().nullable(),
					facultyId: z.string(),
					tenantId: z.string(),
					courseId: z.string().nullable(),
					isActive: z.boolean(),
					createdAt: z.date(),
					updatedAt: z.date(),
				}),
			)
			.handler(async ({ context, input }) => {
				const { createChecklist } = await import("@/integrations/drizzle/services/resume-feedback.service");

				// Reviewers only: a student's checklist could be used to score their own resume.
				const { id: facultyId, tenantId } = await requireReviewer(context.user.email);

				const checklist = await createChecklist({
					facultyId,
					tenantId,
					courseId: input.courseId,
					title: input.title,
					description: input.description,
					items: input.items,
				});

				return checklist;
			}),

		list: protectedProcedure
			.route({
				method: "GET",
				path: "/resumes/checklists",
				tags: ["Resume Feedback"],
				operationId: "listChecklists",
				summary: "List evaluation checklists",
			})
			.input(
				z.object({
					courseId: z.string().optional(),
					tenantId: z.string().optional(),
					studentId: z.string().optional(),
				}),
			)
			.output(z.array(z.object({ id: z.string(), title: z.string() })))
			.handler(async ({ context, input }) => {
				const { listChecklists } = await import("@/integrations/drizzle/services/resume-feedback.service");
				const { getEngLabsUserByEmail, getStudentById, getUnitAncestors, getInstructorsForUnits } = await import(
					"@/integrations/eng-labs"
				);

				// Server-resolved tenant overrides client input — `input.tenantId` from localStorage SSO can drift.
				const engUser = await getEngLabsUserByEmail(context.user.email);
				const tenantId = engUser?.tenantId ?? input.tenantId ?? "";

				let facultyIds: string[] | undefined;

				if (input.studentId) {
					const student = await getStudentById(input.studentId);
					if (student?.sectionId) {
						const unitIds = await getUnitAncestors(student.sectionId);
						facultyIds = await getInstructorsForUnits(unitIds);
					}
				}

				const checklists = await listChecklists({
					courseId: input.courseId,
					tenantId,
					facultyIds,
				});

				return checklists;
			}),

		get: protectedProcedure
			.route({
				method: "GET",
				path: "/resumes/checklists/{checklistId}",
				tags: ["Resume Feedback"],
				operationId: "getChecklist",
				summary: "Get a checklist with its items",
			})
			.input(z.object({ checklistId: z.string() }))
			.handler(async ({ input }) => {
				const { getChecklistById } = await import("@/integrations/drizzle/services/resume-feedback.service");
				return await getChecklistById(input.checklistId);
			}),
	},

	evaluations: {
		create: protectedProcedure
			.route({
				method: "POST",
				path: "/resumes/{resumeId}/evaluate",
				tags: ["Resume Feedback"],
				operationId: "createEvaluation",
				summary: "Evaluate a resume",
				description: "Faculty or system evaluates resume against a checklist.",
			})
			.input(
				z.object({
					resumeId: z.string(),
					studentId: z.string(),
					checklistId: z.string(),
					tenantId: z.string(),
					isAutoGenerated: z.boolean().default(false),
					items: z
						.array(
							z.object({
								checklistItemId: z.string(),
								passed: z.boolean(),
								notes: z.string().optional(),
								score: z.number().optional(),
							}),
						)
						.min(1),
				}),
			)
			.output(
				z.object({
					id: z.string(),
					resumeId: z.string(),
					overallScore: z.number().nullable(),
					isAutoGenerated: z.boolean(),
					snapshot: z.any().nullable(),
					evaluatedAt: z.date(),
				}),
			)
			.handler(async ({ context, input }) => {
				const { createEvaluation } = await import("@/integrations/drizzle/services/resume-feedback.service");

				// Staff of the student's tenant only, never the owner: the score shows on staff dashboards.
				await assertReviewStaff(context.user, input.resumeId);
				const { id: evaluatedBy, tenantId } = await resolveEngLabsActor(context.user.email);

				const evaluation = await createEvaluation({
					resumeId: input.resumeId,
					studentId: input.studentId,
					tenantId,
					checklistId: input.checklistId,
					evaluatedBy,
					isAutoGenerated: input.isAutoGenerated,
					items: input.items,
				});

				return evaluation;
			}),

		list: protectedProcedure
			.route({
				method: "GET",
				path: "/resumes/{resumeId}/evaluations",
				tags: ["Resume Feedback"],
				operationId: "listEvaluations",
				summary: "List evaluations for a resume",
			})
			.input(z.object({ resumeId: z.string() }))
			.output(
				z.array(
					z.object({
						id: z.string(),
						resumeId: z.string(),
						overallScore: z.number().nullable(),
						snapshot: z.any().nullable(),
						evaluatedAt: z.date(),
					}),
				),
			)
			.handler(async ({ context, input }) => {
				const { getEvaluationsByResumeId } = await import("@/integrations/drizzle/services/resume-feedback.service");
				// Each evaluation keeps a full copy of the resume: owner or reviewers only.
				await getReviewAccess(context.user, input.resumeId);
				return await getEvaluationsByResumeId(input.resumeId);
			}),
	},
};
