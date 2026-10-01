import { eventIterator } from "@orpc/server";
import z from "zod";
import { protectedProcedure } from "../../context";
import { uiMessageSchema } from "../../dto/agent";
import { aiRequestRateLimit } from "../../middleware/rate-limit";
import { mapAgentEnvironmentError } from "./routing";
import { agentService } from "./service";

export const messagesRouter = {
	send: protectedProcedure
		.route({
			method: "POST",
			path: "/agent/messages/send",
			tags: ["Agent"],
			operationId: "sendAgentMessage",
			summary: "Send agent message",
		})
		.input(
			z.object({
				threadId: z.string(),
				message: uiMessageSchema,
				attachmentIds: z.array(z.string().trim().min(1)).max(10).optional(),
				// The context chips: leaving one out keeps it out of what's sent.
				context: z
					.object({
						document: z.boolean().optional().describe("Share the open document (on by default)."),
						posting: z.boolean().optional().describe("Share the job posting it's for (on by default)."),
						applicationId: z.string().trim().min(1).max(255).optional(),
					})
					.optional(),
			}),
		)
		.use(aiRequestRateLimit)
		.use(mapAgentEnvironmentError)
		.output(eventIterator(z.string()))
		.handler(({ context, input }) =>
			agentService.messages.send({
				userId: context.user.id,
				threadId: input.threadId,
				message: input.message,
				...(input.attachmentIds ? { attachmentIds: input.attachmentIds } : {}),
				...(input.context ? { context: input.context } : {}),
			}),
		),

	stop: protectedProcedure
		.route({
			method: "POST",
			path: "/agent/messages/stop",
			tags: ["Agent"],
			operationId: "stopAgentMessage",
			summary: "Stop active agent run",
		})
		.input(
			z.object({
				threadId: z.string(),
				// Deprecated and ignored: partial content now persists server-side via the run's
				// abort path. Kept in the schema for one release so mid-deploy clients still parse.
				partialMessage: uiMessageSchema.optional(),
			}),
		)
		.output(z.void())
		.use(mapAgentEnvironmentError)
		.handler(({ context, input }) =>
			agentService.messages.stop({
				userId: context.user.id,
				threadId: input.threadId,
			}),
		),

	resume: protectedProcedure
		.route({
			method: "GET",
			path: "/agent/messages/resume",
			tags: ["Agent"],
			operationId: "resumeAgentMessages",
			summary: "Resume agent message stream",
		})
		.input(z.object({ threadId: z.string() }))
		.use(mapAgentEnvironmentError)
		.output(eventIterator(z.string()))
		.handler(({ context, input }) =>
			agentService.messages.resume({ userId: context.user.id, threadId: input.threadId }),
		),

	setEditStatus: protectedProcedure
		.route({
			method: "POST",
			path: "/agent/messages/edit-status",
			tags: ["Agent"],
			operationId: "setAgentEditStatus",
			summary: "Record what happened to proposed edits",
			description:
				"Records that proposed edits were accepted, rejected, or are pending again (after an undo), so past conversations show their outcome.",
		})
		.input(
			z.object({
				threadId: z.string(),
				messageId: z.string(),
				toolCallId: z.string(),
				edits: z
					.array(z.object({ id: z.string(), status: z.enum(["pending", "accepted", "rejected"]) }))
					.min(1)
					.max(50),
			}),
		)
		.output(z.object({ editsProposed: z.number(), editsAccepted: z.number() }))
		.use(mapAgentEnvironmentError)
		.handler(({ context, input }) => agentService.messages.setEditStatus({ userId: context.user.id, ...input })),
};
