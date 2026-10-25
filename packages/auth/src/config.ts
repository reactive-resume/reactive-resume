import type { User } from "better-auth";
import type { GenericOAuthConfig, GenericOAuthUserInfo } from "better-auth/plugins";
import type { JWTPayload } from "jose";
import { AsyncLocalStorage } from "node:async_hooks";
import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { dash } from "@better-auth/infra";
import { oauthProvider } from "@better-auth/oauth-provider";
import { passkey } from "@better-auth/passkey";
import { compare, hash } from "bcryptjs";
import { APIError, betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { admin, anonymous, jwt, openAPI } from "better-auth/plugins";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { twoFactor } from "better-auth/plugins/two-factor";
import { username } from "better-auth/plugins/username";
import { and, eq, gt, ne, sql } from "drizzle-orm";
import { createLocalJWKSet, jwtVerify } from "jose";
import { createElement } from "react";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { ResetPasswordEmail, VerifyEmail, VerifyEmailChange } from "@reactive-resume/email/templates/auth";
import { sendEmail } from "@reactive-resume/email/transport";
import { env } from "@reactive-resume/env/server";
import { rateLimitConfig } from "@reactive-resume/utils/rate-limit";
import { generateId, toUsername } from "@reactive-resume/utils/string";
import { timezoneSchema } from "@reactive-resume/utils/timezone";
import { isAllowedOAuthRedirectUri } from "@reactive-resume/utils/url-security.node";
import { createGithubProfileMapper, createProfileMapper, isUsernameReserved } from "./oauth-profile";
import { authRateLimitStorage } from "./rate-limit";
import { getTrustedOrigins } from "./trusted-origins";

const authBaseUrl = env.APP_URL;
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

export async function verifyOAuthToken(token: string): Promise<JWTPayload> {
	// Use the same in-process verification on Docker and Vercel. Access tokens must
	// identify a live client/grant and cannot use proof binding without a DPoP proof.
	const { payload } = await jwtVerify(token, createLocalJWKSet(await auth.api.getJwks()), {
		issuer: `${authBaseUrl}/api/auth`,
		audience: OAUTH_AUDIENCES,
		requiredClaims: ["sub", "exp", "iat", "azp"],
	});
	if (payload.cnf || typeof payload.sub !== "string" || typeof payload.azp !== "string") {
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
	return payload;
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
}) => Promise<(() => Promise<void>) | void>;

let accountLinkHook: AccountLinkHook | undefined;

/** Sets the one account-link hook; no argument clears it. */
export function setAccountLinkHook(hook?: AccountLinkHook): void {
	accountLinkHook = hook;
}

/** Cleans up outside the database after Better Auth deletes a user (guest cleanup after linking, admin removal). */
export type UserDeleteHook = (userId: string) => Promise<void>;

let userDeleteHook: UserDeleteHook | undefined;

/** Sets the one user-delete hook; no argument clears it. */
export function setUserDeleteHook(hook?: UserDeleteHook): void {
	userDeleteHook = hook;
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
		const rewriteUploadsJson = (column: unknown) =>
			sql`cast(replace(cast(${column} as text), 'uploads/' || ${fromUserId} || '/', 'uploads/' || ${toUserId} || '/') as jsonb)`;

		const rewriteUploadsUrl = (column: unknown) =>
			sql`case when ${column} is not null then replace(${column}, 'uploads/' || ${fromUserId} || '/', 'uploads/' || ${toUserId} || '/') else null end`;

		// An existing account may already use a slug; suffix the guest's copy to keep (user, slug) unique.
		await tx
			.update(schema.resume)
			.set({
				userId: toUserId,
				slug: sql`case when exists (select 1 from resume r where r.user_id = ${toUserId} and r.slug = resume.slug) then resume.slug || '-' || right(resume.id, 6) else resume.slug end`,
				data: rewriteUploadsJson(schema.resume.data),
			})
			.where(eq(schema.resume.userId, fromUserId));

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

		await tx
			.update(schema.application)
			.set({
				userId: toUserId,
				resumeFileUrl: rewriteUploadsUrl(schema.application.resumeFileUrl),
				coverLetterUrl: rewriteUploadsUrl(schema.application.coverLetterUrl),
			})
			.where(eq(schema.application.userId, fromUserId));

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
		return accountLinkHook?.({ fromUserId, toUserId });
	});

	try {
		await cleanup?.();
	} catch (error) {
		console.warn("Failed to clean up linked account resources:", error);
	}
}

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
					// Guests sign in without a username. The tail of a UUIDv7 is random; its head is a timestamp.
					before: (user) => {
						if (!user.isAnonymous) return Promise.resolve(undefined);
						const username = `guest-${generateId().slice(-12)}`;
						return Promise.resolve({ data: { ...user, username, displayUsername: username } });
					},
				},
				delete: {
					// The user row is already gone, so a failed cleanup is logged rather than failing the request.
					after: async (user) => {
						try {
							await userDeleteHook?.(user.id);
						} catch (error) {
							console.error("Failed to clean up deleted user %s:", user.id, error);
						}
					},
				},
			},
		},

		// Unused endpoints: guest deletion skips the app's storage cleanup; the session JWT has no consumer.
		disabledPaths: ["/delete-anonymous-user", "/token"],

		hooks: {
			before: createAuthMiddleware(async (ctx) => {
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
				if (ctx.path === "/passkey/generate-register-options" || ctx.path === "/passkey/verify-registration") {
					// freshAge is 0 so old sessions can unlink providers; adding a passkey still needs a recent sign-in.
					const current = await auth.api.getSession({ headers: ctx.headers ?? new Headers() });
					if (current && Date.now() - new Date(current.session.createdAt).getTime() > 24 * 60 * 60 * 1000) {
						throw new APIError("FORBIDDEN", { message: "For your security, sign in again to add a passkey." });
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
		},

		// Without this, OAuth callback failures land on Better Auth's built-in `/api/auth/error`
		// page. It also backs the `oauthProvider` plugin's authorization errors that happen before
		// `redirect_uri` is validated and so cannot be returned to the requesting client.
		onAPIError: { errorURL: "/auth/error" },

		advanced: {
			database: { generateId },
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
			sendResetPassword: async ({ user, url }) => {
				await sendEmail({
					to: user.email,
					subject: "Reset your password",
					react: createElement(ResetPasswordEmail, { url }),
				});
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
					// Nobody had proved this address before: whoever signed up with it may have added other ways in.
					if (!user.emailVerified) {
						await tx.delete(schema.passkey).where(eq(schema.passkey.userId, user.id));
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
			sendVerificationEmail: async ({ user, url }) => {
				await sendEmail({
					to: user.email,
					subject: "Verify your email",
					react: createElement(VerifyEmail, { url }),
				});
			},
		},

		user: {
			changeEmail: {
				enabled: true,
				// Better Auth's two-step change: the current address approves first, then the new address gets its own
				// verification link. Sending this step to the new address would let anyone holding a session move the
				// account to an address they control without the owner's approval.
				sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
					await sendEmail({
						to: user.email,
						subject: "Approve your email change",
						react: createElement(VerifyEmailChange, { url, previousEmail: user.email, newEmail }),
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
				scopes: ["openid", "profile", "email", "offline_access", "api:read", "api:write", "api:delete"],
				extensions: [
					{
						claims: {
							accessToken: async ({ user, client }) => {
								if (!user) return {};
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
			anonymous({
				emailDomainName: "reactive-resume.local",
				generateName: () => "Guest",
				// Signing up or in from a guest session moves the guest's documents to that account; the plugin then
				// deletes the guest account, along with anything not moved here (assistant threads, career data).
				onLinkAccount: async ({ anonymousUser, newUser }) => {
					await linkAnonymousAccount({
						fromUserId: anonymousUser.user.id,
						toUserId: newUser.user.id,
					});
				},
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

type ProfileUpdate = { name?: string; username?: string; image?: string | null; timezone?: string };

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
