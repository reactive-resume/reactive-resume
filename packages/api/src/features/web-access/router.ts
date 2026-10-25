import { ORPCError } from "@orpc/client";
import z from "zod";
import { protectedProcedure } from "../../context";
import { webAccessDto } from "../../dto/web-access";
import { WebAccessError } from "./contracts";
import { webAccessService } from "./credentials";
import { searchScope } from "./regions";
import { probeWebAccess } from "./service";

const route = { tags: ["Integrations"] };
const errors = {
	FORBIDDEN: { message: "Web access is set by the server administrator and can't be changed here.", status: 403 },
	PRECONDITION_FAILED: {
		message: "Web access can't be saved on this server. Ask the server administrator to set ENCRYPTION_SECRET.",
		status: 412,
	},
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
		.input(z.object({}).optional())
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
		.input(z.object({}).optional())
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
			PRECONDITION_FAILED: { message: "Set up web access in Settings → AI & developer first.", status: 412 },
			RATE_LIMIT_EXCEEDED: { message: "Too many web requests. Try again later.", status: 429 },
		})
		.input(z.object({}).optional())
		.output(webAccessDto.test.output)
		.handler(async ({ context, signal }) => {
			const [connection, { regions }] = await Promise.all([
				webAccessService.resolve(context.user.id),
				searchScope(context.user.id, context.reqHeaders.get("x-client-timezone") ?? undefined),
			]);
			// The server's SearXNG can be tested without a connection; reading then reports the built-in reader only.
			if (!webAccessService.canSearch(connection !== null))
				throw new ORPCError("PRECONDITION_FAILED", {
					message: "Set up web access in Settings → AI & developer first.",
				});
			try {
				return await probeWebAccess(connection, {
					userId: context.user.id,
					region: regions[0],
					...(signal ? { signal } : {}),
				});
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
