import z from "zod";
import {
	careerFactInputSchema,
	careerOfferInputSchema,
	careerProfileDataSchema,
	careerScheduleInputSchema,
	careerScopeSchema,
	careerStoryInputSchema,
	careerWorkspaceSchema,
	generateTaskSchema,
	roleSuggestionsInputSchema,
	roleSuggestionsOutputSchema,
	offerTermsSchema,
} from "@reactive-resume/schema/career";
import { protectedProcedure } from "../../context";
import { savedStagesSchema } from "../../dto/application";
import {
	careerFactSchema,
	careerNotificationSchema,
	careerOpportunitySchema,
	careerScheduleSchema,
	careerStorySchema,
	savedItemSchema,
} from "../../dto/career";
import { aiRequestRateLimit } from "../../middleware/rate-limit";
import { searchScope } from "../web-access/regions";
import { answerRouter } from "./answer-router";
import { generateCareer } from "./generate";
import { careerJobs } from "./jobs";
import { suggestTargetRoles } from "./role-suggestions";
import { careerService, hasFitEvidence } from "./service";
import { careerVoiceRouter } from "./voice";

const id = z.object({ id: z.string().min(1) });
const applicationInput = z.object({ applicationId: z.string().min(1) });
const savedItemOutput = savedItemSchema.extend({
	application: z
		.object({
			company: z.string(),
			role: z.string(),
			status: z.string().nullable().optional(),
			closedReason: z.string().nullable().optional(),
		})
		.nullable(),
	outdated: z.boolean(),
	submission: z
		.boolean()
		.optional()
		.describe("Answers recorded at submission, separate from generated or current drafts."),
});

