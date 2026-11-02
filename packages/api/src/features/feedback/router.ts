import { protectedProcedure, publicProcedure } from "../../context";
import { feedbackDto } from "../../dto/feedback";
import { feedbackCommentRateLimit, feedbackViewRateLimit, resumeMutationRateLimit } from "../../middleware/rate-limit";
import { ownerViewer } from "../resume/sharing";
import { feedbackService } from "./service";

const TAG = "Feedback Links";

export const feedbackRouter = {
	list: protectedProcedure
		.route({
			method: "GET",
			path: "/feedback-links",
			tags: [TAG],
			operationId: "listFeedbackLinks",
			summary: "List feedback links",
			description:
				"Returns the account's feedback links, newest first, with who each is for, whether it still opens, and how many comments it has. Requires authentication.",
			successDescription: "Up to 200 feedback links, newest first.",
		})
		.input(feedbackDto.list.input)
		.output(feedbackDto.list.output)
		.handler(({ context, input }) => feedbackService.list({ userId: context.user.id, resumeId: input?.resumeId })),

	create: protectedProcedure
		.route({
			method: "POST",
			path: "/feedback-links",
			tags: [TAG],
			operationId: "createFeedbackLink",
			summary: "Create a feedback link",
			description:
				"Saves the resume as it is now and returns a link to it for one reviewer, such as a coach. The reviewer sees that version only, without private notes or hidden items, and, if chosen, the stage and dates of the listed applications. Comments never change the resume. Requires authentication and resume ownership.",
			successDescription: "The new feedback link, with the URL to send.",
		})
		.input(feedbackDto.create.input)
		.use(resumeMutationRateLimit)
		.output(feedbackDto.create.output)
		.handler(({ context, input }) => feedbackService.create({ ...input, userId: context.user.id })),

	get: protectedProcedure
		.route({
			method: "GET",
			path: "/feedback-links/{id}",
			tags: [TAG],
			operationId: "getFeedbackLink",
			summary: "Get a feedback link",
			description:
				"Returns one feedback link with its comments and activity: when it was made, viewed, commented on and revoked. Requires authentication and link ownership.",
			successDescription: "The feedback link with its comments and activity.",
		})
		.input(feedbackDto.get.input)
		.output(feedbackDto.get.output)
		.handler(({ context, input }) => feedbackService.get({ id: input.id, userId: context.user.id })),

	revoke: protectedProcedure
		.route({
			method: "POST",
			path: "/feedback-links/{id}/revoke",
			tags: [TAG],
			operationId: "revokeFeedbackLink",
			summary: "Revoke a feedback link",
			description:
				"Turns the link off at once: it no longer opens or takes comments. Comments already left are kept. Revoking can't be undone; make a new link instead. Requires authentication and link ownership.",
			successDescription: "The revoked feedback link.",
		})
		.input(feedbackDto.revoke.input)
		.use(resumeMutationRateLimit)
		.output(feedbackDto.revoke.output)
		.handler(({ context, input }) => feedbackService.revoke({ id: input.id, userId: context.user.id })),

	resolveComment: protectedProcedure
		.route({
			method: "PATCH",
			path: "/feedback-links/{id}/comments/{commentId}",
			tags: [TAG],
			operationId: "resolveFeedbackComment",
			summary: "Mark a feedback comment done",
			description:
				"Marks a reviewer's comment done, or reopens it. Only the owner sees this. Requires authentication and link ownership.",
			successDescription: "The updated comment.",
		})
		.input(feedbackDto.resolveComment.input)
		.use(resumeMutationRateLimit)
		.output(feedbackDto.resolveComment.output)
		.handler(({ context, input }) => feedbackService.resolveComment({ ...input, userId: context.user.id })),

	view: publicProcedure
		.route({
			method: "GET",
			path: "/feedback/{token}",
			tags: [TAG],
			operationId: "viewFeedbackLink",
			summary: "Open a feedback link",
			description:
				"Returns what a feedback link shares: the resume version saved with it, the shared applications' stages and dates, and the comments left through it. A revoked or expired link returns 404 with reason `revoked` or `expired`. No authentication required.",
			successDescription: "What the link shares.",
		})
		.input(feedbackDto.view.input)
		.use(feedbackViewRateLimit)
		.output(feedbackDto.view.output)
		.handler(({ context, input }) =>
			feedbackService.view({ token: input.token, viewerId: ownerViewer(context).currentUserId }),
		),

	comment: publicProcedure
		.route({
			method: "POST",
			path: "/feedback/{token}/comments",
			tags: [TAG],
			operationId: "commentOnFeedbackLink",
			summary: "Comment through a feedback link",
			description:
				"Leaves a comment for the resume's owner. It doesn't change the resume. Read-only links return 403 with reason `read-only`. No authentication required.",
			successDescription: "The comment.",
		})
		.input(feedbackDto.comment.input)
		.use(feedbackCommentRateLimit)
		.output(feedbackDto.comment.output)
		.handler(({ input }) => feedbackService.comment(input)),
};
