import { createHmac, timingSafeEqual } from "node:crypto";
import { parseCookies } from "better-auth/cookies";
import { env } from "@reactive-resume/env/server";

const RESUME_ACCESS_COOKIE_PREFIX = "resume_access";
const RESUME_ACCESS_TTL_SECONDS = 60 * 10; // 10 minutes

const getResumeAccessCookieName = (resumeId: string) => `${RESUME_ACCESS_COOKIE_PREFIX}_${resumeId}`;

// A key of its own, derived from AUTH_SECRET, so this signature can't stand in for any other use of the secret.
const accessKey = () => createHmac("sha256", env.AUTH_SECRET).update("reactive-resume:resume-access:v1").digest();

const signResumeAccessToken = (resumeId: string, passwordHash: string, expires: number): string =>
	createHmac("sha256", accessKey())
		.update(JSON.stringify([resumeId, passwordHash, expires]))
		.digest("hex");

export const safeEquals = (value: string, expected: string) => {
	const valueBuffer = Buffer.from(value);
	const expectedBuffer = Buffer.from(expected);
	if (valueBuffer.length !== expectedBuffer.length) return false;
	return timingSafeEqual(valueBuffer, expectedBuffer);
};

export const hasResumeAccess = (requestHeaders: Headers, resumeId: string, passwordHash: string | null) => {
	if (!passwordHash) return false;
	const cookieName = getResumeAccessCookieName(resumeId);
	const cookieValue = parseCookies(requestHeaders.get("cookie") ?? "").get(cookieName);
	if (!cookieValue) return false;
	const match = /^(\d+)\.([a-f0-9]{64})$/.exec(cookieValue);
	if (!match) return false;
	const expires = Number(match[1]);
	if (!Number.isSafeInteger(expires) || expires <= Date.now()) return false;
	const expected = `${expires}.${signResumeAccessToken(resumeId, passwordHash, expires)}`;
	return safeEquals(cookieValue, expected);
};

export const grantResumeAccess = (responseHeaders: Headers, resumeId: string, passwordHash: string) => {
	const expires = Date.now() + RESUME_ACCESS_TTL_SECONDS * 1000;
	const value = `${getResumeAccessCookieName(resumeId)}=${expires}.${signResumeAccessToken(resumeId, passwordHash, expires)}`;
	const secure = env.APP_URL.startsWith("https") ? "; Secure" : "";
	responseHeaders.append(
		"Set-Cookie",
		`${value}; Path=/; Max-Age=${RESUME_ACCESS_TTL_SECONDS}; SameSite=Lax; HttpOnly${secure}`,
	);
};

const PREVIEW_TTL_MS = 15 * 60 * 1000;
// Its own key too: a preview link can't be forged from, or stand in for, an access cookie.
const previewKey = () => createHmac("sha256", env.AUTH_SECRET).update("reactive-resume:web-page-preview:v1").digest();
const signPreview = (resumeId: string, expires: number) =>
	createHmac("sha256", previewKey())
		.update(JSON.stringify([resumeId, expires]))
		.digest("hex");

/** A short-lived token that shows the owner's web page as visitors will see it, even before it's published. */
export const createPreviewToken = (resumeId: string, now = Date.now()) => {
	const expires = now + PREVIEW_TTL_MS;
	return `${expires}.${signPreview(resumeId, expires)}`;
};

export const isValidPreviewToken = (token: string, resumeId: string, now = Date.now()) => {
	const [expires, signature] = token.split(".");
	const time = Number(expires);
	if (!signature || !Number.isSafeInteger(time) || time < now) return false;
	return safeEquals(signature, signPreview(resumeId, time));
};
