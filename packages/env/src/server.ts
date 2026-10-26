import { isIP } from "node:net";
import { isAbsolute, join } from "node:path";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { aiProviderSchema } from "@reactive-resume/ai/types";
import { findWorkspaceRoot } from "@reactive-resume/utils/monorepo.node";
import { deploymentEnvironment } from "./deployment";

const workspaceRoot = process.env.CLOUDFLARE === "1" ? null : findWorkspaceRoot();

if (workspaceRoot) {
	try {
		// Native stand-in for dotenv: existing process.env still wins over file values.
		process.loadEnvFile(join(workspaceRoot, ".env"));
	} catch (error) {
		// A missing .env is expected (e.g. production with injected env); anything else is a real problem.
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
	}
}

// ioredis authenticates as `AUTH <username> <password>`; a bare "redis://value@host" (userinfo with no colon) puts
// that value in the username slot and Redis rejects the resulting auth. Password-only servers (redis-server
// --requirepass) need an empty username — "redis://:<pass>@<host>" — or the built-in ACL user,
// "redis://default:<pass>@<host>". A named user with an explicitly empty password ("redis://user:@host") stays
// valid: Redis accepts `AUTH <user> ""` for passwordless (`nopass`) ACL users.
/** A comma-separated list, trimmed and without empty entries; each entry must match `item`. Empty when unset. */
const commaList = (item: z.ZodType<string, string>) =>
	z
		.string()
		.transform((value) =>
			value
				.split(",")
				.map((entry) => entry.trim())
				.filter(Boolean),
		)
		.pipe(z.array(item))
		.default([]);

const REDIS_URL_USERINFO_MESSAGE =
	"REDIS_URL userinfo has no password field. For password-only auth (redis --requirepass) use " +
	"redis://:<password>@<host>; for ACL users use redis://<user>:<password>@<host> (default is the built-in user; " +
	"nopass users may keep the password empty, e.g. redis://<user>:@<host>).";

