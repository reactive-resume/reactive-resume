import { createHmac } from "node:crypto";
import { env } from "@reactive-resume/env/server";
import { parseCookieHeader, safeEquals, serializeCookie } from "./cookie-utils";

// Identifies a returning, account-less critiquer across visits to a resume's critique link.
// Unlike the resume_access cookie (access.ts), this one must carry an identity (critiquerId),
// not just a yes/no, so critiquer A's comments never surface for critiquer B. It is long-lived
// (critiquers return over days/weeks to keep discussing feedback) rather than session-length.
const RESUME_CRITIQUE_COOKIE_PREFIX = "resume_critique";
const RESUME_CRITIQUE_TTL_SECONDS = 60 * 60 * 24 * 365; // 1 year

const getCritiqueCookieName = (resumeId: string) => `${RESUME_CRITIQUE_COOKIE_PREFIX}_${resumeId}`;

// Signing the critique password hash into the payload means rotating the critique password
// automatically invalidates every existing critiquer cookie, the same self-invalidating
// property as the resume_access cookie.
const signCritiquerToken = (resumeId: string, critiquerId: string, critiquePasswordHash: string): string =>
	createHmac("sha256", env.AUTH_SECRET).update(`${resumeId}:${critiquerId}:${critiquePasswordHash}`).digest("hex");

export const readCritiquerIdFromCookie = (
	requestHeaders: Headers,
	resumeId: string,
	critiquePasswordHash: string,
): string | null => {
	const cookieValue = parseCookieHeader(requestHeaders.get("cookie")).get(getCritiqueCookieName(resumeId));
	if (!cookieValue) return null;

	const separatorIndex = cookieValue.lastIndexOf(".");
	if (separatorIndex === -1) return null;

	const critiquerId = cookieValue.slice(0, separatorIndex);
	const signature = cookieValue.slice(separatorIndex + 1);
	if (!critiquerId || !signature) return null;

	const expected = signCritiquerToken(resumeId, critiquerId, critiquePasswordHash);
	return safeEquals(signature, expected) ? critiquerId : null;
};

export const grantCritiquerCookie = (
	responseHeaders: Headers,
	resumeId: string,
	critiquerId: string,
	critiquePasswordHash: string,
) => {
	const signature = signCritiquerToken(resumeId, critiquerId, critiquePasswordHash);
	const cookie = serializeCookie(getCritiqueCookieName(resumeId), `${critiquerId}.${signature}`, {
		path: "/",
		httpOnly: true,
		sameSite: "lax",
		maxAge: RESUME_CRITIQUE_TTL_SECONDS,
		secure: env.APP_URL.startsWith("https"),
	});

	responseHeaders.append("Set-Cookie", cookie);
};
