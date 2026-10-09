import type { SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import * as pg from "drizzle-orm/pg-core";
import { generateId } from "@reactive-resume/utils/string";

function lower<T extends AnyPgColumn>(column: T): SQL<T> {
	return sql`lower(${column})`;
}

export const user = pg.pgTable(
	"user",
	{
		id: pg
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		image: pg.text("image"),
		name: pg.text("name").notNull(),
		email: pg.text("email").notNull().unique(),
		emailVerified: pg.boolean("email_verified").notNull().default(false),
		username: pg.text("username").notNull().unique(),
		displayUsername: pg.text("display_username").notNull().unique(),
		twoFactorEnabled: pg.boolean("two_factor_enabled").notNull().default(false),
		/** Where the user's times are shown (Settings → Preferences); an IANA name. */
		timezone: pg.text("timezone").notNull().default("UTC"),
		lastActiveAt: pg.timestamp("last_active_at", { withTimezone: true }),
		role: pg.text("role").default("user"),
		banned: pg.boolean("banned").default(false),
		banReason: pg.text("ban_reason"),
		banExpires: pg.timestamp("ban_expires", {
			precision: 6,
			withTimezone: true,
		}),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: pg
			.timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date()),
	},
	(t) => [pg.index().on(t.createdAt.asc()), pg.uniqueIndex("user_email_lower_unique_idx").on(lower(t.email))],
);

export const session = pg.pgTable(
	"session",
	{
		id: pg
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		token: pg.text("token").notNull().unique(),
		ipAddress: pg.text("ip_address"),
		userAgent: pg.text("user_agent"),
		impersonatedBy: pg.text("impersonated_by"),
		userId: pg
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		expiresAt: pg.timestamp("expires_at", { withTimezone: true }).notNull(),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: pg
			.timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date()),
	},
	(t) => [pg.index().on(t.token, t.userId), pg.index().on(t.expiresAt)],
);

export const account = pg.pgTable(
	"account",
	{
		id: pg
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		accountId: pg.text("account_id").notNull(),
		providerId: pg.text("provider_id").notNull().default("credential"),
		// Better Auth 1.7.0–1.7.2 wrote this identity namespace. Version 1.7.3
		// returned to (providerId, accountId), so keep migrated values without
		// requiring the field on new account inserts.
		issuer: pg.text("issuer"),
		userId: pg
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		scope: pg.text("scope"),
		idToken: pg.text("id_token"),
		password: pg.text("password"),
		accessToken: pg.text("access_token"),
		refreshToken: pg.text("refresh_token"),
		accessTokenExpiresAt: pg.timestamp("access_token_expires_at", {
			withTimezone: true,
		}),
		refreshTokenExpiresAt: pg.timestamp("refresh_token_expires_at", {
			withTimezone: true,
		}),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: pg
			.timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date()),
	},
	// Better Auth finds an account by provider and provider account on every social sign-in (#3593).
	(t) => [
		pg.index().on(t.userId),
		pg.uniqueIndex("account_provider_id_account_id_unique").on(t.providerId, t.accountId),
	],
);

export const verification = pg.pgTable(
	"verification",
	{
		id: pg
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		identifier: pg.text("identifier").notNull().unique(),
		value: pg.text("value").notNull(),
		expiresAt: pg.timestamp("expires_at", { withTimezone: true }).notNull(),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: pg
			.timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date()),
	},
	(t) => [pg.index().on(t.identifier)],
);

export const twoFactor = pg.pgTable(
	"two_factor",
	{
		id: pg
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		userId: pg
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		secret: pg.text("secret").notNull(),
		backupCodes: pg.text("backup_codes").notNull(),
		verified: pg.boolean("verified").notNull().default(true),
		failedVerificationCount: pg.integer("failed_verification_count").default(0),
		lockedUntil: pg.timestamp("locked_until", { withTimezone: true }),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: pg
			.timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date()),
	},
	(t) => [pg.index().on(t.userId), pg.index().on(t.secret)],
);

export const passkey = pg.pgTable(
	"passkey",
	{
		id: pg
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		name: pg.text("name"),
		aaguid: pg.text("aaguid"),
		publicKey: pg.text("public_key").notNull(),
		credentialID: pg.text("credential_id").notNull(),
		counter: pg.integer("counter").notNull(),
		deviceType: pg.text("device_type").notNull(),
		backedUp: pg.boolean("backed_up").notNull().default(false),
		transports: pg.text("transports").notNull(),
		userId: pg
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: pg
			.timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date()),
	},
	(t) => [pg.index().on(t.userId)],
);

