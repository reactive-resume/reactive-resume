import { describe, expect, it } from "vitest";
import {
	assertOrcaRouterOriginAllowed,
	buildOrcaRouterAuthorizeUrl,
	buildOrcaRouterExchangeUrl,
	buildOrcaRouterModelsUrl,
	ORCAROUTER_API_BASE_URL_DEFAULT,
	ORCAROUTER_AUTH_BASE_URL_DEFAULT,
	resolveOrcaRouterOrigins,
} from "./origins";

describe("OrcaRouter origins", () => {
	it("defaults authentication and inference to two separate public origins", () => {
		const origins = resolveOrcaRouterOrigins();
		expect(origins.authBaseUrl).toBe(ORCAROUTER_AUTH_BASE_URL_DEFAULT);
		expect(origins.apiBaseUrl).toBe(ORCAROUTER_API_BASE_URL_DEFAULT);
		expect(buildOrcaRouterExchangeUrl(origins)).toBe("https://www.orcarouter.ai/api/v1/auth/keys");
		expect(buildOrcaRouterModelsUrl(origins)).toBe("https://api.orcarouter.ai/v1/models");
		expect(buildOrcaRouterAuthorizeUrl(origins, {})).toBe("https://www.orcarouter.ai/auth");
	});

	it("never derives one public origin from the other", () => {
		const origins = resolveOrcaRouterOrigins();
		// The single most common integration mistake: the relay is at /v1, the auth endpoints are not.
		expect(buildOrcaRouterExchangeUrl(origins)).toBe("https://www.orcarouter.ai/api/v1/auth/keys");
		expect(new URL(buildOrcaRouterExchangeUrl(origins)).origin).not.toBe(origins.apiBaseUrl);
		expect(buildOrcaRouterExchangeUrl(origins)).not.toBe("https://api.orcarouter.ai/v1/auth/keys");
		expect(buildOrcaRouterModelsUrl(origins)).not.toContain("www.orcarouter.ai");
	});

	it("uses one shared self-hosted base for both roles, adding /v1 only for inference", () => {
		const origins = resolveOrcaRouterOrigins({ sharedBaseUrl: "https://gateway.example.com" });
		expect(origins.authBaseUrl).toBe("https://gateway.example.com");
		expect(origins.apiBaseUrl).toBe("https://gateway.example.com/v1");
	});

	it("lets an explicit per-origin override win over the shared base", () => {
		const origins = resolveOrcaRouterOrigins({
			sharedBaseUrl: "https://gateway.example.com",
			authBaseUrl: "https://auth.example.com",
			apiBaseUrl: "https://api.example.com/v1",
		});
		expect(origins.authBaseUrl).toBe("https://auth.example.com");
		expect(origins.apiBaseUrl).toBe("https://api.example.com/v1");
	});

	it("requires https for remote origins and allows http only on loopback", () => {
		expect(() => assertOrcaRouterOriginAllowed("https://www.orcarouter.ai")).not.toThrow();
		expect(() => assertOrcaRouterOriginAllowed("http://127.0.0.1:8080")).not.toThrow();
		expect(() => assertOrcaRouterOriginAllowed("http://localhost:8080")).not.toThrow();
		expect(() => assertOrcaRouterOriginAllowed("http://evil.example.com")).toThrow("ORCAROUTER_INSECURE_ORIGIN");
	});

	it("strips credentials, query and fragment from a configured origin", () => {
		const origins = resolveOrcaRouterOrigins({ authBaseUrl: "https://user:pass@auth.example.com/?x=1#frag" });
		expect(origins.authBaseUrl).toBe("https://auth.example.com");
	});
});
