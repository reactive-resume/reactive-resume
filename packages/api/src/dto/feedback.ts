import z from "zod";
import { applicationClosedReasonSchema, applicationStatusSchema } from "@reactive-resume/schema/applications/data";
import { resumeDataSchema } from "@reactive-resume/schema/resume/data";

/** Most applications one link can share, and most comments one link takes. */
export const FEEDBACK_MAX_APPLICATIONS = 20;
export const FEEDBACK_MAX_COMMENTS = 200;

const linkId = z.string().min(1).describe("The ID of the feedback link.");
const token = z.string().min(1).max(200).describe("The secret part of the feedback link, after /feedback/.");

const feedbackLinkStatusSchema = z
	.enum(["active", "expired", "revoked"])
	.describe("Whether the link opens: active, past its expiry, or turned off by the owner.");

const feedbackLinkSchema = z.object({
	id: z.string(),
	resumeId: z.string(),
	resumeName: z.string().describe("The resume's name when the link was made."),
	label: z.string().describe("Who the link is for, in the owner's words. Only the owner sees it."),
	url: z.string().describe("The link to send. Anyone with it can open what it shares until it expires or is revoked."),
	status: feedbackLinkStatusSchema,
	allowComments: z.boolean(),
	applicationIds: z.array(z.string()).describe("Applications whose stage and dates the reviewer can follow."),
	expiresAt: z.date().nullable(),
	revokedAt: z.date().nullable(),
	lastViewedAt: z.date().nullable(),
	createdAt: z.date().describe("When the link was made, which is also when its resume version was saved."),
	commentCount: z.number().int(),
	openCommentCount: z.number().int().describe("Comments the owner hasn't marked done."),
});

const feedbackCommentSchema = z.object({
	id: z.string(),
	linkId: z.string(),
	authorName: z.string().describe("The name the reviewer gave. It isn't verified."),
	body: z.string(),
	resolvedAt: z.date().nullable(),
	createdAt: z.date(),
});

const feedbackEventSchema = z.object({
	id: z.string(),
	type: z.enum(["created", "viewed", "commented", "revoked"]),
	createdAt: z.date(),
});

/** What a reviewer sees of an application: its stage and dates, nothing else. */
const feedbackApplicationSchema = z.object({
	company: z.string(),
	role: z.string(),
	status: applicationStatusSchema,
	stageLabel: z.string().nullable().describe("The owner's name for the stage, or null for the default name."),
	closedReason: applicationClosedReasonSchema.nullable(),
	appliedAt: z.date().nullable().describe("When the application was sent, or null while it's saved."),
	stages: z
		.array(
			z.object({
				status: applicationStatusSchema,
				stageLabel: z.string().nullable(),
				at: z.date().describe("When it reached this stage."),
				dateUnknown: z.boolean(),
			}),
		)
		.describe("Stage changes, oldest first."),
});

export const feedbackDto = {
	list: {
		input: z.object({ resumeId: z.string().optional().describe("Only this resume's links.") }).optional(),
		output: z.array(feedbackLinkSchema),
	},
	create: {
		input: z.object({
			resumeId: z.string().min(1).describe("The resume to share. Its current content is saved with the link."),
			label: z.string().trim().min(1).max(80).describe("Who the link is for, such as a coach's name."),
			allowComments: z.boolean().default(true).describe("Whether the reviewer can leave comments."),
			applicationIds: z
				.array(z.string().min(1))
				.max(FEEDBACK_MAX_APPLICATIONS)
				.default([])
				.describe(
					"Applications whose stage and dates the reviewer can follow. Notes, contacts and salary stay private.",
				),
			expiresAt: z.coerce.date().nullable().default(null).describe("When the link stops working; null for no expiry."),
		}),
		output: feedbackLinkSchema,
	},
	get: {
		input: z.object({ id: linkId }),
		output: feedbackLinkSchema.extend({
			comments: z.array(feedbackCommentSchema).describe("Oldest first."),
			events: z.array(feedbackEventSchema).describe("Newest first; views are kept at most once an hour."),
		}),
	},
	revoke: {
		input: z.object({ id: linkId }),
		output: feedbackLinkSchema,
	},
	resolveComment: {
		input: z.object({
			id: linkId,
			commentId: z.string().min(1).describe("The ID of the comment."),
			resolved: z.boolean().describe("True to mark the comment done, false to reopen it."),
		}),
		output: feedbackCommentSchema,
	},
	view: {
		input: z.object({ token }),
		output: z.object({
			resumeName: z.string(),
			ownerName: z.string(),
			sharedAt: z.date().describe("When the owner saved this version for feedback."),
			data: resumeDataSchema.describe(
				"The resume as it was when the link was made, without the owner's private notes.",
			),
			allowComments: z.boolean(),
			expiresAt: z.date().nullable(),
			applications: z.array(feedbackApplicationSchema),
			comments: z.array(feedbackCommentSchema.omit({ resolvedAt: true })).describe("Comments left through this link."),
		}),
	},
	comment: {
		input: z.object({
			token,
			authorName: z.string().trim().min(1).max(80).describe("Your name, so the owner knows who wrote it."),
			body: z.string().trim().min(1).max(4000),
		}),
		output: feedbackCommentSchema.omit({ resolvedAt: true }),
	},
};