export const apikey = pg.pgTable(
	"apikey",
	{
		id: pg
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		name: pg.text("name"),
		start: pg.text("start"),
		prefix: pg.text("prefix"),
		key: pg.text("key").notNull(),
		configId: pg.text("config_id").notNull().default("default"),
		referenceId: pg
			.text("reference_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		refillInterval: pg.integer("refill_interval"),
		refillAmount: pg.integer("refill_amount"),
		lastRefillAt: pg.timestamp("last_refill_at", { withTimezone: true }),
		enabled: pg.boolean("enabled").notNull().default(true),
		rateLimitEnabled: pg.boolean("rate_limit_enabled").notNull().default(false),
		rateLimitTimeWindow: pg.integer("rate_limit_time_window").default(86400000),
		rateLimitMax: pg.integer("rate_limit_max").default(10),
		requestCount: pg.integer("request_count").notNull().default(0),
		remaining: pg.integer("remaining"),
		lastRequest: pg.timestamp("last_request", { withTimezone: true }),
		expiresAt: pg.timestamp("expires_at", { withTimezone: true }),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: pg
			.timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date()),
		permissions: pg.text("permissions"),
		metadata: pg.jsonb("metadata"),
	},
	(t) => [
		pg.index().on(t.referenceId),
		pg.index().on(t.key),
		pg.index().on(t.configId),
		pg.index().on(t.enabled, t.referenceId),
	],
);

export const jwks = pg.pgTable("jwks", {
	id: pg
		.text("id")
		.notNull()
		.primaryKey()
		.$defaultFn(() => generateId()),
	publicKey: pg.text("public_key").notNull(),
	privateKey: pg.text("private_key").notNull(),
	createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	expiresAt: pg.timestamp("expires_at", { withTimezone: true }),
	// Better Auth 1.7 added `alg` and `crv` to the jwt plugin's jwks model. Both are optional to
	// the plugin, but the Drizzle adapter rejects a model whose columns it cannot find, so every
	// session verification throws until they exist. Existing rows keep NULL and stay valid.
	alg: pg.text("alg"),
	crv: pg.text("crv"),
});

export const oauthClient = pg.pgTable(
	"oauth_client",
	{
		// Additive fields required by Better Auth 1.7 OAuth provider.
		clientDiscoveryId: pg.text("client_discovery_id"),
		clientCredentialsScopes: pg.text("client_credentials_scopes").array().default([]),
		backchannelLogoutUri: pg.text("backchannel_logout_uri"),
		backchannelLogoutSessionRequired: pg.boolean("backchannel_logout_session_required"),
		applicationType: pg.text("application_type"),
		jwks: pg.text("jwks"),
		jwksUri: pg.text("jwks_uri"),
		dpopBoundAccessTokens: pg.boolean("dpop_bound_access_tokens").default(false),

		id: pg
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		clientId: pg.text("client_id").notNull().unique(),
		clientSecret: pg.text("client_secret"),
		disabled: pg.boolean("disabled").default(false),
		skipConsent: pg.boolean("skip_consent"),
		enableEndSession: pg.boolean("enable_end_session"),
		subjectType: pg.text("subject_type"),
		scopes: pg.text("scopes").array(),
		userId: pg.text("user_id").references(() => user.id, { onDelete: "cascade" }),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).defaultNow(),
		updatedAt: pg
			.timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date()),
		name: pg.text("name"),
		uri: pg.text("uri"),
		icon: pg.text("icon"),
		contacts: pg.text("contacts").array(),
		tos: pg.text("tos"),
		policy: pg.text("policy"),
		softwareId: pg.text("software_id"),
		softwareVersion: pg.text("software_version"),
		softwareStatement: pg.text("software_statement"),
		redirectUris: pg.text("redirect_uris").array().notNull(),
		postLogoutRedirectUris: pg.text("post_logout_redirect_uris").array(),
		tokenEndpointAuthMethod: pg.text("token_endpoint_auth_method"),
		grantTypes: pg.text("grant_types").array(),
		responseTypes: pg.text("response_types").array(),
		public: pg.boolean("public"),
		type: pg.text("type"),
		requirePKCE: pg.boolean("require_pkce"),
		referenceId: pg.text("reference_id"),
		metadata: pg.jsonb("metadata"),
	},
	(t) => [pg.index().on(t.clientId)],
);

