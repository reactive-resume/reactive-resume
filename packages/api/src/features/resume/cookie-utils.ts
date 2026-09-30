import { timingSafeEqual } from "node:crypto";

// Shared by access.ts (viewing-password gate) and critique-access.ts (critiquer identity) so the
// timing-safe comparison and cookie parsing/serialization logic isn't duplicated between them.

export const safeEquals = (value: string, expected: string) => {
	const valueBuffer = Buffer.from(value);
	const expectedBuffer = Buffer.from(expected);
	if (valueBuffer.length !== expectedBuffer.length) return false;
	return timingSafeEqual(valueBuffer, expectedBuffer);
};

export const parseCookieHeader = (cookieHeader: string | null): Map<string, string> => {
	const cookies = new Map<string, string>();
	if (!cookieHeader) return cookies;

	for (const part of cookieHeader.split(";")) {
		const [rawName, ...rawValue] = part.trim().split("=");
		if (!rawName || rawValue.length === 0) continue;

		cookies.set(rawName, rawValue.join("="));
	}

	return cookies;
};

export const serializeCookie = (
	name: string,
	value: string,
	options: { path: string; httpOnly: boolean; sameSite: "lax"; maxAge: number; secure: boolean },
) => {
	const parts = [`${name}=${value}`, `Path=${options.path}`, `Max-Age=${options.maxAge}`, "SameSite=Lax"];
	if (options.httpOnly) parts.push("HttpOnly");
	if (options.secure) parts.push("Secure");
	return parts.join("; ");
};
