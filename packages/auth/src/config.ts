import type { GenericOAuthConfig, GenericOAuthUserInfo } from "better-auth/plugins";
import type { JWTPayload } from "jose";
import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { dash } from "@better-auth/infra";
import { oauthProvider } from "@better-auth/oauth-provider";
import { passkey } from "@better-auth/passkey";
import { compare, hash } from "bcryptjs";
import { APIError, betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { admin, jwt, openAPI } from "better-auth/plugins";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { twoFactor } from "better-auth/plugins/two-factor";
import { username } from "better-auth/plugins/username";
import { and, eq, gt } from "drizzle-orm";
import { createLocalJWKSet, jwtVerify } from "jose";
import { createElement } from "react";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { ResetPasswordEmail, VerifyEmail, VerifyEmailChange } from "@reactive-resume/email/templates/auth";
import { sendEmail } from "@reactive-resume/email/transport";
import { env } from "@reactive-resume/env/server";
import { rateLimitConfig } from "@reactive-resume/utils/rate-limit";
import { generateId, toUsername } from "@reactive-resume/utils/string";
import { isAllowedOAuthRedirectUri } from "@reactive-resume/utils/url-security.node";
import { createGithubProfileMapper, createProfileMapper } from "./oauth-profile";
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
	if (payload.sid !== undefined) {
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
		if (!session) throw new APIError("UNAUTHORIZED", { message: "OAuth session has ended." });
	}
	const [consent] = await db
		.select()
		.from(schema.oauthConsent)
		.where(and(eq(schema.oauthConsent.clientId, payload.azp), eq(schema.oauthConsent.userId, payload.sub)))
		.limit(1);
	const scopes = typeof payload.scope === "string" ? payload.scope.split(/\s+/).filter(Boolean) : [];
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
		trustedOrigins: TRUSTED_ORIGINS,
		rateLimit: {
			...rateLimitConfig.betterAuth.global,
			...(authRateLimitStorage ? { customStorage: authRateLimitStorage } : {}),
			enabled: isRateLimitEnabled,
		},

		hooks: {
			before: createAuthMiddleware(async (ctx) => {
				if (ctx.path === "/oauth2/delete-consent") {
					const origin = ctx.headers?.get("origin");
					if (
						(origin && origin !== new URL(authBaseUrl).origin) ||
						ctx.headers?.get("sec-fetch-site") === "cross-site"
					) {
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
				sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
					await sendEmail({
						to: newEmail,
						subject: "Verify your new email",
						react: createElement(VerifyEmailChange, { url, previousEmail: user.email, newEmail }),
					});
				},
			},
			additionalFields: {
				username: {
					type: "string",
					required: true,
				},
			},
		},

		// Better Auth gates `/unlink-account` (and `/list-sessions`) behind a "fresh"
		// session, which defaults to one day old. Sessions here live for a week and
		// there is no re-authentication flow to refresh that timestamp, so disconnecting
		// a provider failed with `SESSION_NOT_FRESH` for anyone who signed in yesterday.
		session: { freshAge: 0 },

		account: {
			accountLinking: {
				enabled: true,
				trustedProviders: ["google", "github", "linkedin"],
			},
		},

		socialProviders: {
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
			jwt(),
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

export async function initializeAuth(): Promise<void> {
	await auth.$context;
}
