import { describe, expect, it } from "vitest";
import { authSearchSchema, getAuthRedirectOptions, getOAuthPasskeyOptions, getOAuthSignInOptions } from "./redirect";

describe("authentication callback", () => {
	it.each([{}, { reauthenticate: true }])("accepts auth routes without a callback query: %j", (search) => {
		expect(authSearchSchema.parse(search)).toEqual(search);
	});
	it("preserves a signed OAuth callback including repeated resources", () => {
		const callbackURL =
			"/api/auth/oauth?client_id=client&resource=https%3A%2F%2Fapp.example%2Fmcp&resource=https%3A%2F%2Fapp.example&exp=123&sig=signed";
		expect(authSearchSchema.parse({ callbackURL })).toEqual({ callbackURL });
		expect(getAuthRedirectOptions(callbackURL)).toEqual({ href: callbackURL, reloadDocument: true, replace: true });
	});
	it.each([
		undefined,
		123,
		"https://evil.example",
		"//evil.example",
		"/\\evil.example",
		"/%2f%2fevil.example",
		"/%5cevil.example",
		"/\tevil.example",
		"javascript:alert(1)",
	])("falls back for unsafe callback %s", (callbackURL) => {
		expect(authSearchSchema.parse({ callbackURL }).callbackURL).toBeUndefined();
		expect(getAuthRedirectOptions(callbackURL)).toEqual({ href: "/dashboard", reloadDocument: false, replace: true });
	});
	it("accepts application paths without interpreting nested URL query values", () => {
		const callbackURL = "/dashboard?next=https%3A%2F%2Fexample.com";
		expect(authSearchSchema.parse({ callbackURL }).callbackURL).toBe(callbackURL);
	});
	it("routes internal SPA paths without reloading document", () => {
		expect(getAuthRedirectOptions("/dashboard")).toEqual({
			href: "/dashboard",
			reloadDocument: false,
			replace: true,
		});
		expect(getAuthRedirectOptions("/builder/resume-123")).toEqual({
			href: "/builder/resume-123",
			reloadDocument: false,
			replace: true,
		});
	});
});

describe("signed OAuth sign-in context", () => {
	it("forwards the original signed query without decoding or dropping repeated resources", () => {
		const query = "resource=one&resource=two&prompt=login&exp=123&sig=signed";
		expect(getOAuthSignInOptions(`/api/auth/oauth?${query}`)).toEqual({ oauth_query: query });
	});
	it.each(["https://evil.example/api/auth/oauth?sig=signed", "/dashboard?sig=signed", "/api/auth/oauth?prompt=login"])(
		"does not attach OAuth context from %s",
		(callbackURL) => {
			expect(getOAuthSignInOptions(callbackURL)).toEqual({});
		},
	);
});

describe("passkey OAuth context", () => {
	it("adds signed context to the actual WebAuthn verification request without dropping the assertion", () => {
		const request = {
			body: JSON.stringify({ response: { id: "credential", response: { signature: "webauthn-signature" } } }),
		};
		getOAuthPasskeyOptions("/api/auth/oauth?prompt=login&sig=signed").fetchOptions.onRequest(request);
		expect(JSON.parse(request.body)).toEqual({
			response: { id: "credential", response: { signature: "webauthn-signature" } },
			oauth_query: "prompt=login&sig=signed",
		});
	});
});
