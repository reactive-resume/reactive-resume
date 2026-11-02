import type { BetterAuthPlugin, User } from "better-auth";
import type {
	AnonymousOptions,
	GenericOAuthConfig,
	GenericOAuthUserInfo,
	UserWithAnonymous,
} from "better-auth/plugins";
import type { JWTPayload } from "jose";
import { AsyncLocalStorage } from "node:async_hooks";
import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { dash } from "@better-auth/infra";
import { oauthProvider } from "@better-auth/oauth-provider";
import { passkey } from "@better-auth/passkey";
import { compare, hash } from "bcryptjs";
import { APIError, betterAuth } from "better-auth";
import {
	addOAuthServerContext,
	createAuthMiddleware,
	getOAuthState,
	getSessionFromCtx,
	isAPIError,
} from "better-auth/api";
import { deleteSessionCookie, parseCookies, parseSetCookieHeader, setSessionCookie } from "better-auth/cookies";
import { admin, anonymous, jwt, openAPI } from "better-auth/plugins";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { twoFactor } from "better-auth/plugins/two-factor";
import { username } from "better-auth/plugins/username";
import { and, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { createLocalJWKSet, jwtVerify } from "jose";
import { createDefaultOwnedApplicationLanes, MAX_APPLICATION_LANES } from "@reactive-resume/db/application-lanes";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { resetPasswordEmail, verifyEmail, verifyEmailChange } from "@reactive-resume/email/templates/auth";
import { sendEmail } from "@reactive-resume/email/transport";
import { env } from "@reactive-resume/env/server";
import { defaultLocale, isLocale, localeSchema } from "@reactive-resume/utils/locale";
import { rateLimitConfig } from "@reactive-resume/utils/rate-limit";
import { generateId, toUsername } from "@reactive-resume/utils/string";
import { timezoneSchema } from "@reactive-resume/utils/timezone";
import { isAllowedOAuthRedirectUri } from "@reactive-resume/utils/url-security.node";
import {
	allocateUniqueUsername,
	createGithubProfileMapper,
	createProfileMapper,
	isUsernameReserved,
} from "./oauth-profile";
import { authRateLimitStorage } from "./rate-limit";
import { getTrustedOrigins } from "./trusted-origins";

const authBaseUrl = env.APP_URL;

/** The interface language a request was made in: the app keeps it in the `locale` cookie. */
function requestLocale(headers: Headers | undefined) {
	const locale = parseCookies(headers?.get("cookie") ?? "").get("locale");
	return isLocale(locale) ? locale : undefined;
}

/**
 * Account emails use the account's language, then the language of the request that sent them (an account from before
 * the app stored one), then English. Only the text changes: the link, its expiry and who receives it don't.
 */
function accountEmailLocale(user: User, request: Request | undefined) {
	const saved = (user as User & { locale?: unknown }).locale;
	return isLocale(saved) ? saved : (requestLocale(request?.headers) ?? defaultLocale);
}
const isRateLimitEnabled = process.env.NODE_ENV === "production" && !env.FLAG_DISABLE_API_RATE_LIMIT;

const oauthAudienceBase = authBaseUrl.replace(/\/$/, "");
// These identify the same account-wide API/MCP resource, not separate permission
// tiers. Protected-resource metadata advertises the root; MCP clients may also
// select the mounted endpoint or normalize either URI with a trailing slash.
const OAUTH_AUDIENCES = [
	oauthAudienceBase,
	`${oauthAudienceBase}/`,
	`${oauthAudienceBase}/mcp`,
	`${oauthAudienceBase}/mcp/`,
];
const oauthIssuer = `${authBaseUrl}/api/auth`;
const missingResourceDescription = `Send resource=${oauthAudienceBase}; see /.well-known/oauth-protected-resource.`;

export async function verifyOAuthToken(token: string): Promise<JWTPayload> {
	// Use the same in-process verification on Docker and Vercel. Access tokens must
	// identify a live client/grant and cannot use proof binding without a DPoP proof.
	const { payload } = await jwtVerify(token, createLocalJWKSet(await auth.api.getJwks()), {
		issuer: oauthIssuer,
		audience: OAUTH_AUDIENCES,
		requiredClaims: ["sub", "exp", "iat", "azp"],
	});
	if (payload.cnf) throw new APIError("UNAUTHORIZED", { message: "Invalid bearer token." });
	await validateOAuthGrant(payload);
	return payload;
}

/** The provider already verified signatures; all token consumers must also check the live grant. */
async function validateOAuthGrant(payload: JWTPayload) {
	if (typeof payload.sub !== "string" || typeof payload.azp !== "string") {
		throw new APIError("UNAUTHORIZED", { message: "Invalid bearer token." });
	}
	const [client] = await db
		.select()
		.from(schema.oauthClient)
		.where(eq(schema.oauthClient.clientId, payload.azp))
		.limit(1);
	if (!client || client.disabled)
		throw new APIError("UNAUTHORIZED", { message: "OAuth client is disabled or deleted." });
	const scopes = typeof payload.scope === "string" ? payload.scope.split(/\s+/).filter(Boolean) : [];
	// offline_access grants outlive the browser session. After refresh revocation or in-app sign-out,
	// issued JWT access tokens remain valid for up to 1 h; consent revocation blocks them immediately below.
	if (payload.sid !== undefined && !scopes.includes("offline_access")) {
		if (typeof payload.sid !== "string") throw new APIError("UNAUTHORIZED", { message: "Invalid token session." });
		const [session] = await db
			.select()
			.from(schema.session)
			.where(
				and(
					eq(schema.session.id, payload.sid),
					eq(schema.session.userId, payload.sub),
					gt(schema.session.expiresAt, new Date()),
				),
			)
			.limit(1);
		if (!session) throw new APIError("UNAUTHORIZED", { message: "OAuth session has ended. Sign in again." });
	}
	const [consent] = await db
		.select()
		.from(schema.oauthConsent)
		.where(and(eq(schema.oauthConsent.clientId, payload.azp), eq(schema.oauthConsent.userId, payload.sub)))
		.limit(1);
	if (
		!consent ||
		(payload.rr_grant_id !== undefined
			? payload.rr_grant_id !== consent.id
			: consent.createdAt && Math.floor(consent.createdAt.getTime() / 1000) >= Number(payload.iat)) ||
		(!scopes.some((scope) => scope.startsWith("api:")) && consent.scopes.some((scope) => scope.startsWith("api:"))) ||
		scopes.some((scope) => !consent.scopes.includes(scope))
	) {
		throw new APIError("UNAUTHORIZED", { message: "OAuth access has been revoked. Reconnect the application." });
	}
}

/**
 * Without `resource` the provider issues an opaque token that no API accepts, so the request is refused.
 * As RFC 6749 §4.1.2.1 requires, the error goes to the client's callback only when the client is enabled
 * and the callback matches its registration exactly. Returns that callback, or null to answer directly.
 */
async function missingResourceRedirect(params: Record<string, unknown> | undefined) {
	const clientId = typeof params?.client_id === "string" ? params.client_id : undefined;
	const redirectUri = typeof params?.redirect_uri === "string" ? params.redirect_uri : undefined;
	if (!clientId || !redirectUri) return null;
	const [client] = await db
		.select({ redirectUris: schema.oauthClient.redirectUris, disabled: schema.oauthClient.disabled })
		.from(schema.oauthClient)
		.where(eq(schema.oauthClient.clientId, clientId))
		.limit(1);
	if (!client || client.disabled || !client.redirectUris.includes(redirectUri)) return null;
	const target = new URL(redirectUri);
	target.searchParams.append("error", "invalid_target");
	target.searchParams.append("error_description", missingResourceDescription);
	if (typeof params?.state === "string") target.searchParams.append("state", params.state);
	target.searchParams.append("iss", oauthIssuer);
	return target.toString();
}

export function isCustomOAuthProviderEnabled() {
	const hasDiscovery = Boolean(env.OAUTH_DISCOVERY_URL);
	const hasManual =
		Boolean(env.OAUTH_AUTHORIZATION_URL) && Boolean(env.OAUTH_TOKEN_URL) && Boolean(env.OAUTH_USER_INFO_URL);

	return Boolean(env.OAUTH_CLIENT_ID) && Boolean(env.OAUTH_CLIENT_SECRET) && (hasDiscovery || hasManual);
}

const TRUSTED_ORIGINS = getTrustedOrigins(env.APP_URL);
const accountUser = new AsyncLocalStorage<User>();
const oauthProviderRateLimit = isRateLimitEnabled
	? rateLimitConfig.betterAuth.oauthProvider
	: ({
			register: false,
			authorize: false,
			token: false,
			introspect: false,
			revoke: false,
			userinfo: false,
		} as const);

// Better Auth 1.7 types generic-OAuth profile extras as `unknown`.
function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

// `@better-auth/oauth-provider@1.7.1` declares OpenAPI parameter metadata (`schema.items`) in a
// shape that is not `exactOptionalPropertyTypes`-clean, which stops the plugin from structurally
// satisfying `BetterAuthPlugin`. `metadata` only feeds doc generation, so dropping it from the
// endpoint types keeps request/response inference (`auth.api.*`) intact. Remove once upstream ships
// EOPT-compatible endpoint types.
type WithoutEndpointMetadata<TPlugin> = TPlugin extends { endpoints: infer TEndpoints }
	? Omit<TPlugin, "endpoints"> & {
			endpoints: {
				[K in keyof TEndpoints]: TEndpoints[K] extends {
					(...args: infer TArgs): infer TResult;
					options: infer TOptions;
					path: infer TPath;
				}
					? {
							(...args: TArgs): TResult;
							options: Omit<TOptions, "metadata">;
							path: TPath;
						}
					: TEndpoints[K];
			};
		}
	: TPlugin;

/** Prepare external resources before commit; optional cleanup runs only after commit. */
export type AccountLinkHook = (params: {
	fromUserId: string;
	toUserId: string;
	excludedStoragePrefixes: string[];
}) => Promise<(() => Promise<void>) | void>;

let accountLinkHook: AccountLinkHook | undefined;

/** Sets the one account-link hook; no argument clears it. */
export function setAccountLinkHook(hook?: AccountLinkHook): void {
	accountLinkHook = hook;
}

export async function linkAnonymousAccount({
	fromUserId,
	toUserId,
}: {
	fromUserId: string;
	toUserId: string;
}): Promise<void> {
	if (fromUserId === toUserId) return;

	const cleanup = await db.transaction(async (tx) => {
		// Match document/application writers' owner-first order; stable order prevents opposing-link deadlocks.
		for (const userId of [fromUserId, toUserId].sort()) {
			const [owner] = await tx
				.select({ id: schema.user.id })
				.from(schema.user)
				.where(eq(schema.user.id, userId))
				.for("no key update");
			if (!owner) throw new APIError("NOT_FOUND", { message: "The account is unavailable." });
		}

		const profiles = await tx
			.select()
			.from(schema.applicationProfile)
			.where(inArray(schema.applicationProfile.userId, [fromUserId, toUserId]));
		const sourceProfile = profiles.find((profile) => profile.userId === fromUserId);
		if (sourceProfile && profiles.some((profile) => profile.userId === toUserId))
			throw new APIError("CONFLICT", {
				message:
					"Both accounts have a private application profile. Export and delete one profile in Settings → Account before linking, so neither is silently overwritten.",
			});
		if (sourceProfile)
			await tx
				.update(schema.applicationProfile)
				.set({ userId: toUserId, revision: generateId() })
				.where(eq(schema.applicationProfile.userId, fromUserId));
		const sourceLanes = await tx
			.select()
			.from(schema.applicationLane)
			.where(eq(schema.applicationLane.userId, fromUserId));
		const targetLanes = await tx
			.select()
			.from(schema.applicationLane)
			.where(eq(schema.applicationLane.userId, toUserId));
		const defaultLanes = createDefaultOwnedApplicationLanes(toUserId);
		const targetActiveCount = targetLanes.length
			? targetLanes.filter((lane) => !lane.retiredAt).length
			: defaultLanes.length;
		if (
			targetActiveCount + sourceLanes.filter((lane) => !lane.systemKey && !lane.retiredAt).length >
			MAX_APPLICATION_LANES
		)
			throw new APIError("CONFLICT", {
				message:
					"Retire unused application lanes before combining these accounts; the combined pipeline exceeds 40 active lanes.",
			});
		await tx.insert(schema.applicationPipeline).values({ userId: toUserId }).onConflictDoNothing();
		await tx.insert(schema.applicationLane).values(defaultLanes).onConflictDoNothing();
		const laneIds = new Map<string, string>();
		let position = Math.max(5, ...targetLanes.map((lane) => lane.position)) + 1;
		for (const lane of sourceLanes) {
			const id = lane.systemKey
				? (targetLanes.find((target) => target.systemKey === lane.systemKey)?.id ??
					`application-lane:${toUserId}:${lane.systemKey}`)
				: generateId();
			laneIds.set(lane.id, id);
			if (!lane.systemKey)
				await tx.insert(schema.applicationLane).values({ ...lane, id, userId: toUserId, position: position++ });
		}
		await tx
			.update(schema.applicationPipeline)
			.set({ revision: sql`${schema.applicationPipeline.revision} + 1` })
			.where(eq(schema.applicationPipeline.userId, toUserId));

		const rewriteUploadsJson = (column: unknown) =>
			sql`cast(replace(cast(${column} as text), 'uploads/' || ${fromUserId} || '/', 'uploads/' || ${toUserId} || '/') as jsonb)`;

		const rewriteUploadsUrl = (column: unknown) =>
			sql`case when ${column} is not null then replace(${column}, 'uploads/' || ${fromUserId} || '/', 'uploads/' || ${toUserId} || '/') else null end`;

		// A guest who published has an auto-claimed primary resume. The target account may already have one, and an
		// account holds at most one (`resume_primary_unique`), so the move drops the guest's role first. The role is
		// restored below only when the target has none: the guest's work must never displace the target's primary.
		const [guestPrimary] = await tx
			.select({ id: schema.resume.id })
			.from(schema.resume)
			.where(and(eq(schema.resume.userId, fromUserId), eq(schema.resume.isPrimary, true)))
			.for("update");
		// An existing account may already use a slug; suffix the guest's copy to keep (user, slug) unique.
		await tx
			.update(schema.resume)
			.set({
				userId: toUserId,
				slug: sql`case when exists (select 1 from resume r where r.user_id = ${toUserId} and r.slug = resume.slug) then resume.slug || '-' || right(resume.id, 6) else resume.slug end`,
				isPrimary: false,
				data: rewriteUploadsJson(schema.resume.data),
			})
			.where(eq(schema.resume.userId, fromUserId));
		// Keep the guest's published resume as the target's primary when the target has none. Its own savepoint keeps
		// the link intact if another writer claims the role at the same moment; that writer's primary then wins.
		if (guestPrimary) {
			try {
				await tx.transaction((savepoint) =>
					savepoint
						.update(schema.resume)
						.set({ isPrimary: true })
						.where(
							and(
								eq(schema.resume.id, guestPrimary.id),
								eq(schema.resume.userId, toUserId),
								sql`not exists (select 1 from resume r where r.user_id = ${toUserId} and r.is_primary)`,
							),
						),
				);
			} catch (error) {
				if ((error as { cause?: { constraint?: string } } | null)?.cause?.constraint !== "resume_primary_unique")
					throw error;
			}
		}

		await tx
			.update(schema.resumeVersion)
			.set({
				userId: toUserId,
				data: rewriteUploadsJson(schema.resumeVersion.data),
			})
			.where(eq(schema.resumeVersion.userId, fromUserId));

		await tx
			.update(schema.coverLetter)
			.set({
				userId: toUserId,
				style: rewriteUploadsJson(schema.coverLetter.style),
			})
			.where(eq(schema.coverLetter.userId, fromUserId));

		await tx
			.update(schema.coverLetterVersion)
			.set({
				userId: toUserId,
				data: rewriteUploadsJson(schema.coverLetterVersion.data),
			})
			.where(eq(schema.coverLetterVersion.userId, fromUserId));

		const applications = await tx
			.select()
			.from(schema.application)
			.where(eq(schema.application.userId, fromUserId))
			.for("update");
		for (const application of applications) {
			await tx
				.update(schema.application)
				.set({
					userId: toUserId,
					laneId: application.laneId
						? (laneIds.get(application.laneId) ?? `application-lane:${toUserId}:${application.status}`)
						: `application-lane:${toUserId}:${application.status}`,
					activity: application.activity.map((entry) =>
						entry.type === "stage" && entry.laneId && laneIds.has(entry.laneId)
							? { ...entry, laneId: laneIds.get(entry.laneId) ?? entry.laneId }
							: entry,
					),
					resumeFileUrl: rewriteUploadsUrl(schema.application.resumeFileUrl),
					coverLetterUrl: rewriteUploadsUrl(schema.application.coverLetterUrl),
				})
				.where(and(eq(schema.application.id, application.id), eq(schema.application.userId, fromUserId)));
		}

		const sourceAnswers = await tx.select().from(schema.careerAnswer).where(eq(schema.careerAnswer.userId, fromUserId));
		const targetAnswers = await tx.select().from(schema.careerAnswer).where(eq(schema.careerAnswer.userId, toUserId));
		if (sourceAnswers.some((answer) => targetAnswers.some((target) => target.duplicateKey === answer.duplicateKey)))
			throw new APIError("CONFLICT", {
				message:
					"Both accounts have duplicate saved application answers. Export and delete one copy before linking, so neither is silently overwritten.",
			});
		// Preserve wording; the Knowledge facts the answers cite move with them below.
		await tx
			.update(schema.careerAnswer)
			.set({ userId: toUserId, updatedAt: schema.careerAnswer.updatedAt })
			.where(eq(schema.careerAnswer.userId, fromUserId));

		// The guest was invited to build Knowledge like any user: facts, stories and the career profile move too. A fact
		// the account already holds from the same source stays the account's; the guest's copy goes with the guest.
		await tx
			.update(schema.careerFact)
			.set({ userId: toUserId })
			.where(
				and(
					eq(schema.careerFact.userId, fromUserId),
					sql`not exists (select 1 from career_fact f where f.user_id = ${toUserId} and f.source_key = career_fact.source_key)`,
				),
			);
		await tx.update(schema.careerStory).set({ userId: toUserId }).where(eq(schema.careerStory.userId, fromUserId));
		await tx
			.update(schema.careerProfile)
			.set({ userId: toUserId })
			.where(
				and(
					eq(schema.careerProfile.userId, fromUserId),
					sql`not exists (select 1 from career_profile p where p.user_id = ${toUserId})`,
				),
			);

		await tx
			.delete(schema.resumeSlugRedirect)
			.where(
				and(
					eq(schema.resumeSlugRedirect.userId, fromUserId),
					sql`exists (select 1 from resume_slug_redirect rsr where rsr.user_id = ${toUserId} and rsr.slug = resume_slug_redirect.slug)`,
				),
			);

		await tx
			.update(schema.resumeSlugRedirect)
			.set({ userId: toUserId })
			.where(eq(schema.resumeSlugRedirect.userId, fromUserId));

		// Ownership updates lock document rows, so guest saves cannot add uncopied references during copying.
		const hook = accountLinkHook;
		if (!hook) return;
		const erasures = await tx
			.select({ storageKey: schema.storageCleanupJob.storageKey })
			.from(schema.storageCleanupJob)
			.where(eq(schema.storageCleanupJob.ownerId, fromUserId));
		return hook({ fromUserId, toUserId, excludedStoragePrefixes: erasures.map(({ storageKey }) => storageKey) });
	});

	try {
		await cleanup?.();
	} catch (error) {
		console.warn("Failed to clean up linked account resources:", error);
	}
}

type GuestLink = Parameters<NonNullable<AnonymousOptions["onLinkAccount"]>>[0];

async function moveGuestWork({ anonymousUser, newUser, ctx }: GuestLink): Promise<void> {
	try {
		await linkAnonymousAccount({
			fromUserId: anonymousUser.user.id,
			toUserId: newUser.user.id,
		});
	} catch (error) {
		// Better Auth sets the new session cookie before this runs. A failed transfer must leave the
		// guest accessible, and must not expose a usable credential-session cookie on the error reply.
		deleteSessionCookie(ctx);
		await setSessionCookie(ctx, anonymousUser, undefined, {
			maxAge: Math.max(0, Math.floor((anonymousUser.session.expiresAt.getTime() - Date.now()) / 1000)),
		});
		await ctx.context.internalAdapter.deleteSession(newUser.session.token).catch(() => {});
		if (isAPIError(error)) throw error;
		// Better Auth keeps these cookies only on an APIError reply; any other error drops them.
		console.error("Failed to move guest work to account %s:", newUser.user.id, error);
		throw new APIError("INTERNAL_SERVER_ERROR", {
			message: "The guest work could not be moved to this account. Try again.",
		});
	}
}

// Better Auth 1.7 keeps this name internal to its two-factor plugin.
const TWO_FACTOR_COOKIE = "two_factor";
const guestLinkIdentifier = (userId: string, challenge: string) => `guest-link:${userId}:${challenge}`;
const isTwoFactorVerification = (path: string | undefined) =>
	path === "/two-factor/verify-totp" || path === "/two-factor/verify-backup-code" || path === "/two-factor/verify-otp";

/** Read before a verification request runs; it carries the guest through to that request's after-hook. */
type GuestHandoff = { userId: string; challengeId: string; guestId: string };

// The anonymous plugin moves guest work only when a sign-in reply sets a session. With two-step verification,
// the password step sets none and the verification step is outside the plugin's matcher. This plugin stores the
// guest's id server-side, keyed by the account and the signed, single-use two-factor challenge, and moves the
// work when that challenge succeeds for that account.
const twoFactorGuestLink = {
	id: "two-factor-guest-link",
	hooks: {
		before: [
			{
				matcher: (ctx) => isTwoFactorVerification(ctx.path),
				handler: createAuthMiddleware(async (ctx) => {
					// Read the handoff before the endpoint accepts the challenge. Both expire together, so a challenge the
					// endpoint accepts had a live handoff here, even if the deadline passes while its session is created.
					const challengeId = await ctx.getSignedCookie(
						ctx.context.createAuthCookie(TWO_FACTOR_COOKIE).name,
						ctx.context.secret,
					);
					if (!challengeId) return;
					const internal = ctx.context.internalAdapter;
					// These lookups return expired rows too.
					const challenge = await internal.findVerificationValue(challengeId);
					if (!challenge || challenge.expiresAt <= new Date()) return;
					const link = await internal.findVerificationValue(guestLinkIdentifier(challenge.value, challengeId));
					if (!link || link.expiresAt <= new Date()) return;
					const guestHandoff: GuestHandoff = { userId: challenge.value, challengeId, guestId: link.value };
					return { context: { context: { guestHandoff } } };
				}),
			},
		],
		after: [
			{
				matcher: (ctx) => ctx.path === "/sign-in/email" || ctx.path === "/sign-in/username",
				handler: createAuthMiddleware(async (ctx) => {
					const cookieName = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE).name;
					// Our own reply's signed value: `<identifier>.<signature>`, URL-encoded.
					const signed = parseSetCookieHeader(ctx.context.responseHeaders?.get("set-cookie") ?? "").get(cookieName);
					const challengeId = signed && decodeURIComponent(signed.value).split(".")[0];
					if (!challengeId) return;
					const challenge = await ctx.context.internalAdapter.findVerificationValue(challengeId);
					if (!challenge) return;
					const guest = await getSessionFromCtx(ctx, { disableRefresh: true });
					if (!guest?.user.isAnonymous) return;
					await ctx.context.internalAdapter.createVerificationValue({
						identifier: guestLinkIdentifier(challenge.value, challengeId),
						value: guest.user.id,
						expiresAt: challenge.expiresAt,
					});
				}),
			},
			{
				matcher: (ctx) => isTwoFactorVerification(ctx.path),
				handler: createAuthMiddleware(async (ctx) => {
					const { guestHandoff: handoff } = ctx.context as { guestHandoff?: GuestHandoff };
					const newUser = ctx.context.newSession;
					if (!handoff || newUser?.user.id !== handoff.userId) return;
					const internal = ctx.context.internalAdapter;
					// The endpoint consumes the challenge, atomically, before it signs in. A challenge still stored means
					// this request did not accept it; one gone means this request was its only acceptance.
					if (await internal.findVerificationValue(handoff.challengeId)) return;
					// The anonymous plugin's schema adds this column; the adapter types only the core user.
					const user = (await internal.findUserById(handoff.guestId)) as UserWithAnonymous | null;
					if (!user?.isAnonymous) return;
					// Like the anonymous plugin, only a guest that can still sign in is linked, and kept on failure.
					const [session] = await internal.listSessions(user.id, { onlyActiveSessions: true });
					if (!session) return;
					try {
						await moveGuestWork({ anonymousUser: { user, session }, newUser, ctx });
						await internal.deleteUser(user.id).catch((error: unknown) => {
							ctx.context.logger.error("Failed to delete the linked guest account", { userId: user.id, error });
						});
					} finally {
						// The consumed challenge prevents replay; expiring bookkeeping must not undo a transfer or its recovery.
						await internal
							.deleteVerificationByIdentifier(guestLinkIdentifier(handoff.userId, handoff.challengeId))
							.catch(() => ctx.context.logger.warn("Failed to clean up completed guest-link marker"));
					}
				}),
			},
		],
	},
} satisfies BetterAuthPlugin;