function hasCompleteUserinfo(raw: string): boolean {
	// Checks run even when the earlier URL-format check has already failed, so this must never throw:
	// a malformed URL reaching `new URL()` surfaces as an unhandled parse crash instead of a validation
	// error. Format errors are the URL check's job — only classify complete, parseable URLs here.
	if (!URL.canParse(raw)) return true;

	// The URL parser normalizes an empty password away ("redis://user:@host" parses like
	// "redis://user@host"), so the colon that separates the password field must be read from the raw
	// authority. Userinfo ends at the last "@" before the authority terminator; a userinfo without a
	// colon is exactly the password-in-username-slot shape ioredis mis-authenticates.
	const schemeEnd = raw.indexOf("://");
	if (schemeEnd === -1) return true; // no authority, so no userinfo
	const authorityStart = schemeEnd + 3;
	const terminator = raw.slice(authorityStart).search(/[/?#]/);
	const authority =
		terminator === -1 ? raw.slice(authorityStart) : raw.slice(authorityStart, authorityStart + terminator);
	const userinfoEnd = authority.lastIndexOf("@");
	// `userinfoEnd === 0` is an empty userinfo ("redis://@host") — ioredis reads it exactly like no
	// userinfo and sends no AUTH, so it passes the same way a missing "@" does.
	if (userinfoEnd <= 0) return true;
	return authority.slice(0, userinfoEnd).includes(":");
}

export const env = createEnv({
	server: {
		// Application
		CLOUDFLARE: z.stringbool().default(false),
		APP_URL: z.url({ protocol: /https?/ }),
		APP_REVISION: z
			.string()
			.regex(/^[a-f0-9]{40}$/)
			.optional(),
		WEB_FONT_BASE_URL: z
			.url({ protocol: /^https?$/ })
			.refine((value) => !/[?#]/.test(value), "Font base URL must not contain a query string or fragment")
			.optional(),
		ROOT_RESUME_ID: z
			.string()
			.trim()
			.transform((value) => value || undefined)
			.optional(),
		// A short domain whose `/<username>` opens that account's primary resume, e.g. https://rx.cv. Unset turns it off.
		SHORT_LINK_URL: z.url({ protocol: /^https?$/ }).optional(),
		// The host custom domains point a CNAME at, e.g. domains.rx.cv. Unset turns custom domains off.
		CUSTOM_DOMAIN_TARGET: z
			.string()
			.trim()
			.toLowerCase()
			.regex(
				/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
				"Use a host name such as domains.example.com",
			)
			.optional(),
		// Sent by Traefik's HTTP provider to read the custom domains' routers; at least 32 characters.
		CUSTOM_DOMAIN_PROVIDER_SECRET: z.string().min(32).optional(),
		SERVER_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
		TRUSTED_PROXIES: commaList(
			z.string().refine((range) => {
				const [address, prefix, ...rest] = range.split("/");
				const family = isIP(address ?? "");
				return (
					family > 0 &&
					rest.length === 0 &&
					(prefix === undefined || (/^\d+$/.test(prefix) && Number(prefix) <= (family === 4 ? 32 : 128)))
				);
			}, "TRUSTED_PROXIES must contain comma-separated IP addresses or CIDRs"),
		),

		// Database
		DATABASE_URL: z.url({ protocol: /postgres(ql)?/ }),
		DATABASE_MIGRATION_URL: z.url({ protocol: /postgres(ql)?/ }).optional(),
		DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
		STRICT_SCHEMA_CHECK: z.stringbool().default(false),

		// Authentication
		// It keys every session, auth token and signed link: production needs a random value, not a word.
		AUTH_SECRET: z
			.string()
			.min(1)
			.refine((value) => process.env.NODE_ENV !== "production" || value.length >= 32, {
				message: "AUTH_SECRET must be at least 32 characters in production. Generate one with openssl rand -hex 32.",
			}),
		BETTER_AUTH_API_KEY: z.string().min(1).optional(),
		// Domain verification token from the OpenAI plugin portal, served at /.well-known/openai-apps-challenge.
		OPENAI_APPS_CHALLENGE_TOKEN: z.string().trim().min(1).optional(),
		// Native app association files (empty lists leave the endpoints disabled).
		MOBILE_IOS_APP_IDS: commaList(z.string().regex(/^[A-Z0-9]{10}\.[A-Za-z0-9.-]+$/)),
		MOBILE_ANDROID_PACKAGES: commaList(z.string().regex(/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+$/)),
		MOBILE_ANDROID_CERT_SHA256: commaList(z.string().regex(/^(?:[A-Fa-f0-9]{2}:){31}[A-Fa-f0-9]{2}$/)),

		// Social Auth (Apple): client secret is a pre-signed Apple JWT.
		APPLE_CLIENT_ID: z.string().min(1).optional(),
		APPLE_CLIENT_SECRET: z.string().min(1).optional(),

		// Social Auth (Google)
		GOOGLE_CLIENT_ID: z.string().min(1).optional(),
		GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),

		// Social Auth (GitHub)
		GITHUB_CLIENT_ID: z.string().min(1).optional(),
		GITHUB_CLIENT_SECRET: z.string().min(1).optional(),

		// Social Auth (LinkedIn)
		LINKEDIN_CLIENT_ID: z.string().min(1).optional(),
		LINKEDIN_CLIENT_SECRET: z.string().min(1).optional(),

		// Custom OAuth Provider
		OAUTH_PROVIDER_NAME: z.string().min(1).optional(),
		OAUTH_CLIENT_ID: z.string().min(1).optional(),
		OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
		OAUTH_DISCOVERY_URL: z.url({ protocol: /https?/ }).optional(),
		OAUTH_AUTHORIZATION_URL: z.url({ protocol: /https?/ }).optional(),
		OAUTH_TOKEN_URL: z.url({ protocol: /https?/ }).optional(),
		OAUTH_USER_INFO_URL: z.url({ protocol: /https?/ }).optional(),
		OAUTH_SCOPES: z
			.string()
			.min(1)
			.transform((value) => value.split(" "))
			.default(["openid", "profile", "email"]),

		// Email (SMTP)
		SMTP_HOST: z.string().min(1).optional(),
		SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
		SMTP_USER: z.string().min(1).optional(),
		SMTP_PASS: z.string().min(1).optional(),
		SMTP_FROM: z.string().min(1).optional(),
		SMTP_SECURE: z.stringbool().default(false),

		// Storage (Optional)
		STORAGE_BACKEND: z.enum(["local", "s3", "blob", "r2"]),
		STORAGE_HEALTHCHECK_TIMEOUT_MS: z.coerce.number().int().positive().max(2_147_483_647).default(5_000),
		BLOB_READ_WRITE_TOKEN: z.string().min(1).optional(),
		BLOB_STORE_ID: z.string().min(1).optional(),
		DEPLOYMENT_NAMESPACE: z.string().regex(/^[a-zA-Z0-9._-]+$/),
		LOCAL_STORAGE_PATH: z.string().min(1).refine(isAbsolute, "LOCAL_STORAGE_PATH must be an absolute path").optional(),
		S3_ACCESS_KEY_ID: z.string().min(1).optional(),
		S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
		S3_REGION: z.string().default("us-east-1"),
		S3_ENDPOINT: z.url({ protocol: /https?/ }).optional(),
		S3_BUCKET: z.string().min(1).optional(),
		S3_FORCE_PATH_STYLE: z.stringbool().default(false),

		// AI Agent Workspace (optional until the agent feature is used)
		REDIS_URL: z
			.url({ protocol: /redis(s)?/ })
			.refine(hasCompleteUserinfo, REDIS_URL_USERINFO_MESSAGE)
			.optional(),
		ENCRYPTION_SECRET: z.string().min(32, "ENCRYPTION_SECRET must be at least 32 characters").optional(),
		CRON_SECRET: z.string().min(16, "CRON_SECRET must be at least 16 characters").optional(),

		// Optional search and enhanced reading; custom URLs are operator-controlled Firecrawl services.
		WEB_ACCESS_PROVIDER: z.enum(["firecrawl", "tavily", "exa"]).optional(),
		WEB_ACCESS_API_KEY: z.string().trim().min(1).optional(),
		WEB_ACCESS_API_URL: z.url({ protocol: /^https?$/ }).optional(),
		// Optional operator-controlled SearXNG that takes over web search only; reading still uses the connection above.
		WEB_SEARCH_SEARXNG_URL: z.url({ protocol: /^https?$/ }).optional(),
		AI_PROVIDER: aiProviderSchema.optional(),
		AI_MODEL: z.string().trim().min(1).optional(),
		AI_API_KEY: z.string().trim().min(1).optional(),
		AI_BASE_URL: z.url({ protocol: /^https?$/ }).optional(),

		// Feature Flags
		FLAG_DISABLE_SIGNUPS: z.stringbool().default(false),
		FLAG_DISABLE_EMAIL_AUTH: z.stringbool().default(false),
		FLAG_ENABLE_GUEST_LOGIN: z.stringbool().default(false),
		FLAG_DISABLE_IMAGE_PROCESSING: z.stringbool().default(false),
		FLAG_DISABLE_API_RATE_LIMIT: z.stringbool().default(false),
		FLAG_ALLOW_UNSAFE_AI_BASE_URL: z.stringbool().default(false),
		FLAG_ALLOW_UNSAFE_OAUTH_REDIRECT_URI: z.stringbool().default(false),
		FLAG_OLACV_SUGGESTION: z.stringbool().default(false),
	},
	runtimeEnv: deploymentEnvironment(process.env),
	emptyStringAsUndefined: true,
});

if (
	(env.WEB_ACCESS_PROVIDER || env.WEB_ACCESS_API_KEY || env.WEB_ACCESS_API_URL) &&
	(!env.WEB_ACCESS_PROVIDER ||
		(!env.WEB_ACCESS_API_KEY && !(env.WEB_ACCESS_PROVIDER === "firecrawl" && env.WEB_ACCESS_API_URL)) ||
		(env.WEB_ACCESS_PROVIDER !== "firecrawl" && env.WEB_ACCESS_API_URL))
) {
	throw new Error(
		"Web access requires WEB_ACCESS_PROVIDER and WEB_ACCESS_API_KEY; only Firecrawl accepts WEB_ACCESS_API_URL, which may be keyless.",
	);
}

if (
	(env.AI_PROVIDER || env.AI_MODEL || env.AI_API_KEY || env.AI_BASE_URL) &&
	(!env.AI_PROVIDER || !env.AI_MODEL || (!env.AI_API_KEY && env.AI_PROVIDER !== "ollama"))
) {
	throw new Error("Server AI requires AI_PROVIDER, AI_MODEL and AI_API_KEY (the key is optional for Ollama).");
}

// `.env.example` is public, and production Compose loads it as the base `env_file`: its secrets would let anyone sign
// auth tokens or read stored provider keys.
if (process.env.NODE_ENV === "production") {
	for (const [name, value] of [
		["AUTH_SECRET", env.AUTH_SECRET],
		["ENCRYPTION_SECRET", env.ENCRYPTION_SECRET],
	] as const) {
		if (value?.startsWith("change-me-to-a-secure-"))
			throw new Error(`${name} still has the example value from .env.example. Set a random one: openssl rand -hex 32`);
	}
}

if (env.AI_PROVIDER === "openai-compatible" && !env.AI_BASE_URL) {
	throw new Error("The openai-compatible server AI provider requires AI_BASE_URL.");
}
