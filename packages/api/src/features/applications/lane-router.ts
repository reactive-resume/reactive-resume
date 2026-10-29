import z from "zod";
import { applicationClosedReasonSchema, applicationStatusSchema } from "@reactive-resume/schema/applications/data";
import {
	applicationLaneColorSchema,
	applicationLaneLabelSchema,
	applicationPipelineSchema,
} from "@reactive-resume/schema/applications/lanes";
import { protectedProcedure } from "../../context";
import { resumeMutationRateLimit } from "../../middleware/rate-limit";
import { applicationLaneService } from "./lanes";

const revision = { expectedRevision: z.number().int().min(0) };
export const applicationLanesRouter = {
	get: protectedProcedure
		.route({
			method: "GET",
			path: "/applications/lanes",
			tags: ["Applications"],
			operationId: "getApplicationLanes",
			summary: "Get application lanes",
		})
		.input(z.object({}).optional().default({}))
		.output(applicationPipelineSchema)
		.handler(({ context }) => applicationLaneService.get(context.user.id)),
	create: protectedProcedure
		.route({
			method: "POST",
			path: "/applications/lanes",
			tags: ["Applications"],
			operationId: "createApplicationLane",
			summary: "Create application lane",
		})
		.input(
			z.object({
				...revision,
				label: applicationLaneLabelSchema,
				category: applicationStatusSchema,
				color: applicationLaneColorSchema,
				closedReason: applicationClosedReasonSchema.nullable().optional(),
			}),
		)
		.use(resumeMutationRateLimit)
		.output(applicationPipelineSchema)
		.handler(({ context, input }) => applicationLaneService.create(context.user.id, input)),
	update: protectedProcedure
		.route({
			method: "PUT",
			path: "/applications/lanes/{id}",
			tags: ["Applications"],
			operationId: "updateApplicationLane",
			summary: "Rename or recolor application lane",
		})
		.input(
			z.object({
				...revision,
				id: z.string(),
				label: applicationLaneLabelSchema.optional(),
				color: applicationLaneColorSchema.optional(),
			}),
		)
		.use(resumeMutationRateLimit)
		.output(applicationPipelineSchema)
		.handler(({ context, input }) => applicationLaneService.update(context.user.id, input)),
	reorder: protectedProcedure
		.route({
			method: "POST",
			path: "/applications/lanes/reorder",
			tags: ["Applications"],
			operationId: "reorderApplicationLanes",
			summary: "Reorder application lanes",
		})
		.input(z.object({ ...revision, ids: z.array(z.string()).min(6).max(40) }))
		.use(resumeMutationRateLimit)
		.output(applicationPipelineSchema)
		.handler(({ context, input }) => applicationLaneService.reorder(context.user.id, input)),
	retire: protectedProcedure
		.route({
			method: "POST",
			path: "/applications/lanes/{id}/retire",
			tags: ["Applications"],
			operationId: "retireApplicationLane",
			summary: "Retire application lane and move its applications",
		})
		.input(z.object({ ...revision, id: z.string(), replacementId: z.string() }))
		.use(resumeMutationRateLimit)
		.output(applicationPipelineSchema)
		.handler(({ context, input }) => applicationLaneService.retire(context.user.id, input)),
};
