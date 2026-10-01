import z from "zod";
import { protectedProcedure } from "../../context";
import { agentAttachmentSchema } from "../../dto/agent";
import { storageUploadRateLimit } from "../../middleware/rate-limit";
import { mapAgentEnvironmentError } from "./routing";
import { agentService } from "./service";

export const attachmentsRouter = {
	create: protectedProcedure
		.route({
			method: "POST",
			path: "/agent/attachments",
			tags: ["Agent"],
			operationId: "createAgentAttachment",
			summary: "Create agent attachment",
		})
		.input(
			z.object({
				threadId: z.string(),
				filename: z.string().trim().min(1),
				mediaType: z.string().trim().min(1),
				data: z
					.base64()
					.min(1)
					.max(4 * Math.ceil((25 * 1024 * 1024) / 3)),
			}),
		)
		.output(agentAttachmentSchema)
		.use(storageUploadRateLimit)
		.use(mapAgentEnvironmentError)
		.handler(({ context, input }) =>
			agentService.attachments.create({
				userId: context.user.id,
				threadId: input.threadId,
				filename: input.filename,
				mediaType: input.mediaType,
				data: Uint8Array.from(Buffer.from(input.data, "base64")),
			}),
		),

	delete: protectedProcedure
		.route({
			method: "DELETE",
			path: "/agent/attachments/{id}",
			tags: ["Agent"],
			operationId: "deleteAgentAttachment",
			summary: "Delete agent attachment",
		})
		.input(z.object({ id: z.string() }))
		.output(z.void())
		.use(mapAgentEnvironmentError)
		.handler(({ context, input }) => agentService.attachments.delete({ id: input.id, userId: context.user.id })),
};
