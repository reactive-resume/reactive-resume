import z from "zod";
import { protectedProcedure } from "../../context";
import { firecrawlService } from "./service";

const route = { tags: ["Integrations"] };
const errors = {
	FORBIDDEN: { message: "Firecrawl is managed by the server.", status: 403 },
	PRECONDITION_FAILED: { message: "Credential encryption is not configured.", status: 412 },
	CONFLICT: { message: "Manage the selected provider through /integrations/web-access.", status: 409 },
};

export const firecrawlRouter = {
	status: protectedProcedure
		.route({
			...route,
			method: "GET",
			path: "/integrations/firecrawl",
			operationId: "getFirecrawlStatus",
			summary: "Get Firecrawl availability",
		})
		.output(z.object({ managed: z.boolean(), configured: z.boolean(), canSave: z.boolean() }))
		.handler(({ context }) => firecrawlService.status(context.user.id)),
	save: protectedProcedure
		.route({
			...route,
			method: "PUT",
			path: "/integrations/firecrawl",
			operationId: "saveFirecrawlKey",
			summary: "Save a personal Firecrawl Cloud key",
		})
		.input(z.object({ apiKey: z.string().trim().min(1).max(2_000) }))
		.errors(errors)
		.output(z.void())
		.handler(({ context, input }) => firecrawlService.save(context.user.id, input.apiKey)),
	delete: protectedProcedure
		.route({
			...route,
			method: "DELETE",
			path: "/integrations/firecrawl",
			operationId: "deleteFirecrawlKey",
			summary: "Delete a personal Firecrawl Cloud key",
		})
		.errors(errors)
		.output(z.void())
		.handler(({ context }) => firecrawlService.delete(context.user.id)),
};
