import z from "zod";
import { env } from "@reactive-resume/env/server";
import { publicProcedure } from "../../context";

export type FeatureFlags = {
	disableSignups: boolean;
	disableEmailAuth: boolean;
	smtpEnabled: boolean;
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
				smtpEnabled: z.boolean().describe("Whether outbound email (SMTP) is configured on this instance."),
			}),
		)
		.handler((): FeatureFlags => ({
			disableSignups: env.FLAG_DISABLE_SIGNUPS,
			disableEmailAuth: env.FLAG_DISABLE_EMAIL_AUTH,
			smtpEnabled: isSmtpEnabled(),
		})),
};
