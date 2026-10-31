import { ORPCError } from "@orpc/server";
import { APIError } from "better-auth";
import { createSelectSchema } from "drizzle-zod";
import z from "zod";
import { accountAuth, auth } from "@reactive-resume/auth/config";
import * as schema from "@reactive-resume/db/schema";
import { applicationProfileRecordSchema } from "@reactive-resume/schema/application-profile";
import { applicationPipelineSchema } from "@reactive-resume/schema/applications/lanes";
import { careerProfileDataSchema, careerWorkspaceSchema } from "@reactive-resume/schema/career";
import { coverLetterSchema } from "@reactive-resume/schema/cover-letter/data";
import { timezoneSchema } from "@reactive-resume/utils/timezone";
import { protectedProcedure, publicProcedure } from "../../context";
import { applicationDto } from "../../dto/application";
import {
	savedItemSchema,
	careerFactSchema,
	careerNotificationSchema,
	careerScheduleSchema,
	careerStorySchema,
} from "../../dto/career";
import { resumeDto } from "../../dto/resume";
import { accountRateLimit } from "../../middleware/rate-limit";
import { authService } from "./service";

const accountProcedure = protectedProcedure.use(accountRateLimit).use(async ({ next }) => {
	try {
		return await next();
	} catch (error) {
		if (error instanceof APIError && error.statusCode < 500) {
			throw new ORPCError(error.body?.code ?? "BAD_REQUEST", {
				status: error.statusCode,
				message: error.message,
				cause: error,
			});
		}
		throw error;
	}
});

// Sessions last a week; a key that never expires, or deleting the account, needs a sign-in from the last day.
const RECENT_SIGN_IN_MS = 24 * 60 * 60 * 1000;

async function assertRecentSignIn(headers: Headers | undefined) {
	const session = headers ? await auth.api.getSession({ headers, query: { disableCookieCache: true } }) : null;
	const signedInAt = session ? new Date(session.session.createdAt).getTime() : 0;
	if (Date.now() - signedInAt > RECENT_SIGN_IN_MS)
		throw new ORPCError("FORBIDDEN", { message: "For your security, sign out and sign in again, then try again." });
}

