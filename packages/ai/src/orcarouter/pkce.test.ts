import { describe, expect, it } from "vitest";
import { resolveOrcaRouterOrigins } from "./origins";
import {
	base64Url,
	buildExchangeRequestBody,
	classifyExchangeResponse,
	createCodeChallenge,
	createPkceAttempt,
	constantTimeEqual,
	exchangeOrcaRouterCode,
	OrcaRouterConnectError,
	scopeSatisfies,
} from "./pkce";

describe("OrcaRouter PKCE", () => {
	it("issues a fresh S256 challenge and state per attempt, with no padding", () => {
		const first = createPkceAttempt({ origins: resolveOrcaRouterOrigins() });
		const second = createPkceAttempt({ origins: resolveOrcaRouterOrigins() });

		expect(first.verifier).not.toBe(second.verifier);
		expect(first.state).not.toBe(second.state);
		expect(first.challenge).toBe(createCodeChallenge(first.verifier));
		expect(first.challenge).not.toContain("=");
		expect(first.verifier).not.toContain("=");
		expect(first.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});

	it("sends only the challenge on the authorize URL, never the verifier", () => {
		const attempt = createPkceAttempt({ origins: resolveOrcaRouterOrigins() });
		const url = new URL(attempt.authorizeUrl);

		expect(url.origin).toBe("https://www.orcarouter.ai");
		expect(url.pathname).toBe("/auth");
		expect(url.searchParams.get("callback_url")).toBe("oob");
		expect(url.searchParams.get("code_challenge_method")).toBe("S256");
		expect(url.searchParams.get("code_challenge")).toBe(attempt.challenge);
		expect(url.searchParams.get("state")).toBe(attempt.state);
		expect(url.searchParams.get("scope")).toBe("api");
		expect(attempt.authorizeUrl).not.toContain(attempt.verifier);
	});

	it("uses the auth origin for both authorize and exchange", () => {
		const origins = resolveOrcaRouterOrigins({
			authBaseUrl: "https://auth.example.com",
			apiBaseUrl: "https://api.example.com/v1",
		});
		const attempt = createPkceAttempt({ origins });
		expect(new URL(attempt.authorizeUrl).origin).toBe("https://auth.example.com");
		expect(attempt.authorizeUrl).not.toContain("api.example.com");
	});

	it("compares state in constant time and rejects a mismatch", () => {
		expect(constantTimeEqual("abc", "abc")).toBe(true);
		expect(constantTimeEqual("abc", "abd")).toBe(false);
		expect(constantTimeEqual("abc", "abcd")).toBe(false);
		expect(constantTimeEqual("", "")).toBe(false);
	});

	it("returns the approved scope only when it satisfies the api scope", () => {
		expect(scopeSatisfies("api")).toBe(true);
		expect(scopeSatisfies("api connector")).toBe(true);
		expect(scopeSatisfies("connector")).toBe(false);
		expect(scopeSatisfies("")).toBe(false);
		expect(scopeSatisfies(null)).toBe(false);
	});

	it("classifies exchange responses into actionable, non-leaking failures", () => {
		expect(classifyExchangeResponse(200, { key: "sk-orca-live-key", scope: "api" })).toBeNull();
		expect(classifyExchangeResponse(200, { key: "sk-orca-live-key" })?.code).toBe("scope_downgrade");
		expect(classifyExchangeResponse(200, { key: "  " })?.code).toBe("malformed_response");
		expect(classifyExchangeResponse(400, { error: "invalid_request" })?.code).toBe("challenge_method");
		expect(classifyExchangeResponse(403, { error: "invalid_grant" })?.code).toBe("invalid_code");
		expect(classifyExchangeResponse(429, {})?.code).toBe("rate_limited");
		expect(classifyExchangeResponse(500, {})).toMatchObject({ code: "provider_error", terminal: false });

		const denial = classifyExchangeResponse(403, { error: "access_denied" });
		expect(denial?.terminal).toBe(true);
		expect(denial?.message).not.toContain("sk-orca");
	});

	it("never mutates the code verifier into anything weaker", () => {
		expect(buildExchangeRequestBody("code-1", "verifier-1")).toEqual({
			code: "code-1",
			code_verifier: "verifier-1",
			code_challenge_method: "S256",
		});
		expect(base64Url(Buffer.alloc(0))).toBe("");
	});
});

describe("exchangeOrcaRouterCode", () => {
	const origins = resolveOrcaRouterOrigins();
	const attempt = createPkceAttempt({ origins });

	it("posts the exchange to the documented auth path with the verifier in the body", async () => {
		const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
		const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
			calls.push({ url: String(url), init });
			return Response.json({ key: "sk-orca-from-pkce", user_id: "12345", scope: "api" });
		}) as unknown as typeof fetch;

		const result = await exchangeOrcaRouterCode({ origins, code: "code-1", verifier: attempt.verifier, fetchImpl });

		expect(result).toEqual({ key: "sk-orca-from-pkce", scope: "api" });
		expect(calls[0]?.url).toBe("https://www.orcarouter.ai/api/v1/auth/keys");
		// The documented mistake: the relay is at /v1, the auth endpoints are not. Different origin and
		// different path from the inference base.
		expect(new URL(String(calls[0]?.url)).origin).toBe("https://www.orcarouter.ai");
		expect(calls[0]?.url).not.toBe("https://api.orcarouter.ai/v1/auth/keys");
		expect(calls[0]?.url).not.toContain("api.orcarouter.ai");
		const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, string>;
		expect(body).toEqual({ code: "code-1", code_verifier: attempt.verifier, code_challenge_method: "S256" });
	});

	it("reports a transport failure as unreachable without echoing the verifier or the code", async () => {
		const fetchImpl = (async () => {
			throw new Error(`connect ECONNREFUSED ${attempt.verifier}`);
		}) as unknown as typeof fetch;

		const error = await exchangeOrcaRouterCode({
			origins,
			code: "code-1",
			verifier: attempt.verifier,
			fetchImpl,
		}).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(OrcaRouterConnectError);
		expect((error as OrcaRouterConnectError).failure.code).toBe("unreachable");
		expect((error as Error).message).not.toContain(attempt.verifier);
		expect((error as Error).message).not.toContain("code-1");
	});

	it("turns a reused or expired code into a terminal failure", async () => {
		const fetchImpl = (async () =>
			Response.json(
				{ error: "invalid_grant", error_description: "code already used" },
				{ status: 403 },
			)) as unknown as typeof fetch;

		const error = (await exchangeOrcaRouterCode({
			origins,
			code: "code-used",
			verifier: attempt.verifier,
			fetchImpl,
		}).catch((caught: unknown) => caught)) as OrcaRouterConnectError;

		expect(error.failure).toMatchObject({ code: "invalid_code", terminal: true });
		expect(error.message).toBe("code already used");
	});

	it("turns a bare 403 into an actionable message that still explains the 10 minute code TTL", async () => {
		const fetchImpl = (async () => new Response("", { status: 403 })) as unknown as typeof fetch;

		const error = (await exchangeOrcaRouterCode({
			origins,
			code: "code-used",
			verifier: attempt.verifier,
			fetchImpl,
		}).catch((caught: unknown) => caught)) as OrcaRouterConnectError;

		expect(error.message).toContain("Codes last 10 minutes");
	});
});
