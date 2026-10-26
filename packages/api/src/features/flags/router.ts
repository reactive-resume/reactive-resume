import z from "zod";
import { env } from "@reactive-resume/env/server";
import { publicProcedure } from "../../context";
import { isCareerSchedulingEnabled } from "../career/runner";
import { isCustomDomainsEnabled } from "../custom-domain/service";

export type FeatureFlags = {
	disableSignups: boolean;
	disableEmailAuth: boolean;
	allowGuestLogin: boolean;
	smtpEnabled: boolean;
	careerSchedulingEnabled?: boolean;
	appUrl?: string;
	aliasUrl?: string | undefined;
	customDomains?: boolean;
	olacvSuggestion?: boolean;
};

// Mirrors isSmtpEnabled() in packages/email/src/transport.ts (kept local to avoid an api -> email dependency).
const isSmtpEnabled = () => Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && env.SMTP_FROM);

export const flagsRouter = {
	get: publicProcedure
		.route({
			method: "GET",
			path: "/flags",
			tags: ["Feature Flags"],
			operationId: "getFeatureFlags",
			summary: "Get feature flags",
			description:
				"Returns the current feature flags for this Reactive Resume instance. Feature flags control instance-wide settings such as whether new user signups or email-based authentication are disabled. No authentication required.",
			successDescription: "The current feature flags for this instance.",
		})
		.input(z.object({}).optional())
		.output(
			z.object({
				disableSignups: z.boolean().describe("Whether new user signups are disabled on this instance."),
				disableEmailAuth: z.boolean().describe("Whether email-based authentication is disabled on this instance."),
				allowGuestLogin: z.boolean().describe("Whether visitors can continue as a guest on this instance."),
				smtpEnabled: z.boolean().describe("Whether outbound email (SMTP) is configured on this instance."),
				careerSchedulingEnabled: z
					.boolean()
					.describe("Whether scheduled career work is configured on this deployment."),
				appUrl: z.string().describe("The app's own address, where sign-in and the editor live."),
				aliasUrl: z
					.string()
					.optional()
					.describe(
						"A second domain serving the same public pages, when configured. Shared resume links use it instead of appUrl.",
					),
				customDomains: z.boolean().describe("Whether accounts can open their primary resume at their own domain."),
				olacvSuggestion: z
					.boolean()
					.describe("Whether accounts without a custom domain see a suggestion to register one at OlaCV."),
			}),
		)
		.handler(() => ({
			disableSignups: env.FLAG_DISABLE_SIGNUPS,
			disableEmailAuth: env.FLAG_DISABLE_EMAIL_AUTH,
			allowGuestLogin: env.FLAG_ENABLE_GUEST_LOGIN && !env.FLAG_DISABLE_SIGNUPS,
			smtpEnabled: isSmtpEnabled(),
			careerSchedulingEnabled: isCareerSchedulingEnabled(),
			appUrl: new URL(env.APP_URL).origin,
			...(env.APP_ALIAS_URL ? { aliasUrl: new URL(env.APP_ALIAS_URL).origin } : {}),
			customDomains: isCustomDomainsEnabled(),
			olacvSuggestion: env.FLAG_OLACV_SUGGESTION,
		})),
};
