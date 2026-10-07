import { ORPCError } from "@orpc/server";
import { createSelectSchema } from "drizzle-zod";
import z from "zod";
import { auth } from "@reactive-resume/auth/config";
import * as schema from "@reactive-resume/db/schema";
import { coverLetterSchema } from "@reactive-resume/schema/cover-letter/data";
import { protectedProcedure, publicProcedure } from "../../context";
import { applicationDto } from "../../dto/application";
import { resumeDto } from "../../dto/resume";
import { authService } from "./service";

export const authRouter = {
	providers: {
		list: publicProcedure
			.route({
				method: "GET",
				path: "/auth/providers",
				tags: ["Authentication"],
				operationId: "listAuthProviders",
				summary: "List authentication providers",
				description:
					"Returns a list of all authentication providers enabled on this Reactive Resume instance, along with their display names. Possible providers include password-based credentials, Google, GitHub, LinkedIn, and custom OAuth. No authentication required.",
				successDescription: "A map of enabled authentication provider identifiers to their display names.",
			})
			.input(z.object({}).optional())
			.output(z.partialRecord(z.enum(["credential", "passkey", "google", "github", "linkedin", "custom"]), z.string()))
			.handler(() => authService.providers.list()),
	},

	createApiKey: protectedProcedure
		.route({
			method: "POST",
			path: "/auth/api-keys",
			tags: ["Authentication"],
			operationId: "createScopedApiKey",
			summary: "Create an API key",
			description:
				"Create a read-only or full-access API key. Requires a browser session; keys and OAuth tokens cannot create credentials.",
		})
		.input(
			z.object({
				name: z.string().trim().min(1).max(64),
				expiresIn: z.number().int().positive().nullable(),
				access: z.enum(["read", "full"]),
			}),
		)
		.output(z.object({ key: z.string() }))
		.handler(async ({ context, input }) => {
			if (context.authentication?.method !== "session")
				throw new ORPCError("FORBIDDEN", { message: "Create API keys in your browser settings." });
			const result = await auth.api.createApiKey({
				body: {
					userId: context.user.id,
					name: input.name,
					expiresIn: input.expiresIn,
					permissions: { api: input.access === "read" ? ["read"] : ["read", "write", "delete"] },
				},
			});
			return { key: result.key };
		}),

	exportData: protectedProcedure
		.route({
			method: "GET",
			path: "/auth/account/export",
			tags: ["Authentication"],
			operationId: "exportAccountData",
			summary: "Export user account data",
			description:
				"Returns a JSON-serializable export of the authenticated user's data, including their public profile fields, resumes, independent cover letters and job applications. Images remain URL references. Secrets such as password hashes, tokens, and API keys are never included. Requires authentication.",
			successDescription: "The user's exported account data.",
		})
		.input(z.object({}).optional())
		.output(
			z.object({
				exportedAt: z.string(),
				user: createSelectSchema(schema.user).pick({
					id: true,
					name: true,
					email: true,
					username: true,
					displayUsername: true,
					image: true,
					emailVerified: true,
					createdAt: true,
					updatedAt: true,
				}),
				resumes: z.array(resumeDto.getById.output.omit({ hasPassword: true, applicationId: true })),
				coverLetters: z.array(coverLetterSchema),
				applications: z.array(applicationDto.getById.output),
			}),
		)
		.handler(({ context }) => authService.exportData({ userId: context.user.id })),

	deleteAccount: protectedProcedure
		.route({
			method: "DELETE",
			path: "/auth/account",
			tags: ["Authentication"],
			operationId: "deleteAccount",
			summary: "Delete user account",
			description:
				"Permanently deletes the authenticated user's account, including all resumes, uploaded files (profile pictures, screenshots, PDFs), and associated data. This action is irreversible. Requires a browser session; keys and OAuth tokens cannot delete accounts.",
			successDescription: "The user account and all associated data have been successfully deleted.",
		})
		.input(z.object({}).optional())
		.output(z.void())
		.handler(async ({ context }) => {
			if (context.authentication?.method !== "session")
				throw new ORPCError("FORBIDDEN", { message: "Account deletion must be performed in your browser settings." });
			await authService.deleteAccount({ userId: context.user.id });
		}),
};
