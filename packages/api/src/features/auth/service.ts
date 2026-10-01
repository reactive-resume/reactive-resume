import type { AuthProvider } from "@reactive-resume/auth/types";
import { ORPCError } from "@orpc/client";
import { eq } from "drizzle-orm";
import { isCustomOAuthProviderEnabled } from "@reactive-resume/auth/config";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { env } from "@reactive-resume/env/server";
import { coverLetterService } from "../cover-letters/service";
import { getStorageService } from "../storage/service";

type ProviderList = Partial<Record<AuthProvider, string>>;

const providers = {
	list: (): ProviderList => {
		const providers: ProviderList = { credential: "Password", passkey: "Passkey" };

		if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) providers.google = "Google";
		if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) providers.github = "GitHub";
		if (env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET) providers.linkedin = "LinkedIn";
		if (isCustomOAuthProviderEnabled()) providers.custom = env.OAUTH_PROVIDER_NAME ?? "Custom OAuth";

		return providers;
	},
};

export const authService = {
	providers,

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
				isLocked: schema.resume.isLocked,
				createdAt: schema.resume.createdAt,
				updatedAt: schema.resume.updatedAt,
			})
			.from(schema.resume)
			.where(eq(schema.resume.userId, input.userId));

		const coverLetters = await db.select().from(schema.coverLetter).where(eq(schema.coverLetter.userId, input.userId));
		const applications = await db.select().from(schema.application).where(eq(schema.application.userId, input.userId));
		return {
			exportedAt: new Date().toISOString(),
			user: userRecord,
			resumes,
			coverLetters: await Promise.all(
				coverLetters.map(({ id }) => coverLetterService.getById({ id, userId: input.userId })),
			),
			applications: applications.map(({ userId: _userId, ...application }) => application),
		};
	},

	deleteAccount: async (input: { userId: string }): Promise<void> => {
		const storageService = getStorageService();

		// Delete all user files in one call (pictures, screenshots, pdfs)
		// The storage service delete method supports recursive deletion via prefix
		try {
			await storageService.delete(`uploads/${input.userId}`);
		} catch (err) {
			// Log orphaned-file failures (GDPR erasure signal) but proceed with deleting the user.
			console.error("Failed to delete storage for user %s:", input.userId, err);
		}

		try {
			await db.delete(schema.user).where(eq(schema.user.id, input.userId));
		} catch (err) {
			console.error("Failed to delete user record:", err);

			throw new ORPCError("INTERNAL_SERVER_ERROR");
		}
	},
};
