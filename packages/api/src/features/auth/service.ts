import type { AuthProvider } from "@reactive-resume/auth/types";
import { ORPCError } from "@orpc/client";
import { symmetricDecrypt } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { auth, isCustomOAuthProviderEnabled } from "@reactive-resume/auth/config";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { env } from "@reactive-resume/env/server";
import { isLocale } from "@reactive-resume/utils/locale";
import { applicationProfileService } from "../application-profile/service";
import { applicationLaneService } from "../applications/lanes";
import { careerService } from "../career/service";
import { coverLetterService } from "../cover-letters/service";
import { reportStorageCleanupSummary, runStorageCleanup } from "../storage/cleanup";
import { revokeAppleAuthorization } from "./apple-revocation";

type ProviderList = Partial<Record<AuthProvider, string>>;

const providers = {
	list: (): ProviderList => {
		const providers: ProviderList = { credential: "Password", passkey: "Passkey" };

		if (env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET) providers.apple = "Apple";
		if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) providers.google = "Google";
		if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) providers.github = "GitHub";
		if (env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET) providers.linkedin = "LinkedIn";
		if (isCustomOAuthProviderEnabled()) providers.custom = env.OAUTH_PROVIDER_NAME ?? "Custom OAuth";

		return providers;
	},
};

export const authService = {
	providers,
	getProfile: async (userId: string) => {
		const [user] = await db
			.select({
				id: schema.user.id,
				name: schema.user.name,
				username: schema.user.username,
				displayUsername: schema.user.displayUsername,
				image: schema.user.image,
				email: schema.user.email,
				emailVerified: schema.user.emailVerified,
				timezone: schema.user.timezone,
				locale: schema.user.locale,
			})
			.from(schema.user)
			.where(eq(schema.user.id, userId));
		if (!user) throw new ORPCError("NOT_FOUND");
		// A value outside the supported list (none is written, but the column is free text) reads as unknown.
		return { ...user, locale: isLocale(user.locale) ? user.locale : null };
	},

	// GDPR-style export of everything the user owns. Selects explicit columns so
	// secrets (password hashes, tokens, api keys) never leak into the export.
	exportData: async (input: { userId: string }) => {
		const [userRecord] = await db
			.select({
				id: schema.user.id,
				name: schema.user.name,
				email: schema.user.email,
				username: schema.user.username,
				displayUsername: schema.user.displayUsername,
				image: schema.user.image,
				timezone: schema.user.timezone,
				locale: schema.user.locale,
				emailVerified: schema.user.emailVerified,
				createdAt: schema.user.createdAt,
				updatedAt: schema.user.updatedAt,
			})
			.from(schema.user)
			.where(eq(schema.user.id, input.userId));

		if (!userRecord) throw new ORPCError("NOT_FOUND");

		const resumes = await db
			.select({
				id: schema.resume.id,
				name: schema.resume.name,
				slug: schema.resume.slug,
				tags: schema.resume.tags,
				data: schema.resume.data,
				isPublic: schema.resume.isPublic,
				showDownloadButtons: schema.resume.showDownloadButtons,
				showInSearchEngines: schema.resume.showInSearchEngines,
				hideContactDetails: schema.resume.hideContactDetails,
				isPrimary: schema.resume.isPrimary,
				isLocked: schema.resume.isLocked,
				createdAt: schema.resume.createdAt,
				updatedAt: schema.resume.updatedAt,
			})
			.from(schema.resume)
			.where(eq(schema.resume.userId, input.userId));

		const coverLetters = await db.select().from(schema.coverLetter).where(eq(schema.coverLetter.userId, input.userId));
		const applications = await db.select().from(schema.application).where(eq(schema.application.userId, input.userId));
		const resumeVersions = await db
			.select()
			.from(schema.resumeVersion)
			.where(eq(schema.resumeVersion.userId, input.userId));
		const letterVersions = await db
			.select()
			.from(schema.coverLetterVersion)
			.where(eq(schema.coverLetterVersion.userId, input.userId));
		return {
			exportedAt: new Date().toISOString(),
			user: userRecord,
			resumes,
			coverLetters: await Promise.all(
				coverLetters.map(({ id }) => coverLetterService.getById({ id, userId: input.userId })),
			),
			applicationPipeline: await applicationLaneService.get(input.userId),
			applications: applications.map(({ userId: _userId, ...application }) => application),
			documentVersions: {
				resumes: resumeVersions.map(({ userId: _owner, ...version }) => version),
				letters: letterVersions.map(({ userId: _owner, ...version }) => version),
			},
			aiContentReports: await db
				.select()
				.from(schema.aiContentReport)
				.where(eq(schema.aiContentReport.userId, input.userId)),
			career: await careerService.exportData(input.userId),
			applicationProfile: await applicationProfileService.get(input.userId),
		};
	},

	deleteAccount: async (input: { userId: string }): Promise<void> => {
		const appleAccounts = await db
			.select({ refreshToken: schema.account.refreshToken, accessToken: schema.account.accessToken })
			.from(schema.account)
			.where(and(eq(schema.account.userId, input.userId), eq(schema.account.providerId, "apple")));
		// Provider tokens are stored encrypted; rows written before that stay plaintext and fail to decrypt.
		const { secretConfig: key } = await auth.$context;
		const readToken = async (token: string | null) =>
			token && (await symmetricDecrypt({ key, data: token }).catch(() => token));
		for (const tokens of appleAccounts) {
			const plaintext = {
				refreshToken: await readToken(tokens.refreshToken),
				accessToken: await readToken(tokens.accessToken),
			};
			if (!(await revokeAppleAuthorization(plaintext))) {
				console.warn(
					"Apple authorization revocation unavailable during account deletion; manual revocation instructions apply.",
				);
			}
		}

		try {
			// A database trigger enqueues one account-prefix cleanup row in this same delete transaction, so storage
			// failures cannot leave files without a durable retry target. The row has no user FK and survives deletion.
			await db.delete(schema.user).where(eq(schema.user.id, input.userId));
		} catch (err) {
			console.error("Failed to delete user record:", err);

			throw new ORPCError("INTERNAL_SERVER_ERROR");
		}

		await runStorageCleanup({ ownerId: input.userId, limit: 1 })
			.then(reportStorageCleanupSummary)
			.catch((error: unknown) => console.warn("Account storage cleanup will retry from its durable job.", error));
	},
};
