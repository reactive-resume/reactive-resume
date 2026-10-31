import z from "zod";
import {
	applicationProfileRecordSchema,
	saveApplicationProfileSchema,
} from "@reactive-resume/schema/application-profile";
import { protectedProcedure } from "../../context";
import { applicationProfileService } from "./service";

export const applicationProfileRouter = {
	get: protectedProcedure
		.route({
			method: "GET",
			path: "/application-profile",
			tags: ["Application Profile"],
			operationId: "getApplicationProfile",
			summary: "Read your private application profile",
		})
		.output(applicationProfileRecordSchema.nullable())
		.handler(({ context }) => applicationProfileService.get(context.user.id)),
	save: protectedProcedure
		.route({
			method: "PUT",
			path: "/application-profile",
			tags: ["Application Profile"],
			operationId: "saveApplicationProfile",
			summary: "Save and mark your private application profile reviewed",
		})
		.input(saveApplicationProfileSchema)
		.output(applicationProfileRecordSchema)
		.handler(({ context, input }) => applicationProfileService.save(context.user.id, input)),
	delete: protectedProcedure
		.route({
			method: "DELETE",
			path: "/application-profile",
			tags: ["Application Profile"],
			operationId: "deleteApplicationProfile",
			summary: "Delete your private application profile",
		})
		.input(z.strictObject({ expectedRevision: z.string().min(1).max(64) }))
		.output(z.void())
		.handler(({ context, input }) => applicationProfileService.delete(context.user.id, input.expectedRevision)),
};
