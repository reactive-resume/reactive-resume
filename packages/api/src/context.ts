import type { Locale } from "@reactive-resume/utils/locale";
import type { User } from "better-auth";
import { ORPCError, os } from "@orpc/server";
import { eq } from "drizzle-orm";
import { auth, verifyOAuthToken } from "@reactive-resume/auth/config";
import { db } from "@reactive-resume/db/client";
import { user } from "@reactive-resume/db/schema";
import { env } from "@reactive-resume/env/server";

interface ORPCContext {
	locale: Locale;
	reqHeaders: Headers;
	resHeaders?: Headers;
	trustedClient?: string;
}

async function getUserFromBearerToken(headers: Headers): Promise<User | null> {
	try {
		const authHeader = headers.get("authorization");
		if (!authHeader?.startsWith("Bearer ")) return null;

		const payload = await verifyOAuthToken(authHeader.slice(7));
		if (!payload?.sub) return null;

		const [userResult] = await db.select().from(user).where(eq(user.id, payload.sub)).limit(1);
		return userResult ?? null;
	} catch (error) {
		console.warn("Bearer token verification failed:", error);
		return null;
	}
}

async function getUserFromHeaders(headers: Headers): Promise<User | null> {
	try {
		const result = await auth.api.getSession({ headers });
		if (!result?.user) return null;

		return result.user;
	} catch (error) {
		console.warn("Session verification failed:", error);
		return null;
	}
}

async function getUserFromApiKey(apiKey: string): Promise<User | null> {
	try {
		const result = await auth.api.verifyApiKey({ body: { key: apiKey } });
		if (!result.key || !result.valid) return null;

		const [userResult] = await db.select().from(user).where(eq(user.id, result.key.referenceId)).limit(1);
		if (!userResult) return null;

		return userResult;
	} catch (error) {
		console.warn("API key verification failed:", error);
		return null;
	}
}

/**
 * Resolve the authenticated user from the same headers oRPC uses (`x-api-key`,
 * `Authorization: Bearer`, or session cookies). Tries each auth method in
 * priority order and returns the first valid identity. Used directly by
 * oRPC's `publicProcedure` and by callers outside oRPC handlers (e.g. MCP
 * tools) where `context.user` is not in scope.
 */
export async function resolveUserFromRequestHeaders(headers: Headers): Promise<User | null> {
	const apiKey = headers.get("x-api-key");
	if (apiKey) {
		const apiKeyUser = await getUserFromApiKey(apiKey);
		if (apiKeyUser) return apiKeyUser;
	}
	const bearerUser = await getUserFromBearerToken(headers);
	if (bearerUser) return bearerUser;

	// Cookie credentials are ambient. Never use them for a request from another origin,
	// including multipart uploads that browsers can submit without a CORS preflight.
	const origin = headers.get("origin");
	if (
		headers.has("cookie") &&
		((origin && origin !== new URL(env.APP_URL).origin) || headers.get("sec-fetch-site") === "cross-site")
	) {
		throw new ORPCError("FORBIDDEN", { message: "Cross-origin session requests are not allowed." });
	}
	return getUserFromHeaders(headers);
}

const base = os.$context<ORPCContext>();

export const publicProcedure = base
	.route({ spec: (operation) => ({ ...operation, security: [] }) })
	.use(async ({ context, next }) => {
		const user = await resolveUserFromRequestHeaders(context.reqHeaders);

		return next({
			context: {
				...context,
				user,
			},
		});
	});

export const protectedProcedure = publicProcedure
	.route({
		spec: (operation) => ({ ...operation, security: [{ apiKey: [] }, { bearerAuth: [] }, { cookieAuth: [] }] }),
	})
	.use(({ context, next }) => {
		if (!context.user) throw new ORPCError("UNAUTHORIZED");

		return next({
			context: {
				...context,
				user: context.user,
			},
		});
	});
