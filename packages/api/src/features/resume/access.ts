import { createHmac, timingSafeEqual } from "node:crypto";
import { parseCookies } from "better-auth/cookies";
import { env } from "@reactive-resume/env/server";

const RESUME_ACCESS_COOKIE_PREFIX = "resume_access";
const RESUME_ACCESS_TTL_SECONDS = 60 * 10; // 10 minutes

const getResumeAccessCookieName = (resumeId: string) => `${RESUME_ACCESS_COOKIE_PREFIX}_${resumeId}`;

/**
 * Signs `parts` with a key of the purpose's own, derived from AUTH_SECRET, so one kind of token can't be forged from, or
 * stand in for, another use of the secret.
 */
const sign = (purpose: "resume-access" | "web-page-preview", parts: unknown[]) =>
	createHmac("sha256", createHmac("sha256", env.AUTH_SECRET).update(`reactive-resume:${purpose}:v1`).digest())
		.update(JSON.stringify(parts))
		.digest("hex");

/** A token that holds until `expires`: `<expires>.<signature>`. */
const token = (purpose: Parameters<typeof sign>[0], parts: unknown[], expires: number) =>
	`${expires}.${sign(purpose, [...parts, expires])}`;

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
	return safeEquals(cookieValue, token("resume-access", [resumeId, passwordHash], expires));
};

export const grantResumeAccess = (responseHeaders: Headers, resumeId: string, passwordHash: string) => {
	const expires = Date.now() + RESUME_ACCESS_TTL_SECONDS * 1000;
	const value = `${getResumeAccessCookieName(resumeId)}=${token("resume-access", [resumeId, passwordHash], expires)}`;
	const secure = env.APP_URL.startsWith("https") ? "; Secure" : "";
	responseHeaders.append(
		"Set-Cookie",
		`${value}; Path=/; Max-Age=${RESUME_ACCESS_TTL_SECONDS}; SameSite=Lax; HttpOnly${secure}`,
	);
};

const PREVIEW_TTL_MS = 15 * 60 * 1000;

/** A short-lived token that shows the owner's web page as visitors will see it, even before it's published. */
export const createPreviewToken = (resumeId: string, now = Date.now()) =>
	token("web-page-preview", [resumeId], now + PREVIEW_TTL_MS);

export const isValidPreviewToken = (value: string, resumeId: string, now = Date.now()) => {
	const [expires, signature] = value.split(".");
	const time = Number(expires);
	if (!signature || !Number.isSafeInteger(time) || time < now) return false;
	return safeEquals(value, token("web-page-preview", [resumeId], time));
};
