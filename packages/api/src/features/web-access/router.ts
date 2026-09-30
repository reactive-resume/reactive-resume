import { ORPCError } from "@orpc/client";
import { protectedProcedure } from "../../context";
import { webAccessDto } from "../../dto/web-access";
import { WebAccessError } from "./contracts";
import { webAccessService } from "./credentials";
import { probeWebAccess } from "./service";

const route = { tags: ["Integrations"] };
const errors = {
	FORBIDDEN: { message: "Web access is managed by the server.", status: 403 },
	PRECONDITION_FAILED: { message: "Credential encryption is not configured.", status: 412 },
};

export const webAccessRouter = {
	status: protectedProcedure
		.route({
			...route,
			method: "GET",
			path: "/integrations/web-access",
			operationId: "getWebAccessStatus",
			summary: "Get search and reading availability",
		})
		.output(webAccessDto.status.output)
		.handler(({ context }) => webAccessService.status(context.user.id)),
	save: protectedProcedure
		.route({
			...route,
			method: "PUT",
			path: "/integrations/web-access",
			operationId: "saveWebAccessKey",
			summary: "Select a personal web connection",
		})
		.input(webAccessDto.save.input)
		.errors(errors)
		.output(webAccessDto.save.output)
		.handler(({ context, input }) => webAccessService.save(context.user.id, input.provider, input.apiKey)),
	delete: protectedProcedure
		.route({
			...route,
			method: "DELETE",
			path: "/integrations/web-access",
			operationId: "deleteWebAccessKey",
			summary: "Remove the personal web connection",
		})
		.errors(errors)
		.output(webAccessDto.delete.output)
		.handler(({ context }) => webAccessService.delete(context.user.id)),
	test: protectedProcedure
		.route({
			...route,
			method: "POST",
			path: "/integrations/web-access/test",
			operationId: "testWebAccessConnection",
			summary: "Test provider search and reading independently",
		})
		.errors({
			PRECONDITION_FAILED: { message: "No external web connection is configured.", status: 412 },
			RATE_LIMIT_EXCEEDED: { message: "Too many web requests. Try again later.", status: 429 },
		})
		.output(webAccessDto.test.output)
		.handler(async ({ context, signal }) => {
			const connection = await webAccessService.resolve(context.user.id);
			if (!connection)
				throw new ORPCError("PRECONDITION_FAILED", { message: "No external web connection is configured." });
			try {
				return await probeWebAccess(connection, { userId: context.user.id, ...(signal ? { signal } : {}) });
			} catch (error) {
				if (!signal?.aborted && error instanceof WebAccessError && error.reason === "rate-limit")
					throw new ORPCError("RATE_LIMIT_EXCEEDED", {
						status: 429,
						message: "Too many web requests. Try again later.",
					});
				throw error;
			}
		}),
};
