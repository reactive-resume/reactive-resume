import type { SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { BetterAuthError } from "better-auth";
import { and, eq, gt, or, sql } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { isReservedUsername } from "@reactive-resume/utils/app-paths";
import { generateId, toUsername } from "@reactive-resume/utils/string";

interface ExistingOAuthUser {
	id: string;
	email: string;
	username: string;
	displayUsername: string;
	name: string;
	image: string | null;
	accountId?: string;
}

function lower<T extends AnyPgColumn>(column: T): SQL<T> {
	return sql`lower(${column})`;
}

async function findExistingUserByEmail(email: string): Promise<ExistingOAuthUser | undefined> {
	const normalizedEmail = email.trim().toLowerCase();

	const [existingUser] = await db
		.select({
			id: schema.user.id,
			email: schema.user.email,
			username: schema.user.username,
			displayUsername: schema.user.displayUsername,
			name: schema.user.name,
			image: schema.user.image,
		})
		.from(schema.user)
		.where(eq(lower(schema.user.email), normalizedEmail))
		.limit(1);

	return existingUser;
}

async function findLegacyGithubUser(
	profile: OAuthProfile,
	context: OAuthMapperContext,
): Promise<ExistingOAuthUser | undefined> {
	const login = profile.login;
	if (!login) return;

	const normalizedLogin = toUsername(login);

	const [legacyAccount] = await db
		.select({
			id: schema.user.id,
			accountId: schema.account.accountId,
			email: schema.user.email,
			username: schema.user.username,
			displayUsername: schema.user.displayUsername,
			name: schema.user.name,
			image: schema.user.image,
		})
		.from(schema.account)
		.innerJoin(schema.user, eq(schema.account.userId, schema.user.id))
		.where(
			and(
				eq(schema.account.providerId, "github"),
				eq(lower(schema.user.email), context.email),
				or(
					eq(lower(schema.user.username), normalizedLogin),
					eq(schema.user.displayUsername, login),
					eq(lower(schema.user.displayUsername), normalizedLogin),
				),
			),
		)
		.limit(1);

	if (legacyAccount?.email.trim().toLowerCase() !== context.email) return;

	return legacyAccount;
}

async function normalizeExistingUserEmail(userId: string, currentEmail: string, normalizedEmail: string) {
	if (currentEmail === normalizedEmail) return;

	await db.update(schema.user).set({ email: normalizedEmail }).where(eq(schema.user.id, userId));
}

function getEmailLocalPart(email: string): string {
	return email.split("@", 1)[0] ?? "";
}

function appendUsernameSuffix(base: string, suffix: string): string {
	const maxBaseLength = 64 - suffix.length;
	return `${base.slice(0, maxBaseLength)}${suffix}`;
}

// Old public links still point at a released username, so for 30 days only its previous owner can take it again.
const USERNAME_RESERVED_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Whether `userId` may not take this username: someone else released it recently, or the app's addresses use it
 * (`/api`, `/login`), which only an account that already has it keeps.
 */
export async function isUsernameReserved(username: string, userId?: string | null): Promise<boolean> {
	if (isReservedUsername(username)) {
		if (!userId) return true;
		const [owner] = await db
			.select({ id: schema.user.id })
			.from(schema.user)
			.where(and(eq(schema.user.id, userId), eq(schema.user.username, username.trim().toLowerCase())))
			.limit(1);
		return !owner;
	}

	const [released] = await db
		.select({ userId: schema.releasedUsername.userId })
		.from(schema.releasedUsername)
		.where(
			and(
				eq(schema.releasedUsername.username, username.trim().toLowerCase()),
				gt(schema.releasedUsername.releasedAt, new Date(Date.now() - USERNAME_RESERVED_MS)),
			),
		)
		.limit(1);
	return Boolean(released) && released?.userId !== userId;
}

async function isUsernameTaken(candidate: string): Promise<boolean> {
	const normalizedCandidate = candidate.trim().toLowerCase();
	if (await isUsernameReserved(normalizedCandidate)) return true;

	// Both columns are stored lowercase (the username plugin normalizes them), so plain equality uses their unique
	// indexes; `lower()` read every user on each check (#3593).
	const [existingUser] = await db
		.select({ id: schema.user.id })
		.from(schema.user)
		.where(or(eq(schema.user.username, normalizedCandidate), eq(schema.user.displayUsername, normalizedCandidate)))
		.limit(1);

	return Boolean(existingUser);
}

async function allocateUniqueUsername(email: string, preferredUsername?: string | null): Promise<string> {
	const emailLocalPart = getEmailLocalPart(email);
	const preferred = preferredUsername ? toUsername(preferredUsername) : "";
	const normalizedEmailLocalPart = toUsername(emailLocalPart);
	const baseUsername = preferred || normalizedEmailLocalPart || "user";

	if (!(await isUsernameTaken(baseUsername))) return baseUsername;

	const suffixedUsername = await findAvailableUsernameSuffix(baseUsername);
	if (suffixedUsername) return suffixedUsername;

	return appendUsernameSuffix(baseUsername, `-${generateId().slice(0, 8).toLowerCase()}`);
}

async function findAvailableUsernameSuffix(baseUsername: string, index = 1): Promise<string | null> {
	if (index > 999) return null;

	const candidate = appendUsernameSuffix(baseUsername, `-${index}`);
	if (!(await isUsernameTaken(candidate))) return candidate;

	return findAvailableUsernameSuffix(baseUsername, index + 1);
}

interface OAuthProfile {
	email?: string | null | undefined;
	id?: string | number | null | undefined;
	name?: string | null | undefined;
	picture?: string | null | undefined;
	image?: string | null | undefined;
	avatar_url?: string | null | undefined;
	login?: string | null | undefined;
	preferred_username?: string | null | undefined;
}

interface OAuthMapperContext {
	email: string;
	emailLocalPart: string;
}

interface OAuthMapperOptions<TProfile extends OAuthProfile> {
	providerName: string;
	findExistingUser?: (profile: TProfile, context: OAuthMapperContext) => Promise<ExistingOAuthUser | undefined>;
	getPreferredUsername?: (profile: TProfile, context: OAuthMapperContext) => string | undefined | null;
	getName?: (profile: TProfile, context: OAuthMapperContext) => string | undefined | null;
	getImage?: (profile: TProfile) => string | undefined | null;
}

export function createProfileMapper<TProfile extends OAuthProfile>({
	providerName,
	findExistingUser,
	getPreferredUsername,
	getName,
	getImage,
}: OAuthMapperOptions<TProfile>) {
	return async (profile: TProfile) => {
		if (!profile.email) {
			throw new BetterAuthError(
				`${providerName} provider did not return an email address. This is required for user creation.`,
				{ cause: "EMAIL_REQUIRED" },
			);
		}

		const email = profile.email.trim().toLowerCase();
		const emailLocalPart = getEmailLocalPart(email);
		const context = { email, emailLocalPart };
		const existingUser = (await findExistingUser?.(profile, context)) ?? (await findExistingUserByEmail(email));
		const image = getImage?.(profile) ?? undefined;

		if (existingUser) {
			const existingEmail = existingUser.email.trim().toLowerCase();
			await normalizeExistingUserEmail(existingUser.id, existingUser.email, existingEmail);

			// Better Auth 1.7 forbids `mapProfileToUser` from returning `id`; provider identity is
			// resolved by `accountSubject` and existing local users are matched by `account.accountLinking`.
			// Never return `emailVerified`: it would replace the provider's own proof, which Better Auth needs
			// to decide whether an untrusted provider may link to this local account.
			const existingImage = image ?? existingUser.image;

			return {
				name: existingUser.name,
				email: existingEmail,
				...(existingImage ? { image: existingImage } : {}),
				username: existingUser.username,
				displayUsername: existingUser.displayUsername,
			};
		}

		const preferredUsername = getPreferredUsername?.(profile, context);
		const username = await allocateUniqueUsername(email, preferredUsername);
		const mappedName = getName?.(profile, context)?.trim();

		return {
			name: mappedName || username || emailLocalPart,
			email,
			...(image ? { image } : {}),
			username,
			displayUsername: username,
		};
	};
}

export function createGithubProfileMapper() {
	return createProfileMapper({
		providerName: "GitHub",
		findExistingUser: findLegacyGithubUser,
		getPreferredUsername: (profile, context) => profile.login ?? context.emailLocalPart,
		getName: (profile, context) => profile.name ?? profile.login ?? context.emailLocalPart,
		getImage: (profile) => profile.avatar_url,
	});
}
