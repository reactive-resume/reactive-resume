import type { Locale } from "@reactive-resume/utils/locale";
import type { User } from "better-auth";
import { ORPCError, os } from "@orpc/server";
import { eq } from "drizzle-orm";
import { auth, verifyOAuthToken } from "@reactive-resume/auth/config";
import { db } from "@reactive-resume/db/client";
import { user } from "@reactive-resume/db/schema";
import { env } from "@reactive-resume/env/server";

export type RequestPermission = "read" | "write" | "delete";
export type RequestAuthentication = {
	user: User;
	method: "apiKey" | "bearer" | "session";
	permissions: readonly RequestPermission[];
};

interface ORPCContext {
	locale: Locale;
	reqHeaders: Headers;
	resHeaders?: Headers;
	trustedClient?: string;
	/** Set only by a server adapter after authenticating this request. */
	authentication?: RequestAuthentication | null;
}

const fullPermissions: readonly RequestPermission[] = ["read", "write", "delete"];

async function findActiveUser(id: string): Promise<User | null> {
	const [result] = await db.select().from(user).where(eq(user.id, id)).limit(1);
	if (!result || (result.banned && (!result.banExpires || result.banExpires > new Date()))) return null;
	return result;
}

async function getAuthenticationFromBearerToken(headers: Headers): Promise<RequestAuthentication | null> {
	try {
		const authHeader = headers.get("authorization");
		if (!authHeader?.startsWith("Bearer ")) return null;
		const payload = await verifyOAuthToken(authHeader.slice(7));
		if (!payload.sub) return null;
		const result = await findActiveUser(payload.sub);
		if (!result) return null;
		const scopes = typeof payload.scope === "string" ? payload.scope.split(/\s+/) : [];
		const explicitPermissions = scopes.filter((scope) => scope.startsWith("api:"));
		// Existing grants used identity scopes for account-wide access. Explicit
		// application scopes opt into least privilege without breaking those grants.
		const permissions = explicitPermissions.length
			? fullPermissions.filter((permission) => scopes.includes(`api:${permission}`))
			: fullPermissions;
		return { user: result, method: "bearer", permissions };
	} catch {
		return null;
	}
}

async function getAuthenticationFromApiKey(apiKey: string): Promise<RequestAuthentication | null> {
	try {
		const result = await auth.api.verifyApiKey({ body: { key: apiKey } });
		if (!result.key || !result.valid) return null;
		const activeUser = await findActiveUser(result.key.referenceId);
		if (!activeUser) return null;
		const statements: unknown = result.key.permissions;
		const apiPermissions = statements && typeof statements === "object" && "api" in statements ? statements.api : [];
		const permissions =
			statements == null
				? fullPermissions
				: fullPermissions.filter((permission) => Array.isArray(apiPermissions) && apiPermissions.includes(permission));
		return { user: activeUser, method: "apiKey", permissions };
	} catch {
		return null;
	}
}

/** API key, then OAuth bearer token, then same-origin session cookies. */
export async function resolveAuthenticationFromRequestHeaders(headers: Headers): Promise<RequestAuthentication | null> {
	const apiKey = headers.get("x-api-key");
	if (apiKey) {
		const authentication = await getAuthenticationFromApiKey(apiKey);
		if (authentication) return authentication;
	}
	const bearer = await getAuthenticationFromBearerToken(headers);
	if (bearer) return bearer;
	const origin = headers.get("origin");
	if (
		headers.has("cookie") &&
		((origin && origin !== new URL(env.APP_URL).origin) || headers.get("sec-fetch-site") === "cross-site")
	) {
		throw new ORPCError("FORBIDDEN", { message: "Cross-origin session requests are not allowed." });
	}
	// Do not let Better Auth turn an API key into an unrestricted synthetic session.
	const sessionHeaders = new Headers(headers);
	sessionHeaders.delete("x-api-key");
	sessionHeaders.delete("authorization");
	try {
		const result = await auth.api.getSession({ headers: sessionHeaders, query: { disableCookieCache: true } });
		if (!result?.user) return null;
		const activeUser = await findActiveUser(result.user.id);
		return activeUser ? { user: activeUser, method: "session", permissions: fullPermissions } : null;
	} catch {
		return null;
	}
}

export async function resolveUserFromRequestHeaders(headers: Headers): Promise<User | null> {
	return (await resolveAuthenticationFromRequestHeaders(headers))?.user ?? null;
}

const base = os.$context<ORPCContext>();

export const publicProcedure = base
	.route({ spec: (operation) => ({ ...operation, security: [] }) })
	.use(async ({ context, next }) => {
		const authentication =
			context.authentication === undefined
				? await resolveAuthenticationFromRequestHeaders(context.reqHeaders)
				: context.authentication;

		return next({
			context: {
				...context,
				authentication,
				user: authentication?.user ?? null,
			},
		});
	});

export const protectedProcedure = publicProcedure
	.route({
		spec: (operation) => ({ ...operation, security: [{ apiKey: [] }, { bearerAuth: [] }, { cookieAuth: [] }] }),
	})
	.use(({ context, procedure, next }) => {
		if (!context.user) throw new ORPCError("UNAUTHORIZED");
		const route = procedure["~orpc"].route;
		const permission =
			route.method === "GET"
				? "read"
				: route.method === "DELETE" || /^(delete|bulkDelete|purge)/i.test(route.operationId ?? "")
					? "delete"
					: "write";
		if (!context.authentication?.permissions.includes(permission)) {
			context.resHeaders?.set("WWW-Authenticate", `Bearer error="insufficient_scope", scope="api:${permission}"`);
			throw new ORPCError("FORBIDDEN", { message: `This credential requires api:${permission} permission.` });
		}

		return next({
			context: {
				...context,
				user: context.user,
			},
		});
	});
