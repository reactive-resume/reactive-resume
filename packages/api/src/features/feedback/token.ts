import { createHmac } from "node:crypto";
import { env } from "@reactive-resume/env/server";
import { safeEquals } from "../resume/access";

// A key of its own, derived from AUTH_SECRET, so a feedback token can't stand in for any other use of the secret.
const signingKey = () => createHmac("sha256", env.AUTH_SECRET).update("reactive-resume:feedback-link:v1").digest();

const signature = (linkId: string) => createHmac("sha256", signingKey()).update(linkId).digest("base64url");

/**
 * The secret part of a feedback link: `<linkId>~<signature>`. It isn't stored, so the owner can copy it again. `~` never
 * appears in a slug and the address has no dot, so it can't be mistaken for a resume's web page or a file.
 */
const feedbackToken = (linkId: string) => `${linkId}~${signature(linkId)}`;

/** The link ID a token was signed for, or null when it wasn't signed here. */
export function feedbackLinkIdFromToken(token: string): string | null {
	const separator = token.lastIndexOf("~");
	if (separator <= 0) return null;
	const linkId = token.slice(0, separator);
	return safeEquals(token, feedbackToken(linkId)) ? linkId : null;
}

export const feedbackUrl = (linkId: string) => `${env.APP_URL.replace(/\/+$/, "")}/feedback/${feedbackToken(linkId)}`;
