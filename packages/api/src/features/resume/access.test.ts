import { afterEach, describe, expect, it, vi } from "vitest";

const envMock = vi.hoisted(() => ({ APP_URL: "https://example.com", AUTH_SECRET: "test-resume-access-secret" }));

vi.mock("@reactive-resume/env/server", () => ({ env: envMock }));

const { hasResumeAccess, grantResumeAccess } = await import("./access");

const grantedCookie = (resumeId = "resume-42", passwordHash = "hash") => {
	const headers = new Headers();
	grantResumeAccess(headers, resumeId, passwordHash);
	const cookie = headers.get("Set-Cookie")?.split(";")[0];
	if (!cookie) throw new Error("Resume access grant did not issue a cookie.");
	return cookie;
};

afterEach(() => vi.restoreAllMocks());

describe("hasResumeAccess", () => {
	it("rejects replay after the signed ten-minute expiration, even when cookie is supplied manually", () => {
		const now = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
		const headers = new Headers({ cookie: grantedCookie() });
		expect(hasResumeAccess(headers, "resume-42", "hash")).toBe(true);
		now.mockReturnValue(1_800_000_599_999);
		expect(hasResumeAccess(headers, "resume-42", "hash")).toBe(true);
		now.mockReturnValue(1_800_000_600_000);
		expect(hasResumeAccess(headers, "resume-42", "hash")).toBe(false);
	});

	it("binds access to the signed expiration, resource and current password", () => {
		vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
		const cookie = grantedCookie();
		const headers = new Headers({ cookie });
		expect(hasResumeAccess(headers, "resume-42", "hash")).toBe(true);
		expect(hasResumeAccess(headers, "resume-42", "changed-password")).toBe(false);
		expect(hasResumeAccess(new Headers({ cookie: cookie.replace("resume-42", "other") }), "other", "hash")).toBe(false);
		expect(
			hasResumeAccess(new Headers({ cookie: cookie.replace("1800000600000", "1900000600000") }), "resume-42", "hash"),
		).toBe(false);
		const altered = `${cookie.slice(0, -1)}${cookie.endsWith("0") ? "1" : "0"}`;
		expect(hasResumeAccess(new Headers({ cookie: altered }), "resume-42", "hash")).toBe(false);
	});
});

describe("grantResumeAccess", () => {
	it("appends a signed Set-Cookie header scoped to the resume id with httpOnly + sameSite=lax + 10-minute TTL", () => {
		const responseHeaders = new Headers();

		grantResumeAccess(responseHeaders, "resume-42", "hash");

		const cookie = responseHeaders.get("Set-Cookie");
		expect(cookie).toMatch(/^resume_access_resume-42=\d+\.[a-f0-9]{64};/);
		expect(cookie).toContain("Path=/");
		expect(cookie).toContain("HttpOnly");
		expect(cookie).toContain("SameSite=Lax");
		expect(cookie).toContain("Max-Age=600");
	});

	it("only marks the cookie secure when APP_URL is https", () => {
		envMock.APP_URL = "http://localhost:3000";
		const localHeaders = new Headers();
		grantResumeAccess(localHeaders, "r", "h");
		expect(localHeaders.get("Set-Cookie")).not.toContain("Secure");

		envMock.APP_URL = "https://example.com";
		const productionHeaders = new Headers();
		grantResumeAccess(productionHeaders, "r", "h");
		expect(productionHeaders.get("Set-Cookie")).toContain("Secure");
	});
});
