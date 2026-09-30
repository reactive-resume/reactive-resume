import { createSelectSchema } from "drizzle-zod";
import z from "zod";
import * as schema from "@reactive-resume/db/schema";
import { critiqueCommentStatusSchema } from "@reactive-resume/schema/resume/critique";
import { resumeDataSchema } from "@reactive-resume/schema/resume/data";

const critiqueCommentSchema = createSelectSchema(schema.resumeCritiqueComment, {
	id: z.string().describe("The ID of the comment."),
	resumeId: z.string().describe("The ID of the resume the comment is on."),
	critiquerId: z.string().describe("The ID of the critiquer who left the comment."),
	resumeOwnerUserId: z.string(),
	pageNumber: z.number().int().min(1).describe("The 1-indexed PDF page number the comment is pinned to."),
	xNormalized: z.number().min(0).max(1).describe("Horizontal pin position, 0-1 relative to the page width."),
	yNormalized: z.number().min(0).max(1).describe("Vertical pin position, 0-1 relative to the page height."),
	body: z.string().trim().min(1).max(2000).describe("The comment text."),
	status: critiqueCommentStatusSchema.describe("Whether the owner has resolved or dismissed this comment."),
	createdAt: z.date().describe("The date and time the comment was created."),
	updatedAt: z.date().describe("The date and time the comment was last updated."),
});

// A critiquer never needs to see the denormalized owner id or whose id they are (they already
// know); this is what both the critiquer-facing view and the critiquer-facing mutations return.
const ownCommentSchema = critiqueCommentSchema.omit({ resumeOwnerUserId: true, critiquerId: true });

export const resumeCritiqueDto = {
	setEnabled: {
		input: z.object({
			id: z.string().describe("The ID of the resume."),
			critiqueEnabled: z.boolean().describe("Whether feedback/critique mode should be enabled."),
		}),
		output: z.object({ critiqueEnabled: z.boolean() }),
	},

	setPassword: {
		input: z.object({
			id: z.string().describe("The ID of the resume."),
			password: z.string().min(6).max(64).describe("The critique-link password to give to critiquers."),
		}),
		output: z.void(),
	},

	verify: {
		input: z.object({
			username: z.string().min(1).describe("The username of the resume owner."),
			slug: z.string().min(1).describe("The slug of the resume."),
			password: z.string().min(1).describe("The critique password to verify."),
			displayName: z
				.string()
				.trim()
				.min(1)
				.max(80)
				.optional()
				.describe("The critiquer's display name. Required the first time this browser critiques this resume."),
		}),
		output: z.object({
			critiquerId: z.string(),
			displayName: z.string().describe("The critiquer's display name (their own, if returning)."),
		}),
	},

	getCritiqueView: {
		input: z.object({ username: z.string(), slug: z.string() }),
		output: z.object({
			resumeId: z.string(),
			name: z.string(),
			data: resumeDataSchema,
			critiquerId: z.string(),
			displayName: z.string(),
			comments: z.array(ownCommentSchema),
		}),
	},

	addComment: {
		input: z.object({
			username: z.string(),
			slug: z.string(),
			pageNumber: z.number().int().min(1),
			xNormalized: z.number().min(0).max(1),
			yNormalized: z.number().min(0).max(1),
			body: z.string().trim().min(1).max(2000),
		}),
		output: ownCommentSchema,
	},

	updateOwnComment: {
		input: z.object({
			username: z.string(),
			slug: z.string(),
			commentId: z.string(),
			body: z.string().trim().min(1).max(2000),
		}),
		output: ownCommentSchema,
	},

	deleteOwnComment: {
		input: z.object({ username: z.string(), slug: z.string(), commentId: z.string() }),
		output: z.void(),
	},

	listAllComments: {
		input: z.object({ resumeId: z.string() }),
		output: z.array(
			critiqueCommentSchema
				.omit({ resumeOwnerUserId: true })
				.extend({ critiquerDisplayName: z.string().describe("The commenting critiquer's display name.") }),
		),
	},

	updateCommentStatus: {
		input: z.object({
			resumeId: z.string(),
			commentId: z.string(),
			status: critiqueCommentStatusSchema,
		}),
		output: critiqueCommentSchema.omit({ resumeOwnerUserId: true }),
	},
};
