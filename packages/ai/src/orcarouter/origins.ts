/**
 * OrcaRouter has two separate public origins and one shared self-hosted override:
 *
 * - authentication (consent screen and code exchange): `https://www.orcarouter.ai`
 * - inference and model discovery: `https://api.orcarouter.ai/v1`
 *
 * They are never derived from one another. `api.orcarouter.ai/v1/auth/keys` is a 404; the auth
 * endpoints live under `/api/v1/auth` on the `www` host.
 */

import type { OrcaRouterCapability } from "./catalog";

export const ORCAROUTER_AUTH_BASE_URL_DEFAULT = "https://www.orcarouter.ai";
export const ORCAROUTER_API_BASE_URL_DEFAULT = "https://api.orcarouter.ai/v1";
export const ORCAROUTER_AUTHORIZE_PATH = "/auth";
export const ORCAROUTER_EXCHANGE_PATH = "/api/v1/auth/keys";
export const ORCAROUTER_KEY_DASHBOARD_URL = "https://www.orcarouter.ai/console/authorized-apps";
export const ORCAROUTER_LOGO_URL = "https://www.orcarouter.ai/orca-logo-classic.png";

/** `api` is the only scope this app needs; the response's `scope` is what was granted, not what was asked. */
export const ORCAROUTER_SCOPE = "api";

export const ORCAROUTER_APP_NAME = "Reactive Resume";

export type OrcaRouterOrigins = {
	authBaseUrl: string;
	apiBaseUrl: string;
};

export type OrcaRouterOriginInput = {
	sharedBaseUrl?: string | null | undefined;
	authBaseUrl?: string | null | undefined;
	apiBaseUrl?: string | null | undefined;
};

function trimOrUndefined(value: string | null | undefined) {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function normalizeOrigin(value: string, expectedPathSuffix?: string) {
	const parsed = new URL(value);
	parsed.username = "";
	parsed.password = "";
	parsed.hash = "";
	parsed.search = "";
	let pathname = parsed.pathname.replace(/\/+$/, "");
	if (expectedPathSuffix && !pathname.endsWith(expectedPathSuffix)) pathname = `${pathname}${expectedPathSuffix}`;
	parsed.pathname = pathname || "/";
	return parsed.toString().replace(/\/$/, "");
}

/**
 * Explicit per-origin overrides win over a shared self-hosted base; the public defaults fill in
 * whatever is left. A shared base names one origin that serves both roles, so it is used verbatim
 * for auth and given the documented `/v1` suffix for inference; an explicit API override is taken
 * exactly as written and never rewritten.
 */
export function resolveOrcaRouterOrigins(input: OrcaRouterOriginInput = {}): OrcaRouterOrigins {
	const shared = trimOrUndefined(input.sharedBaseUrl);
	const authOverride = trimOrUndefined(input.authBaseUrl);
	const apiOverride = trimOrUndefined(input.apiBaseUrl);

	return {
		authBaseUrl: authOverride
			? normalizeOrigin(authOverride)
			: shared
				? normalizeOrigin(shared)
				: ORCAROUTER_AUTH_BASE_URL_DEFAULT,
		apiBaseUrl: apiOverride
			? normalizeOrigin(apiOverride)
			: shared
				? normalizeOrigin(shared, "/v1")
				: ORCAROUTER_API_BASE_URL_DEFAULT,
	};
}

/** HTTPS is required for anything remote; plain HTTP is only accepted on loopback. */
export function assertOrcaRouterOriginAllowed(origin: string) {
	const parsed = new URL(origin);
	if (!parsed.hostname) throw new Error("ORCAROUTER_INVALID_ORIGIN");
	if (parsed.protocol === "https:") return;
	if (parsed.protocol !== "http:") throw new Error("ORCAROUTER_INSECURE_ORIGIN");

	const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
	const isLoopback =
		hostname === "localhost" || hostname === "::1" || /^127(?:\.\d{1,3}){3}$/.test(hostname) || hostname === "0.0.0.0";
	if (!isLoopback) throw new Error("ORCAROUTER_INSECURE_ORIGIN");
}

export function buildOrcaRouterAuthorizeUrl(origins: OrcaRouterOrigins, params: Record<string, string>) {
	const url = new URL(ORCAROUTER_AUTHORIZE_PATH, `${origins.authBaseUrl}/`);
	for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
	return url.toString();
}

export function buildOrcaRouterExchangeUrl(origins: OrcaRouterOrigins) {
	return new URL(ORCAROUTER_EXCHANGE_PATH, `${origins.authBaseUrl}/`).toString();
}

export function buildOrcaRouterModelsUrl(origins: OrcaRouterOrigins, capability?: OrcaRouterCapability) {
	const url = new URL(`${origins.apiBaseUrl}/models`);
	if (capability) url.searchParams.set("capability", capability);
	return url.toString();
}