const getAuthConfig = () => {
	const authConfigs: GenericOAuthConfig[] = [];

	if (isCustomOAuthProviderEnabled()) {
		authConfigs.push({
			providerId: "custom",
			disableSignUp: env.FLAG_DISABLE_SIGNUPS,
			clientId: env.OAUTH_CLIENT_ID as string,
			clientSecret: env.OAUTH_CLIENT_SECRET as string,
			discoveryUrl: env.OAUTH_DISCOVERY_URL,
			authorizationUrl: env.OAUTH_AUTHORIZATION_URL,
			tokenUrl: env.OAUTH_TOKEN_URL,
			userInfoUrl: env.OAUTH_USER_INFO_URL,
			scopes: env.OAUTH_SCOPES,
			// Better Auth 1.7 folds generic OAuth providers into `socialProviders`, so the callback
			// is served by `/callback/:id` — the old `/oauth2/callback/:id` route no longer exists.
			redirectURI: `${authBaseUrl}/api/auth/callback/custom`,
			mapProfileToUser: createProfileMapper<GenericOAuthUserInfo>({
				providerName: "OAuth Provider",
				getPreferredUsername: (profile, context) => asString(profile.preferred_username) ?? context.emailLocalPart,
				getName: (profile, context) =>
					asString(profile.name) ?? asString(profile.preferred_username) ?? context.emailLocalPart,
				getImage: (profile) => asString(profile.image) ?? asString(profile.picture) ?? asString(profile.avatar_url),
			}),
		} satisfies GenericOAuthConfig);
	}

	return betterAuth({
		appName: "Reactive Resume",
		baseURL: authBaseUrl,
		secret: env.AUTH_SECRET,

		database: drizzleAdapter(db, { schema, provider: "pg" }),

		telemetry: { enabled: false },
		trustedOrigins: [
			...TRUSTED_ORIGINS,
			// Apple's form_post callback includes this origin; keep CSRF checks enabled.
			...(env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET ? ["https://appleid.apple.com"] : []),
		],
		rateLimit: {
			...rateLimitConfig.betterAuth.global,
			...(authRateLimitStorage ? { customStorage: authRateLimitStorage } : {}),
			enabled: isRateLimitEnabled,
		},

		databaseHooks: {
			user: {
				create: {
					before: async (user, context) => {
						// New accounts inherit the device timezone from the auth request, so interview times,
						// reminders and schedules are right from the first use. Social callbacks don't carry the
						// header; the sign-in hook stores the validated zone in the signed OAuth state.
						const fromHeader = timezoneSchema.safeParse(context?.headers?.get("x-client-timezone"));
						// Direct calls outside an auth request have no OAuth state to read.
						const oauthState = context ? await getOAuthState().catch(() => null) : null;
						const fromOAuth = timezoneSchema.safeParse(oauthState?.serverContext?.timezone);
						const timezone = fromHeader.success ? fromHeader.data : fromOAuth.success ? fromOAuth.data : undefined;
						// The interface language the account was made in, for its first emails. Like the timezone, a social
						// sign-up reads it from the OAuth state, because a cross-site callback may arrive without cookies.
						const fromOAuthLocale = oauthState?.serverContext?.locale;
						const locale = requestLocale(context?.headers) ?? (isLocale(fromOAuthLocale) ? fromOAuthLocale : undefined);
						const data = { ...user, ...(timezone ? { timezone } : {}), ...(locale ? { locale } : {}) };
						if (!user.isAnonymous) return timezone || locale ? { data } : undefined;

						// Guests sign in without a username. The tail of a UUIDv7 is random; its head is a timestamp.
						const username = `guest-${generateId().slice(-12)}`;
						return { data: { ...data, username, displayUsername: username } };
					},
				},
			},
		},

		// Unused endpoints: guest deletion skips the app's storage cleanup; the session JWT has no consumer.
		disabledPaths: ["/delete-anonymous-user", "/token"],

		hooks: {
			before: createAuthMiddleware(async (ctx) => {
				if (ctx.path === "/oauth2/authorize") {
					// Read the request the way the provider does: a direct POST carries it in the form body, while
					// continue and consent re-enter this endpoint with the signed query.
					const isFormPost =
						ctx.request?.method === "POST" && new URL(ctx.request.url).pathname.endsWith("/oauth2/authorize");
					const params = (isFormPost ? ctx.body : ctx.query) as Record<string, unknown> | undefined;
					if (!params?.resource) {
						const redirect = await missingResourceRedirect(params);
						if (redirect) throw ctx.redirect(redirect);
						return ctx.json(
							{ error: "invalid_target", error_description: missingResourceDescription },
							{ status: 400 },
						);
					}
				}
				if (ctx.path === "/oauth2/public-client-prelogin") {
					// The provider checks only that oauth_query is signed and unexpired. Tie the requested client to that
					// signed request, so a request for one client can't read another client's public details.
					const body = ctx.body as { client_id?: unknown; oauth_query?: unknown } | undefined;
					const signedClientId =
						typeof body?.oauth_query === "string" ? new URLSearchParams(body.oauth_query).get("client_id") : null;
					if (!signedClientId || body?.client_id !== signedClientId) {
						throw new APIError("BAD_REQUEST", { error: "invalid_request", error_description: "client_id mismatch" });
					}
				}
				if (ctx.path === "/oauth2/consent") {
					const current = await getSessionFromCtx(ctx, { disableCookieCache: true });
					// Denying grants nothing and returns the guest to the client with access_denied.
					if (current?.user.isAnonymous && (ctx.body as { accept?: unknown } | undefined)?.accept !== false) {
						throw new APIError("FORBIDDEN", {
							message: "Create an account to connect apps. Guest accounts are temporary.",
						});
					}
				}
				if (ctx.path === "/sign-in/social") {
					const timezone = timezoneSchema.safeParse(ctx.headers?.get("x-client-timezone"));
					// Keep the device timezone across the provider redirect in server-only state, so the
					// callback can start a new account there without trusting redirect parameters.
					const locale = requestLocale(ctx.headers);
					if (timezone.success || locale)
						await addOAuthServerContext({
							...(timezone.success ? { timezone: timezone.data } : {}),
							...(locale ? { locale } : {}),
						});
				}

				if (ctx.path === "/sign-up/email" && ctx.body && typeof ctx.body.email === "string") {
					// The username is optional at sign-up: an empty one is made from the email address, changeable in Settings.
					const chosen = [ctx.body.username, ctx.body.displayUsername].some(
						(value: unknown) => typeof value === "string" && value.trim(),
					);
					if (!chosen) {
						const username = await allocateUniqueUsername(ctx.body.email);
						ctx.body.username = username;
						ctx.body.displayUsername = username;
					}
				}

				const user = accountUser.getStore();
				// Sign-up copies displayUsername into username when username is missing, so either one claims the name.
				const requestedUsername: unknown = ctx.body?.username ?? ctx.body?.displayUsername;
				if (
					typeof requestedUsername === "string" &&
					["/sign-up/email", "/update-user", "/is-username-available"].includes(ctx.path)
				) {
					const claimant =
						user?.id ??
						(ctx.path === "/update-user"
							? (await auth.api.getSession({ headers: ctx.headers ?? new Headers() }))?.user.id
							: undefined);
					if (await isUsernameReserved(toUsername(requestedUsername), claimant))
						throw new APIError("UNPROCESSABLE_ENTITY", {
							code: "USERNAME_IS_ALREADY_TAKEN",
							message: "This username is already taken. Choose another.",
						});
				}
				if (user && !ctx.request && ["/update-user", "/api-key/list", "/api-key/delete"].includes(ctx.path)) {
					// Internal account calls reuse session-only hooks without creating a browser credential.
					return {
						context: {
							context: {
								session: {
									user,
									session: {
										id: "",
										token: "",
										userId: user.id,
										createdAt: new Date(0),
										updatedAt: new Date(0),
										expiresAt: new Date(0),
									},
								},
							},
						},
					};
				}
				if (ctx.path === "/sign-in/anonymous" && (!env.FLAG_ENABLE_GUEST_LOGIN || env.FLAG_DISABLE_SIGNUPS)) {
					throw new APIError("FORBIDDEN", {
						message: "Guest access is turned off on this server. Create an account or sign in.",
					});
				}
				if (ctx.path === "/verify-email") {
					// A verification link signs in as its account, and the anonymous plugin would then move the
					// guest's documents into it, even when the link belongs to someone else.
					const current = await auth.api.getSession({ headers: ctx.headers ?? new Headers() });
					if (current?.user.isAnonymous) {
						throw new APIError("FORBIDDEN", {
							message: "Sign out of the guest session before verifying an email address.",
						});
					}
					return;
				}
				if (ctx.path === "/sign-in/username" && env.FLAG_DISABLE_EMAIL_AUTH)
					throw new APIError("FORBIDDEN", { message: "Password sign-in is turned off on this server." });
				// Internal issuance is gated by the application's session-only, recent-sign-in procedure.
				if (ctx.path === "/api-key/create" && !ctx.request) return;
				if (
					["/passkey/generate-register-options", "/passkey/verify-registration", "/api-key/create"].includes(ctx.path)
				) {
					// freshAge is 0 so old sessions can unlink providers; adding a passkey still needs a recent sign-in.
					const current = await auth.api.getSession({
						headers: ctx.headers ?? new Headers(),
						query: { disableCookieCache: true },
					});
					if (!current) throw new APIError("UNAUTHORIZED");
					if (ctx.path.startsWith("/passkey/") && !current.user.emailVerified)
						throw new APIError("FORBIDDEN", { message: "Verify your email address before adding a passkey." });
					const age = Date.now() - new Date(current.session.createdAt).getTime();
					if (!Number.isFinite(age) || age < 0 || age > 24 * 60 * 60 * 1000) {
						throw new APIError("FORBIDDEN", { message: "For your security, sign in again to add a credential." });
					}
					return;
				}
				if (ctx.path === "/oauth2/delete-consent") {
					const origin = ctx.headers?.get("origin");
					if ((origin && !TRUSTED_ORIGINS.includes(origin)) || ctx.headers?.get("sec-fetch-site") === "cross-site") {
						throw new APIError("FORBIDDEN", { message: "Cross-origin consent changes are not allowed." });
					}
					const current = await auth.api.getSession({
						headers: ctx.headers ?? new Headers(),
						query: { disableCookieCache: true },
					});
					const id = ctx.body?.id;
					if (!current || typeof id !== "string") throw new APIError("UNAUTHORIZED");
					const [consent] = await db
						.select()
						.from(schema.oauthConsent)
						.where(and(eq(schema.oauthConsent.id, id), eq(schema.oauthConsent.userId, current.user.id)))
						.limit(1);
					if (!consent) throw new APIError("NOT_FOUND");
					// Native consent deletion alone leaves refresh tokens usable. Revoke
					// the grant's stored tokens before removing its consent.
					const revoked = new Date();
					await db
						.update(schema.oauthRefreshToken)
						.set({ revoked })
						.where(
							and(
								eq(schema.oauthRefreshToken.clientId, consent.clientId),
								eq(schema.oauthRefreshToken.userId, current.user.id),
							),
						);
					await db
						.update(schema.oauthAccessToken)
						.set({ revoked })
						.where(
							and(
								eq(schema.oauthAccessToken.clientId, consent.clientId),
								eq(schema.oauthAccessToken.userId, current.user.id),
							),
						);
					return;
				}
				if (!ctx.path.includes("/oauth2/register")) return;

				const body = ctx.body as { redirect_uris?: unknown } | undefined;
				const redirectUris = Array.isArray(body?.redirect_uris) ? body.redirect_uris : [];

				for (const uri of redirectUris) {
					if (typeof uri !== "string") {
						throw new APIError("BAD_REQUEST", { message: "redirect_uris entries must be strings" });
					}
					if (
						!isAllowedOAuthRedirectUri(uri, TRUSTED_ORIGINS, {
							allowUnsafe: env.FLAG_ALLOW_UNSAFE_OAUTH_REDIRECT_URI,
						})
					) {
						throw new APIError("BAD_REQUEST", {
							message: "redirect_uri is not allowed for dynamic client registration",
						});
					}
				}
			}),
			after: createAuthMiddleware(async (ctx) => {
				const payload = ctx.context.returned as JWTPayload | undefined;
				if (ctx.path === "/oauth2/public-client-prelogin" && payload && typeof payload.client_id === "string") {
					return ctx.json({ client_id: payload.client_id, client_name: payload.client_name });
				}
				// Run after the provider authenticates the introspecting client and verifies the token.
				if (ctx.path !== "/oauth2/introspect" || !payload || payload.active !== true || typeof payload.azp !== "string")
					return;
				try {
					await validateOAuthGrant(payload);
				} catch (error) {
					// Only a refused grant makes the token inactive; a failed lookup is a server error, not a revocation.
					if (!isAPIError(error) || error.statusCode !== 401) throw error;
					return ctx.json({ active: false });
				}
			}),
		},

		// Without this, OAuth callback failures land on Better Auth's built-in `/api/auth/error`
		// page. It also backs the `oauthProvider` plugin's authorization errors that happen before
		// `redirect_uri` is validated and so cannot be returned to the requesting client.
		onAPIError: { errorURL: "/auth/error" },

		advanced: {
			database: { generateId, joins: true },
			useSecureCookies: authBaseUrl.startsWith("https://"),
			ipAddress: { ipAddressHeaders: ["X-Real-IP"] },
		},

		emailAndPassword: {
			enabled: !env.FLAG_DISABLE_EMAIL_AUTH,
			autoSignIn: true,
			minPasswordLength: 8,
			maxPasswordLength: 64,
			requireEmailVerification: false,
			disableSignUp: env.FLAG_DISABLE_SIGNUPS || env.FLAG_DISABLE_EMAIL_AUTH,
			sendResetPassword: async ({ user, url }, request) => {
				await sendEmail({ to: user.email, ...resetPasswordEmail({ url, locale: accountEmailLocale(user, request) }) });
			},
			revokeSessionsOnPasswordReset: true,
			// The reset link proved control of the inbox. Drop credentials someone else may hold, such as on an
			// account registered with this address before its owner.
			onPasswordReset: async ({ user }) => {
				await db.transaction(async (tx) => {
					await tx.delete(schema.apikey).where(eq(schema.apikey.referenceId, user.id));
					await tx.delete(schema.oauthAccessToken).where(eq(schema.oauthAccessToken.userId, user.id));
					await tx.delete(schema.oauthRefreshToken).where(eq(schema.oauthRefreshToken.userId, user.id));
					await tx.delete(schema.oauthConsent).where(eq(schema.oauthConsent.userId, user.id));
					// Historical passkeys may predate mailbox verification; recovery revokes all of them.
					await tx.delete(schema.passkey).where(eq(schema.passkey.userId, user.id));
					// Nobody had proved this address before: whoever signed up with it may have added other ways in.
					if (!user.emailVerified) {
						await tx.delete(schema.twoFactor).where(eq(schema.twoFactor.userId, user.id));
						await tx
							.delete(schema.account)
							.where(and(eq(schema.account.userId, user.id), ne(schema.account.providerId, "credential")));
					}
					await tx
						.update(schema.user)
						.set({ emailVerified: true, ...(user.emailVerified ? {} : { twoFactorEnabled: false }) })
						.where(eq(schema.user.id, user.id));
				});
			},
			password: {
				hash: (password) => hash(password, 10),
				verify: ({ password, hash }) => compare(password, hash),
			},
		},

		emailVerification: {
			sendOnSignUp: true,
			autoSignInAfterVerification: true,
			sendVerificationEmail: async ({ user, url }, request) => {
				await sendEmail({ to: user.email, ...verifyEmail({ url, locale: accountEmailLocale(user, request) }) });
			},
		},

		user: {
			changeEmail: {
				enabled: true,
				// Better Auth's two-step change: the current address approves first, then the new address gets its own
				// verification link. Sending this step to the new address would let anyone holding a session move the
				// account to an address they control without the owner's approval.
				sendChangeEmailConfirmation: async ({ user, newEmail, url }, request) => {
					const locale = accountEmailLocale(user, request);
					await sendEmail({
						to: user.email,
						...verifyEmailChange({ url, previousEmail: user.email, newEmail, locale }),
					});
				},
			},
			additionalFields: {
				username: {
					type: "string",
					required: true,
				},
				timezone: {
					type: "string",
					required: false,
					defaultValue: "UTC",
					validator: { input: timezoneSchema },
				},
				locale: {
					type: "string",
					required: false,
					validator: { input: localeSchema },
				},
			},
		},

		// Better Auth gates `/unlink-account` (and `/list-sessions`) behind a "fresh"
		// session, which defaults to one day old. Sessions here live for a week and
		// there is no re-authentication flow to refresh that timestamp, so disconnecting
		// a provider failed with `SESSION_NOT_FRESH` for anyone who signed in yesterday.
		session: { freshAge: 0 },

		account: {
			// Linking by email needs the provider to report that email as verified.
			accountLinking: { enabled: true },
			encryptOAuthTokens: true,
		},

		socialProviders: {
			apple: {
				enabled: !!env.APPLE_CLIENT_ID && !!env.APPLE_CLIENT_SECRET,
				disableSignUp: env.FLAG_DISABLE_SIGNUPS,
				clientId: env.APPLE_CLIENT_ID ?? "",
				clientSecret: env.APPLE_CLIENT_SECRET ?? "",
				mapProfileToUser: createProfileMapper({
					providerName: "Apple",
					getName: (profile, context) => profile.name || context.emailLocalPart,
				}),
			},

			google: {
				enabled: !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET,
				disableSignUp: env.FLAG_DISABLE_SIGNUPS,
				clientId: env.GOOGLE_CLIENT_ID ?? "",
				clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
				mapProfileToUser: createProfileMapper({
					providerName: "Google",
					getName: (profile, context) => profile.name ?? context.emailLocalPart,
					getImage: (profile) => profile.picture,
				}),
			},

			github: {
				enabled: !!env.GITHUB_CLIENT_ID && !!env.GITHUB_CLIENT_SECRET,
				disableSignUp: env.FLAG_DISABLE_SIGNUPS,
				clientId: env.GITHUB_CLIENT_ID ?? "",
				clientSecret: env.GITHUB_CLIENT_SECRET ?? "",
				mapProfileToUser: createGithubProfileMapper(),
			},

			linkedin: {
				enabled: !!env.LINKEDIN_CLIENT_ID && !!env.LINKEDIN_CLIENT_SECRET,
				disableSignUp: env.FLAG_DISABLE_SIGNUPS,
				clientId: env.LINKEDIN_CLIENT_ID ?? "",
				clientSecret: env.LINKEDIN_CLIENT_SECRET ?? "",
				mapProfileToUser: createProfileMapper({
					providerName: "LinkedIn",
					getName: (profile, context) => profile.name ?? context.emailLocalPart,
					getImage: (profile) => profile.picture,
				}),
			},
		},

		plugins: [
			// JSON schema only; no reference-page inline scripts need a CSP nonce.
			openAPI({ disableDefaultReference: true }),
			jwt({ disableSettingJwtHeader: true }),
			admin(),
			passkey(),
			genericOAuth({ config: authConfigs }),
			twoFactor({ issuer: "Reactive Resume" }),
			apiKey({
				enableSessionForAPIKeys: false,
				rateLimit: {
					...rateLimitConfig.betterAuth.apiKey,
					enabled: isRateLimitEnabled,
				},
			}),
			oauthProvider({
				loginPage: "/api/auth/oauth",
				consentPage: "/auth/consent",
				signup: {
					page: "/api/auth/oauth",
					shouldRedirect: ({ user }) => ("isAnonymous" in user && user.isAnonymous === true ? "/auth/consent" : false),
				},
				scopes: ["openid", "profile", "email", "offline_access", "api:read", "api:write", "api:delete"],
				extensions: [
					{
						claims: {
							userInfo: async ({ jwt }) => {
								try {
									await validateOAuthGrant(jwt);
								} catch (error) {
									if (!isAPIError(error) || error.statusCode !== 401) throw error;
									throw new APIError("UNAUTHORIZED", {
										error: "invalid_token",
										error_description: "Reconnect the application to restore access.",
									});
								}
								return {};
							},
							accessToken: async ({ user, client }) => {
								if (!user) return {};
								if (user.isAnonymous)
									throw new APIError("FORBIDDEN", { message: "Guest accounts cannot connect apps." });
								const [consent] = await db
									.select({ id: schema.oauthConsent.id })
									.from(schema.oauthConsent)
									.where(
										and(eq(schema.oauthConsent.clientId, client.clientId), eq(schema.oauthConsent.userId, user.id)),
									)
									.limit(1);
								return { rr_grant_id: consent?.id ?? null };
							},
						},
					},
				],
				resources: OAUTH_AUDIENCES,
				clientRegistrationDefaultResources: OAUTH_AUDIENCES,
				allowDynamicClientRegistration: true,
				// Required for MCP client onboarding (RFC 7591). Redirect URI validation
				// and explicit user consent protect access by dynamically registered clients.
				allowUnauthenticatedClientRegistration: true,
				// Desktop MCP clients (Cursor, older Claude Code) omit application_type while registering
				// loopback or custom-scheme callbacks; register those as native. An explicit type is kept.
				clientRegistrationDefaultApplicationType: "infer",
				// The consent page loads the client through this endpoint, which verifies the signed request first.
				allowPublicClientPrelogin: true,
				rateLimit: oauthProviderRateLimit,
				silenceWarnings: { oauthAuthServerConfig: true },
			}) as WithoutEndpointMetadata<ReturnType<typeof oauthProvider>>,
			username({
				minUsernameLength: 3,
				maxUsernameLength: 64,
				usernameNormalization: (value) => toUsername(value),
				displayUsernameNormalization: (value) => toUsername(value),
				usernameValidator: (username) => /^[a-z0-9._-]+$/.test(username),
				validationOrder: { username: "post-normalization", displayUsername: "post-normalization" },
			}),
			// After twoFactor, whose sign-in hook creates the challenge this binds the guest to. Like the anonymous plugin,
			// after oauthProvider: an OAuth login must not continue with the guest session a failed move restores.
			twoFactorGuestLink,
			anonymous({
				emailDomainName: "reactive-resume.local",
				generateName: () => "Guest",
				// Signing up or in from a guest session moves the guest's documents to that account; the plugin then
				// deletes the guest account, along with anything not moved here (assistant threads, career data).
				onLinkAccount: moveGuestWork,
			}),
			...(env.BETTER_AUTH_API_KEY
				? [dash({ apiKey: env.BETTER_AUTH_API_KEY, activityTracking: { enabled: true } })]
				: []),
		],
	});
};

