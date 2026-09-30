import { createHash } from "node:crypto";
import { env } from "@reactive-resume/env/server";
import { parseCookieHeader, safeEquals, serializeCookie } from "./cookie-utils";

const RESUME_ACCESS_COOKIE_PREFIX = "resume_access";
const RESUME_ACCESS_TTL_SECONDS = 60 * 10; // 10 minutes

const getResumeAccessCookieName = (resumeId: string) => `${RESUME_ACCESS_COOKIE_PREFIX}_${resumeId}`;

const signResumeAccessToken = (resumeId: string, passwordHash: string): string =>
	createHash("sha256").update(`${resumeId}:${passwordHash}`).digest("hex");

export const hasResumeAccess = (requestHeaders: Headers, resumeId: string, passwordHash: string | null) => {
	if (!passwordHash) return false;
	const cookieName = getResumeAccessCookieName(resumeId);
	const cookieValue = parseCookieHeader(requestHeaders.get("cookie")).get(cookieName);
	if (!cookieValue) return false;
	const expected = signResumeAccessToken(resumeId, passwordHash);
	return safeEquals(cookieValue, expected);
};

export const grantResumeAccess = (responseHeaders: Headers, resumeId: string, passwordHash: string) => {
	const cookie = serializeCookie(getResumeAccessCookieName(resumeId), signResumeAccessToken(resumeId, passwordHash), {
		path: "/",
		httpOnly: true,
		sameSite: "lax",
		maxAge: RESUME_ACCESS_TTL_SECONDS,
		secure: env.APP_URL.startsWith("https"),
	});

	responseHeaders.append("Set-Cookie", cookie);
};