export const authRouter = {
	getProfile: accountProcedure
		.route({
			method: "GET",
			path: "/auth/profile",
			tags: ["Authentication"],
			operationId: "getProfile",
			summary: "Get your profile",
			description: "Returns only the authenticated user's profile and timezone. No secrets are included.",
		})
		.input(z.object({}).optional())
		.output(
			createSelectSchema(schema.user).pick({
				id: true,
				name: true,
				username: true,
				displayUsername: true,
				image: true,
				email: true,
				emailVerified: true,
				timezone: true,
			}),
		)
		.handler(({ context }) => authService.getProfile(context.user.id)),

	updateProfile: accountProcedure
		.route({
			method: "PATCH",
			path: "/auth/profile",
			tags: ["Authentication"],
			operationId: "updateProfile",
			summary: "Update your profile",
			description:
				"Updates only the authenticated user's name, username, image, or timezone. Usernames must be unique.",
		})
		.input(
			z.object({
				name: z.string().trim().min(1).max(64).optional(),
				username: z
					.string()
					.trim()
					.min(3)
					.max(64)
					.regex(/^[a-z0-9._-]+$/)
					.optional(),
				image: z.url().nullable().optional(),
				timezone: timezoneSchema.optional(),
			}),
		)
		.output(z.object({ status: z.boolean() }))
		.handler(({ context, input }) =>
			accountAuth.updateProfile(context.user, {
				...(input.name !== undefined ? { name: input.name } : {}),
				...(input.username !== undefined ? { username: input.username } : {}),
				...(input.image !== undefined ? { image: input.image } : {}),
				...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
			}),
		),

	apiKeys: {
		list: accountProcedure
			.route({
				method: "GET",
				path: "/auth/api-keys",
				tags: ["Authentication"],
				operationId: "listApiKeys",
				summary: "List your API keys",
				description: "Lists only the authenticated user's API-key metadata. Key secrets are never returned.",
			})
			.input(z.object({}).optional())
			.output(
				z.object({
					apiKeys: z.array(
						createSelectSchema(schema.apikey)
							.pick({
								id: true,
								name: true,
								start: true,
								prefix: true,
								enabled: true,
								createdAt: true,
								updatedAt: true,
								expiresAt: true,
								lastRequest: true,
							})
							.extend({ permissions: z.record(z.string(), z.array(z.string())).nullable() }),
					),
					total: z.number(),
				}),
			)
			.handler(({ context }) => accountAuth.listApiKeys(context.user)),

		delete: accountProcedure
			.route({
				method: "DELETE",
				path: "/auth/api-keys/{keyId}",
				tags: ["Authentication"],
				operationId: "deleteApiKey",
				summary: "Delete your API key",
				description: "Revokes an API key belonging to the authenticated user.",
			})
			.input(z.object({ keyId: z.string().min(1) }))
			.output(z.object({ success: z.boolean() }))
			.handler(({ context, input }) => accountAuth.deleteApiKey(context.user, input.keyId)),
	},

	providers: {
		list: publicProcedure
			.route({
				method: "GET",
				path: "/auth/providers",
				tags: ["Authentication"],
				operationId: "listAuthProviders",
				summary: "List authentication providers",
				description:
					"Returns a list of all authentication providers enabled on this Reactive Resume instance, along with their display names. Possible providers include password-based credentials, Apple, Google, GitHub, LinkedIn, and custom OAuth. No authentication required.",
				successDescription: "A map of enabled authentication provider identifiers to their display names.",
			})
			.input(z.object({}).optional())
			.output(
				z.partialRecord(
					z.enum(["credential", "passkey", "apple", "google", "github", "linkedin", "custom"]),
					z.string(),
				),
			)
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
				throw new ORPCError("FORBIDDEN", { message: "Create API keys from Settings in a web browser." });
			await assertRecentSignIn(context.reqHeaders);
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
		.use(accountRateLimit)
		.route({
			method: "GET",
			path: "/auth/account/export",
			tags: ["Authentication"],
			operationId: "exportAccountData",
			summary: "Export user account data",
			description:
				"Returns a JSON-serializable export of the authenticated user's profile, documents, applications, career knowledge, preparation, schedules and coaching conversations. Images remain URL references; coaching attachments include storage references. Secrets such as password hashes, tokens, and API keys are never included. Requires authentication.",
			successDescription: "The user's exported account data.",
		})
		.input(z.object({}).optional())
		.output(
			z.object({
				exportedAt: z.string(),
				applicationProfile: applicationProfileRecordSchema.nullable().optional(),
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
				applicationPipeline: applicationPipelineSchema,
				aiContentReports: z.array(createSelectSchema(schema.aiContentReport)),
				career: z.object({
					profile: careerProfileDataSchema,
					facts: z.array(careerFactSchema.omit({ usedBy: true, company: true })),
					stories: z.array(careerStorySchema),
					artifacts: z.array(savedItemSchema),
					schedules: z.array(careerScheduleSchema),
					notifications: z.array(careerNotificationSchema),
					threads: z.array(createSelectSchema(schema.agentThread)),
					messages: z.array(
						createSelectSchema(schema.agentMessage, {
							// Preserve historical SDK/tool message fields in their original export form.
							uiMessage: z.record(z.string(), z.unknown()),
						}),
					),
					attachments: z.array(createSelectSchema(schema.agentAttachment)),
					opportunities: z.array(createSelectSchema(schema.careerOpportunity)),
					jobs: z.array(createSelectSchema(schema.careerJob)),
					transcripts: z.array(createSelectSchema(schema.careerTranscript)),
					workspaces: z.array(createSelectSchema(schema.careerWorkspace, { data: careerWorkspaceSchema })),
				}),
			}),
		)
		.handler(({ context }) => authService.exportData({ userId: context.user.id })),

	deleteAccount: protectedProcedure
		.route({
			spec: (operation) => ({ ...operation, security: [{ cookieAuth: [] }] }),
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
				throw new ORPCError("FORBIDDEN", { message: "Delete your account from Settings in a web browser." });
			await assertRecentSignIn(context.reqHeaders);
			await authService.deleteAccount({ userId: context.user.id });
		}),
};
