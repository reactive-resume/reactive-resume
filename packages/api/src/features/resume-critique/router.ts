import { protectedProcedure, publicProcedure } from "../../context";
import { resumeCritiqueDto } from "../../dto/resume-critique";
import { critiquePasswordRateLimit, resumeMutationRateLimit } from "../../middleware/rate-limit";
import { resumeCritiqueService } from "./service";

export const resumeCritiqueRouter = {
	setEnabled: protectedProcedure
		.route({
			method: "PUT",
			path: "/resumes/{id}/critique",
			tags: ["Resume Critique"],
			operationId: "setResumeCritiqueEnabled",
			summary: "Enable or disable feedback/critique mode",
			description:
				"Turns feedback/critique mode on or off for a resume. Requires the resume's public access to already be enabled; turning public access off elsewhere also turns this off. Requires authentication.",
			successDescription: "The resume's feedback/critique mode was updated successfully.",
		})
		.input(resumeCritiqueDto.setEnabled.input)
		.use(resumeMutationRateLimit)
		.output(resumeCritiqueDto.setEnabled.output)
		.handler(({ context, input }) =>
			resumeCritiqueService.setEnabled({
				id: input.id,
				userId: context.user.id,
				critiqueEnabled: input.critiqueEnabled,
			}),
		),

	setPassword: protectedProcedure
		.route({
			method: "PUT",
			path: "/resumes/{id}/critique/password",
			tags: ["Resume Critique"],
			operationId: "setResumeCritiquePassword",
			summary: "Set the feedback/critique link password",
			description:
				"Sets or rotates the password critiquers must enter to leave feedback on the resume. Rotating the password invalidates every previously issued critiquer identity cookie. Requires authentication.",
			successDescription: "The critique password was set successfully.",
		})
		.input(resumeCritiqueDto.setPassword.input)
		.use(resumeMutationRateLimit)
		.output(resumeCritiqueDto.setPassword.output)
		.handler(({ context, input }) =>
			resumeCritiqueService.setPassword({ id: input.id, userId: context.user.id, password: input.password }),
		),

	verify: publicProcedure
		.route({
			method: "POST",
			path: "/resumes/{username}/{slug}/critique/verify",
			tags: ["Resume Critique"],
			operationId: "verifyResumeCritiqueAccess",
			summary: "Verify feedback/critique link access",
			description:
				"Verifies the critique password for a resume's feedback link. A display name is required the first time a browser critiques a given resume; on later visits the browser's existing identity cookie is recognized and the display name is ignored. No authentication required.",
			successDescription: "Access was granted and a critiquer identity cookie was issued.",
		})
		.input(resumeCritiqueDto.verify.input)
		.use(critiquePasswordRateLimit)
		.output(resumeCritiqueDto.verify.output)
		.handler(({ context, input }) =>
			resumeCritiqueService.verify({
				username: input.username,
				slug: input.slug,
				password: input.password,
				...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
				requestHeaders: context.reqHeaders,
				...(context.resHeaders ? { responseHeaders: context.resHeaders } : {}),
			}),
		),

	getCritiqueView: publicProcedure
		.route({
			method: "GET",
			path: "/resumes/{username}/{slug}/critique",
			tags: ["Resume Critique"],
			operationId: "getResumeCritiqueView",
			summary: "Get resume for critique, with the caller's own comments",
			description:
				"Returns a resume's feedback view: its data plus only the calling critiquer's own comments (never another critiquer's). Requires a valid critiquer identity cookie from /critique/verify; otherwise returns a 401 with code NEED_PASSWORD.",
			successDescription: "The resume data and the calling critiquer's own comments.",
		})
		.input(resumeCritiqueDto.getCritiqueView.input)
		.output(resumeCritiqueDto.getCritiqueView.output)
		.handler(({ context, input }) =>
			resumeCritiqueService.getCritiqueView({
				username: input.username,
				slug: input.slug,
				requestHeaders: context.reqHeaders,
			}),
		),

	addComment: publicProcedure
		.route({
			method: "POST",
			path: "/resumes/{username}/{slug}/critique/comments",
			tags: ["Resume Critique"],
			operationId: "addResumeCritiqueComment",
			summary: "Add a feedback comment",
			description:
				"Pins a new comment to an exact point on a resume's rendered PDF. Requires a critiquer identity cookie.",
			successDescription: "The newly created comment.",
		})
		.input(resumeCritiqueDto.addComment.input)
		.use(resumeMutationRateLimit)
		.output(resumeCritiqueDto.addComment.output)
		.handler(({ context, input }) =>
			resumeCritiqueService.addComment({
				username: input.username,
				slug: input.slug,
				requestHeaders: context.reqHeaders,
				pageNumber: input.pageNumber,
				xNormalized: input.xNormalized,
				yNormalized: input.yNormalized,
				body: input.body,
			}),
		),

	updateOwnComment: publicProcedure
		.route({
			method: "PUT",
			path: "/resumes/{username}/{slug}/critique/comments/{commentId}",
			tags: ["Resume Critique"],
			operationId: "updateResumeCritiqueComment",
			summary: "Edit your own feedback comment",
			description:
				"Edits the text of one of the calling critiquer's own comments, only while it is still pending (not yet resolved or dismissed by the owner).",
			successDescription: "The updated comment.",
		})
		.input(resumeCritiqueDto.updateOwnComment.input)
		.use(resumeMutationRateLimit)
		.output(resumeCritiqueDto.updateOwnComment.output)
		.handler(({ context, input }) =>
			resumeCritiqueService.updateOwnComment({
				username: input.username,
				slug: input.slug,
				requestHeaders: context.reqHeaders,
				commentId: input.commentId,
				body: input.body,
			}),
		),

	deleteOwnComment: publicProcedure
		.route({
			method: "DELETE",
			path: "/resumes/{username}/{slug}/critique/comments/{commentId}",
			tags: ["Resume Critique"],
			operationId: "deleteResumeCritiqueComment",
			summary: "Delete your own feedback comment",
			description:
				"Deletes one of the calling critiquer's own comments, only while it is still pending (not yet resolved or dismissed by the owner).",
			successDescription: "The comment was deleted successfully.",
		})
		.input(resumeCritiqueDto.deleteOwnComment.input)
		.use(resumeMutationRateLimit)
		.output(resumeCritiqueDto.deleteOwnComment.output)
		.handler(({ context, input }) =>
			resumeCritiqueService.deleteOwnComment({
				username: input.username,
				slug: input.slug,
				requestHeaders: context.reqHeaders,
				commentId: input.commentId,
			}),
		),

	listAllComments: protectedProcedure
		.route({
			method: "GET",
			path: "/resumes/{resumeId}/critique/comments",
			tags: ["Resume Critique"],
			operationId: "listResumeCritiqueComments",
			summary: "List all feedback comments",
			description:
				"Returns every critique comment on a resume the caller owns, from every critiquer, each labeled with the commenting critiquer's display name. Requires authentication.",
			successDescription: "All critique comments on the resume.",
		})
		.input(resumeCritiqueDto.listAllComments.input)
		.output(resumeCritiqueDto.listAllComments.output)
		.handler(({ context, input }) =>
			resumeCritiqueService.listAllComments({ resumeId: input.resumeId, userId: context.user.id }),
		),

	updateCommentStatus: protectedProcedure
		.route({
			method: "PUT",
			path: "/resumes/{resumeId}/critique/comments/{commentId}/status",
			tags: ["Resume Critique"],
			operationId: "updateResumeCritiqueCommentStatus",
			summary: "Resolve, dismiss, or reopen a feedback comment",
			description:
				"Updates the status of a critique comment on a resume the caller owns: mark it resolved (implemented), dismissed (rejected), or reopen it to pending. Requires authentication.",
			successDescription: "The updated comment.",
		})
		.input(resumeCritiqueDto.updateCommentStatus.input)
		.use(resumeMutationRateLimit)
		.output(resumeCritiqueDto.updateCommentStatus.output)
		.handler(({ context, input }) =>
			resumeCritiqueService.updateCommentStatus({
				resumeId: input.resumeId,
				userId: context.user.id,
				commentId: input.commentId,
				status: input.status,
			}),
		),
};
