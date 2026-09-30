import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const envMock = vi.hoisted(() => ({ APP_URL: "https://example.com", AUTH_SECRET: "test-auth-secret" }));

vi.mock("@reactive-resume/env/server", () => ({ env: envMock }));

const { grantCritiquerCookie, readCritiquerIdFromCookie } = await import("./critique-access");

const signToken = (resumeId: string, critiquerId: string, critiquePasswordHash: string) =>
	createHmac("sha256", envMock.AUTH_SECRET).update(`${resumeId}:${critiquerId}:${critiquePasswordHash}`).digest("hex");

const requestHeadersWithCookie = (name: string, value: string) =>
	new Headers({ Cookie: `other=value; ${name}=${value}; theme=dark` });

describe("readCritiquerIdFromCookie", () => {
	it("returns null when no cookie is present", () => {
		expect(readCritiquerIdFromCookie(new Headers(), "resume-1", "hash")).toBeNull();
	});

	it("returns null when the cookie has no signature separator", () => {
		const headers = requestHeadersWithCookie("resume_critique_resume-1", "not-a-valid-token");
		expect(readCritiquerIdFromCookie(headers, "resume-1", "hash")).toBeNull();
	});

	it("round-trips the critiquer id granted for the same resume + password hash", () => {
		const responseHeaders = new Headers();
		grantCritiquerCookie(responseHeaders, "resume-1", "critiquer-42", "hash");

		const cookie = responseHeaders.get("Set-Cookie");
		expect(cookie).toBeTruthy();
		const cookiePair = cookie?.split(";")[0] ?? "";
		const requestHeaders = new Headers({ Cookie: cookiePair });

		expect(readCritiquerIdFromCookie(requestHeaders, "resume-1", "hash")).toBe("critiquer-42");
	});

	it("returns null when the signature does not match the expected HMAC", () => {
		const headers = requestHeadersWithCookie("resume_critique_resume-1", "critiquer-42.not-the-right-signature");
		expect(readCritiquerIdFromCookie(headers, "resume-1", "hash")).toBeNull();
	});

	it("invalidates the cookie once the critique password hash changes (rotation)", () => {
		const token = signToken("resume-1", "critiquer-42", "old-hash");
		const headers = requestHeadersWithCookie("resume_critique_resume-1", `critiquer-42.${token}`);

		expect(readCritiquerIdFromCookie(headers, "resume-1", "old-hash")).toBe("critiquer-42");
		expect(readCritiquerIdFromCookie(headers, "resume-1", "new-hash")).toBeNull();
	});

	it("does not resolve a cookie granted for a different resume id", () => {
		const responseHeaders = new Headers();
		grantCritiquerCookie(responseHeaders, "resume-1", "critiquer-42", "hash");
		const cookiePair = responseHeaders.get("Set-Cookie")?.split(";")[0] ?? "";

		// Simulate the cookie somehow being sent under a different resume's cookie name.
		const [, value] = cookiePair.split("=");
		const headers = new Headers({ Cookie: `resume_critique_resume-2=${value}` });

		expect(readCritiquerIdFromCookie(headers, "resume-2", "hash")).toBeNull();
	});
});

describe("grantCritiquerCookie", () => {
	it("appends a signed Set-Cookie header scoped to the resume id with httpOnly + sameSite=lax + 1-year TTL", () => {
		const responseHeaders = new Headers();

		grantCritiquerCookie(responseHeaders, "resume-42", "critiquer-1", "hash");

		const cookie = responseHeaders.get("Set-Cookie");
		expect(cookie).toContain(`resume_critique_resume-42=critiquer-1.${signToken("resume-42", "critiquer-1", "hash")}`);
		expect(cookie).toContain("Path=/");
		expect(cookie).toContain("HttpOnly");
		expect(cookie).toContain("SameSite=Lax");
		expect(cookie).toContain("Max-Age=31536000");
	});

	it("only marks the cookie secure when APP_URL is https", () => {
		envMock.APP_URL = "http://localhost:3000";
		const localHeaders = new Headers();
		grantCritiquerCookie(localHeaders, "r", "c", "h");
		expect(localHeaders.get("Set-Cookie")).not.toContain("Secure");

		envMock.APP_URL = "https://example.com";
		const productionHeaders = new Headers();
		grantCritiquerCookie(productionHeaders, "r", "c", "h");
		expect(productionHeaders.get("Set-Cookie")).toContain("Secure");
	});
});
