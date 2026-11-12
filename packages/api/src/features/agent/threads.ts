import z from "zod";
import { protectedProcedure } from "../../context";
import { agentThreadSchema, agentConversationSchema } from "../../dto/agent";
import { paginate, paginationShape } from "../../pagination";
import { mapAgentEnvironmentError } from "./routing";
import { agentService } from "./service";

export const threadsRouter = {
	list: protectedProcedure
		.route({
			method: "GET",
			path: "/agent/threads",
			tags: ["Agent"],
			operationId: "listAgentThreads",
			summary: "List agent threads",
		})
		.use(mapAgentEnvironmentError)
		.output(z.array(agentThreadSchema))
		.input(z.object(paginationShape).default({}))
		.handler(async ({ context, input }) =>
			paginate(await agentService.threads.list({ userId: context.user.id }), input, context.resHeaders),
		),

	start: protectedProcedure
		.route({
			method: "POST",
			path: "/agent/threads",
			tags: ["Agent"],
			operationId: "startAgentThread",
			summary: "Start a document, application or career conversation",
			description:
				"Starts an assistant conversation about one resume or cover letter, using the given tested provider or the default one. The assistant reads the document and proposes edits; it never changes the document itself.",
		})
		.input(
			z
				.object({
					resumeId: z.string().min(1).optional(),
					coverLetterId: z.string().min(1).optional(),
					aiProviderId: z.string().optional(),
					scope: z.enum(["document", "application", "career"]).default("document"),
					applicationId: z.string().min(1).optional(),
				})
				.refine(
					(input) =>
						input.scope === "document"
							? Boolean(input.resumeId) !== Boolean(input.coverLetterId) && !input.applicationId
							: !input.resumeId &&
								!input.coverLetterId &&
								(input.scope === "application") === Boolean(input.applicationId),
					{
						message: "Choose one document, one application, or general career context.",
					},
				),
		)
		.use(mapAgentEnvironmentError)
		.output(agentThreadSchema)
		.handler(({ context, input }) => agentService.threads.start({ userId: context.user.id, ...input })),

	get: protectedProcedure
		.route({
			method: "GET",
			path: "/agent/threads/{id}",
			tags: ["Agent"],
			operationId: "getAgentThread",
			summary: "Get agent thread",
		})
		.input(z.object({ id: z.string() }))
		.use(mapAgentEnvironmentError)
		.output(agentConversationSchema)
		.handler(({ context, input }) => agentService.threads.get({ id: input.id, userId: context.user.id })),

	update: protectedProcedure
		.route({
			method: "PATCH",
			path: "/agent/threads/{id}",
			tags: ["Agent"],
			operationId: "updateAgentThread",
			summary: "Switch a conversation's model, rename it, or move it to a copy",
			description:
				"`workingResumeId` moves a resume conversation once, from the resume it started on to a copy of it: another of your resumes, not in Trash, with the same content. Its edits are then accepted on the copy and the original stays unchanged.",
		})
		.input(
			z
				.object({
					id: z.string(),
					aiProviderId: z.string().min(1).optional(),
					title: z.string().trim().min(1).max(200).optional(),
					workingResumeId: z.string().min(1).optional(),
				})
				.refine((input) => input.aiProviderId || input.title || input.workingResumeId, {
					message: "Give a model, a title or a copy to work on.",
				}),
		)
		.use(mapAgentEnvironmentError)
		.output(agentThreadSchema)
		.handler(({ context, input }) => agentService.threads.update({ ...input, userId: context.user.id })),

	delete: protectedProcedure
		.route({
			method: "DELETE",
			path: "/agent/threads/{id}",
			tags: ["Agent"],
			operationId: "deleteAgentThread",
			summary: "Delete agent thread",
		})
		.input(z.object({ id: z.string() }))
		.output(z.void())
		.use(mapAgentEnvironmentError)
		.handler(({ context, input }) => agentService.threads.delete({ id: input.id, userId: context.user.id })),
};