export const careerRouter = {
	suggestTargetRoles: protectedProcedure
		.use(aiRequestRateLimit)
		.route({
			method: "POST",
			path: "/career/target-roles/suggest",
			tags: ["Career"],
			operationId: "suggestCareerTargetRoles",
			summary: "Suggest editable target roles",
			description:
				"Sends only the explicitly selected owned resume and opted-in active shared Knowledge to the selected tested AI provider. Requires recipientVersion from the disclosed aiProviders.list configuration; changed settings return CONFLICT before sending. Returns unsaved suggestions with source quotes for user review. Does not search, schedule, save evidence or apply.",
		})
		.input(roleSuggestionsInputSchema)
		.output(roleSuggestionsOutputSchema)
		.handler(({ context, input, signal }) => suggestTargetRoles(context.user.id, input, signal)),
	answers: answerRouter,
	voice: careerVoiceRouter,
	schedules: protectedProcedure
		.route({
			method: "GET",
			path: "/career/schedules",
			tags: ["Career"],
			operationId: "listCareerSchedules",
			summary: "List career schedules",
		})
		.input(z.object({}))
		.output(z.array(careerScheduleSchema))
		.handler(({ context }) => careerJobs.list(context.user.id)),
	saveSchedule: protectedProcedure
		.route({
			method: "POST",
			path: "/career/schedules",
			tags: ["Career"],
			operationId: "saveCareerSchedule",
			summary: "Save a career schedule",
		})
		.input(careerScheduleInputSchema.extend({ id: z.string().optional() }))
		.output(careerScheduleSchema)
		.handler(async ({ context, input }) => {
			if (input.kind === "discovery" && input.enabled)
				await searchScope(context.user.id, context.reqHeaders.get("x-client-timezone") ?? undefined);
			return careerJobs.save(context.user.id, input);
		}),
	deleteSchedule: protectedProcedure
		.route({
			method: "DELETE",
			path: "/career/schedules/{id}",
			tags: ["Career"],
			operationId: "deleteCareerSchedule",
			summary: "Delete a career schedule",
		})
		.input(id)
		.output(z.void())
		.handler(({ context, input }) => careerJobs.delete(context.user.id, input.id)),
	notifications: protectedProcedure
		.route({
			method: "GET",
			path: "/career/notifications",
			tags: ["Career"],
			operationId: "listCareerNotifications",
			summary: "List career notifications",
		})
		.input(z.object({}))
		.output(z.array(careerNotificationSchema))
		.handler(({ context }) => careerJobs.notifications(context.user.id)),
	markNotificationRead: protectedProcedure
		.route({
			method: "POST",
			path: "/career/notifications/{id}/read",
			tags: ["Career"],
			operationId: "readCareerNotification",
			summary: "Mark a career notification as read",
		})
		.input(id)
		.output(z.void())
		.handler(({ context, input }) => careerJobs.markRead(context.user.id, input.id)),
	opportunities: protectedProcedure
		.route({
			method: "GET",
			path: "/career/opportunities",
			tags: ["Career"],
			operationId: "listCareerOpportunities",
			summary: "List discovered opportunities",
		})
		.input(z.object({}))
		.output(z.array(careerOpportunitySchema))
		.handler(({ context }) => careerJobs.opportunities(context.user.id)),
	dismissOpportunity: protectedProcedure
		.route({
			method: "DELETE",
			path: "/career/opportunities/{id}",
			tags: ["Career"],
			operationId: "dismissCareerOpportunity",
			summary: "Dismiss a discovered opportunity",
		})
		.input(id)
		.output(z.void())
		.handler(({ context, input }) => careerJobs.dismissOpportunity(context.user.id, input.id)),
	trackOpportunity: protectedProcedure
		.route({
			method: "POST",
			path: "/career/opportunities/{id}/track",
			tags: ["Career"],
			operationId: "trackCareerOpportunity",
			summary: "Track a discovered opportunity",
			description: "Creates an application at Saved with the posting link, summary and the preferences it matched.",
		})
		.input(id)
		.output(applicationInput)
		.handler(({ context, input }) => careerService.trackOpportunity(context.user.id, input.id)),
	profile: protectedProcedure
		.route({
			method: "GET",
			path: "/career/profile",
			tags: ["Career"],
			operationId: "getCareerProfile",
			summary: "Get career preferences",
		})
		.input(z.object({}).optional())
		.output(careerProfileDataSchema)
		.handler(({ context }) => careerService.profile(context.user.id)),
	saveProfile: protectedProcedure
		.route({
			method: "PUT",
			path: "/career/profile",
			tags: ["Career"],
			operationId: "saveCareerProfile",
			summary: "Save career preferences",
		})
		.input(careerProfileDataSchema)
		.output(careerProfileDataSchema)
		.handler(({ context, input }) => careerService.saveProfile(context.user.id, input)),
	facts: protectedProcedure
		.route({
			method: "GET",
			path: "/career/facts",
			tags: ["Career"],
			operationId: "listCareerFacts",
			summary: "List career facts",
		})
		.input(
			careerScopeSchema.extend({
				query: z.string().max(500).optional(),
				all: z.boolean().optional().describe("Every fact, shared and private to any application."),
			}),
		)
		.output(z.array(careerFactSchema))
		.handler(({ context, input }) => careerService.facts({ userId: context.user.id, ...input })),
	saveFact: protectedProcedure
		.route({
			method: "POST",
			path: "/career/facts",
			tags: ["Career"],
			operationId: "saveCareerFact",
			summary: "Save a career fact",
		})
		.input(careerFactInputSchema)
		.output(careerFactSchema.omit({ usedBy: true, company: true }).nullable())
		.handler(({ context, input }) => careerService.saveFact(context.user.id, input)),
	updateFact: protectedProcedure
		.route({
			method: "PATCH",
			path: "/career/facts/{id}",
			tags: ["Career"],
			operationId: "updateCareerFact",
			summary: "Update a career fact",
		})
		.input(
			id.extend({
				text: z.string().trim().min(1).max(2000).optional(),
				status: z.enum(["active", "excluded"]).optional(),
				share: z.boolean().optional(),
			}),
		)
		.output(z.void())
		.handler(async ({ context, input }) => {
			await careerService.updateFact(context.user.id, input);
		}),
	forgetFact: protectedProcedure
		.route({
			method: "DELETE",
			path: "/career/facts/{id}",
			tags: ["Career"],
			operationId: "forgetCareerFact",
			summary: "Forget a career fact",
		})
		.input(id)
		.output(z.void())
		.handler(({ context, input }) => careerService.forgetFact(context.user.id, input.id)),
	stories: protectedProcedure
		.route({
			method: "GET",
			path: "/career/stories",
			tags: ["Career"],
			operationId: "listCareerStories",
			summary: "List career stories",
		})
		.input(careerScopeSchema)
		.output(z.array(careerStorySchema))
		.handler(({ context, input }) => careerService.stories({ userId: context.user.id, ...input })),
	saveStory: protectedProcedure
		.route({
			method: "POST",
			path: "/career/stories",
			tags: ["Career"],
			operationId: "saveCareerStory",
			summary: "Save a career story",
		})
		.input(careerStoryInputSchema.extend({ id: z.string().optional() }))
		.output(careerStorySchema)
		.handler(({ context, input: { id, ...input } }) => careerService.saveStory(context.user.id, input, id)),
	deleteStory: protectedProcedure
		.route({
			method: "DELETE",
			path: "/career/stories/{id}",
			tags: ["Career"],
			operationId: "deleteCareerStory",
			summary: "Delete a career story",
		})
		.input(id)
		.output(z.void())
		.handler(({ context, input }) => careerService.deleteStory(context.user.id, input.id)),
	savedItems: protectedProcedure
		.route({
			method: "GET",
			path: "/career/saved",
			tags: ["Career"],
			operationId: "listCareerSavedItems",
			summary: "List saved career work",
		})
		.input(
			z.object({
				applicationId: z.string().min(1).optional(),
				kind: z.enum(["fit", "briefing", "practice", "debrief", "answers", "reply", "offer"]).optional(),
			}),
		)
		.output(z.array(savedItemOutput))
		.handler(({ context, input }) => careerService.savedItems({ userId: context.user.id, ...input })),
	createOffer: protectedProcedure
		.route({
			method: "POST",
			path: "/career/offers",
			tags: ["Career"],
			operationId: "createCareerOffer",
			summary: "Save manually entered offer terms",
		})
		.input(careerOfferInputSchema)
		.output(savedItemSchema.nullable())
		.handler(({ context, input }) => careerService.createOffer(context.user.id, input)),
	updateOffer: protectedProcedure
		.route({
			method: "PATCH",
			path: "/career/offers/{id}",
			tags: ["Career"],
			operationId: "updateCareerOffer",
			summary: "Correct saved offer terms",
			description:
				"Replaces a saved offer's terms. `expected` is the copy being corrected; a change made elsewhere since then is a conflict.",
		})
		.input(id.extend({ terms: offerTermsSchema, expected: offerTermsSchema }))
		.output(savedItemSchema)
		.handler(({ context, input }) => careerService.updateOffer(context.user.id, input.id, input.terms, input.expected)),
	deleteSavedItem: protectedProcedure
		.route({
			method: "DELETE",
			path: "/career/saved/{id}",
			tags: ["Career"],
			operationId: "deleteCareerSavedItem",
			summary: "Delete saved career work",
		})
		.input(id)
		.output(z.void())
		.handler(({ context, input }) => careerService.deleteSavedItem(context.user.id, input.id)),
	generate: protectedProcedure
		.use(aiRequestRateLimit)
		.route({
			method: "POST",
			path: "/career/generate",
			tags: ["Career"],
			operationId: "generateCareerWork",
			summary: "Generate AI work for an application",
			description:
				"Asks the default AI connection for one structured piece of work for an application (fit check, briefing, practice feedback, debrief review, employer message, answer draft). Everything but answer drafts is saved.",
		})
		.input(applicationInput.extend({ locale: z.string().max(20).default("en-US"), task: generateTaskSchema }))
		.output(
			z.object({
				item: savedItemSchema.nullable(),
				answer: z.object({ text: z.string(), factIds: z.array(z.string()) }).nullable(),
			}),
		)
		.handler(({ context, input, signal }) =>
			generateCareer({ userId: context.user.id, ...input, ...(signal ? { signal } : {}) }),
		),
	applyReply: protectedProcedure
		.route({
			method: "POST",
			path: "/career/saved/{id}/apply",
			tags: ["Career"],
			operationId: "applyCareerReply",
			summary: "Apply suggested changes from a message",
		})
		.input(id.extend({ changes: z.array(z.number().int().min(0)).max(4) }))
		.output(
			z.object({
				stages: savedStagesSchema.describe(
					"The stage this call saved, with its stage-write ID. Empty on repeats or when no stage changed.",
				),
			}),
		)
		.handler(({ context, input }) => careerService.applyReply(context.user.id, input.id, input.changes)),
	fitEvidence: protectedProcedure
		.route({
			method: "GET",
			path: "/career/fit-evidence/{applicationId}",
			tags: ["Career"],
			operationId: "getCareerFitEvidence",
			summary: "Check whether Fit has usable evidence",
		})
		.input(applicationInput)
		.output(z.object({ usable: z.boolean() }))
		.handler(async ({ context, input }) => ({
			usable: hasFitEvidence(await careerService.context({ userId: context.user.id, ...input })),
		})),

	undoReply: protectedProcedure
		.route({
			method: "POST",
			path: "/career/saved/{id}/undo",
			tags: ["Career"],
			operationId: "undoCareerReply",
			summary: "Undo changes applied from a message",
			description:
				"Restores the application fields the changes set and removes the offer they saved, while nothing has changed them since. Sent document versions stay recorded.",
		})
		.input(id)
		.output(z.object({ stages: savedStagesSchema }))
		.handler(({ context, input }) => careerService.undoReply(context.user.id, input.id)),
	workspace: protectedProcedure
		.route({
			method: "GET",
			path: "/career/workspace/{applicationId}",
			tags: ["Career"],
			operationId: "getCareerWorkspace",
			summary: "Get an application workspace",
		})
		.input(applicationInput)
		.output(careerWorkspaceSchema)
		.handler(({ context, input }) => careerService.workspace(context.user.id, input.applicationId)),
	saveWorkspace: protectedProcedure
		.route({
			method: "PATCH",
			path: "/career/workspace/{applicationId}",
			tags: ["Career"],
			operationId: "saveCareerWorkspace",
			summary: "Save an application workspace",
		})
		.input(
			applicationInput
				.extend(careerWorkspaceSchema.partial().shape)
				.extend({ expected: careerWorkspaceSchema.partial() }),
		)
		.output(careerWorkspaceSchema)
		.handler(({ context, input: { applicationId, expected, ...patch } }) =>
			careerService.saveWorkspace(context.user.id, applicationId, patch, expected),
		),
	submitApplication: protectedProcedure
		.route({
			method: "POST",
			path: "/career/workspace/{applicationId}/submit",
			tags: ["Career"],
			operationId: "submitCareerApplication",
			summary: "Mark an application as submitted",
		})
		.input(
			applicationInput.extend({
				answers: careerWorkspaceSchema.shape.answers,
				expectedAnswers: careerWorkspaceSchema.shape.answers,
				expectedDocuments: z
					.object({ resumeId: z.string().nullable(), coverLetterId: z.string().nullable() })
					.optional(),
			}),
		)
		.output(
			z.object({
				stages: savedStagesSchema.describe(
					"The stage this call saved on submission, with its stage-write ID. Empty on accepted retries.",
				),
			}),
		)
		.handler(({ context, input }) =>
			careerService.submitApplication(
				context.user.id,
				input.applicationId,
				input.answers,
				input.expectedAnswers,
				input.expectedDocuments,
			),
		),
	snapshotAnswers: protectedProcedure
		.route({
			method: "POST",
			path: "/career/workspace/{applicationId}/answers",
			tags: ["Career"],
			operationId: "snapshotCareerAnswers",
			summary: "Save the answers sent with an application",
			description:
				"Saves unchanged pre-submission answers as sent. Rejects later workspace edits; use submitCareerApplication to record answers and submission atomically.",
		})
		.input(applicationInput)
		.output(z.void())
		.handler(({ context, input }) => careerService.snapshotAnswers(context.user.id, input.applicationId)),
};