export const oauthRefreshToken = pg.pgTable(
	"oauth_refresh_token",
	{
		// Additive fields required by Better Auth 1.7 OAuth provider.
		authorizationCodeId: pg.text("authorization_code_id"),
		resources: pg.text("resources").array(),
		requestedUserInfoClaims: pg.text("requested_user_info_claims").array(),
		rotatedAt: pg.timestamp("rotated_at", { withTimezone: true }),
		rotationReplayResponse: pg.text("rotation_replay_response"),
		rotationReplayExpiresAt: pg.timestamp("rotation_replay_expires_at", { withTimezone: true }),
		confirmation: pg.jsonb("confirmation"),

		id: pg
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		token: pg.text("token").notNull(),
		clientId: pg
			.text("client_id")
			.notNull()
			.references(() => oauthClient.clientId, { onDelete: "cascade" }),
		sessionId: pg.text("session_id").references(() => session.id, { onDelete: "set null" }),
		userId: pg
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		referenceId: pg.text("reference_id"),
		expiresAt: pg.timestamp("expires_at", { withTimezone: true }),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).defaultNow(),
		revoked: pg.timestamp("revoked", { withTimezone: true }),
		authTime: pg.timestamp("auth_time", { withTimezone: true }),
		scopes: pg.text("scopes").array().notNull(),
	},
	(t) => [pg.index().on(t.token)],
);

export const oauthAccessToken = pg.pgTable(
	"oauth_access_token",
	{
		// Additive fields required by Better Auth 1.7 OAuth provider.
		authorizationCodeId: pg.text("authorization_code_id"),
		resources: pg.text("resources").array(),
		requestedUserInfoClaims: pg.text("requested_user_info_claims").array(),
		revoked: pg.timestamp("revoked", { withTimezone: true }),
		confirmation: pg.jsonb("confirmation"),

		id: pg
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		token: pg.text("token").notNull().unique(),
		clientId: pg
			.text("client_id")
			.notNull()
			.references(() => oauthClient.clientId, { onDelete: "cascade" }),
		sessionId: pg.text("session_id").references(() => session.id, { onDelete: "set null" }),
		userId: pg.text("user_id").references(() => user.id, { onDelete: "cascade" }),
		referenceId: pg.text("reference_id"),
		refreshId: pg.text("refresh_id").references(() => oauthRefreshToken.id, { onDelete: "cascade" }),
		expiresAt: pg.timestamp("expires_at", { withTimezone: true }),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).defaultNow(),
		scopes: pg.text("scopes").array().notNull(),
	},
	(t) => [pg.index().on(t.token)],
);

export const oauthConsent = pg.pgTable(
	"oauth_consent",
	{
		// Additive fields required by Better Auth 1.7 OAuth provider.
		resources: pg.text("resources").array(),
		requestedUserInfoClaims: pg.text("requested_user_info_claims").array(),

		id: pg
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		clientId: pg
			.text("client_id")
			.notNull()
			.references(() => oauthClient.clientId, { onDelete: "cascade" }),
		userId: pg.text("user_id").references(() => user.id, { onDelete: "cascade" }),
		referenceId: pg.text("reference_id"),
		scopes: pg.text("scopes").array().notNull(),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).defaultNow(),
		updatedAt: pg
			.timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date()),
	},
	(t) => [pg.index().on(t.userId, t.clientId)],
);

export const oauthResource = pg.pgTable("oauth_resource", {
	id: pg
		.text("id")
		.notNull()
		.primaryKey()
		.$defaultFn(() => generateId()),
	identifier: pg.text("identifier").notNull().unique(),
	name: pg.text("name").notNull(),
	accessTokenTtl: pg.integer("access_token_ttl"),
	refreshTokenTtl: pg.integer("refresh_token_ttl"),
	signingAlgorithm: pg.text("signing_algorithm"),
	signingKeyId: pg.text("signing_key_id"),
	allowedScopes: pg.text("allowed_scopes").array(),
	customClaims: pg.jsonb("custom_claims"),
	dpopBoundAccessTokensRequired: pg.boolean("dpop_bound_access_tokens_required").default(false),
	disabled: pg.boolean("disabled").default(false),
	createdAt: pg.timestamp("created_at", { withTimezone: true }),
	updatedAt: pg.timestamp("updated_at", { withTimezone: true }),
	policyVersion: pg.integer("policy_version").default(1),
	metadata: pg.jsonb("metadata"),
});

export const oauthClientResource = pg.pgTable(
	"oauth_client_resource",
	{
		id: pg
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		clientId: pg
			.text("client_id")
			.notNull()
			.references(() => oauthClient.clientId, { onDelete: "cascade" }),
		resourceId: pg
			.text("resource_id")
			.notNull()
			.references(() => oauthResource.identifier, { onDelete: "cascade" }),
		metadata: pg.jsonb("metadata"),
		createdAt: pg.timestamp("created_at", { withTimezone: true }),
	},
	(t) => [pg.index().on(t.clientId), pg.index().on(t.resourceId), pg.uniqueIndex().on(t.clientId, t.resourceId)],
);

export const oauthClientAssertion = pg.pgTable("oauth_client_assertion", {
	id: pg
		.text("id")
		.notNull()
		.primaryKey()
		.$defaultFn(() => generateId()),
	expiresAt: pg.timestamp("expires_at", { withTimezone: true }).notNull(),
});