type Auth = ReturnType<typeof getAuthConfig>;

let authInstance: Auth | undefined;

function getAuthInstance(): Auth {
	if (authInstance) return authInstance;

	const instance = getAuthConfig();
	authInstance = instance;
	// A rejected Better Auth context cannot recover. Let the next request rebuild it.
	void instance.$context.catch(() => {
		if (authInstance === instance) authInstance = undefined;
	});
	return instance;
}

// Keep initialization inside a request or explicit deployment preparation, not module evaluation.
export const auth: Auth = new Proxy({} as Auth, {
	get(_target, property) {
		const instance = getAuthInstance();
		return Reflect.get(instance, property, instance);
	},
});

type ProfileUpdate = { name?: string; username?: string; image?: string | null; timezone?: string; locale?: string };

// Only these server calls can install the identity; their cookie headers never leave this module.
export const accountAuth = {
	updateProfile: (user: User, body: ProfileUpdate) =>
		accountUser.run(user, () =>
			auth.api.updateUser({
				body: { ...body, ...(body.username !== undefined ? { displayUsername: body.username } : {}) },
			}),
		),
	listApiKeys: (user: User) => accountUser.run(user, () => auth.api.listApiKeys({})),
	deleteApiKey: (user: User, keyId: string) => accountUser.run(user, () => auth.api.deleteApiKey({ body: { keyId } })),
};

export async function initializeAuth(): Promise<void> {
	await auth.$context;
}
