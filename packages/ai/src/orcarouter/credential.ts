/**
 * The credential seam.
 *
 * Both ways of getting an OrcaRouter key — pasting an existing `sk-orca-…` key, or completing the
 * PKCE connect flow — produce the same plain credential here. Nothing downstream (provider adapter,
 * model discovery, the AI entry points) can tell which one was used, and nothing downstream
 * duplicates either acquisition path.
 */

export const ORCAROUTER_API_KEY_PREFIX = "sk-orca-";

export type OrcaRouterCredentialMethod = "api_key" | "pkce";

export type OrcaRouterCredential = {
	key: string;
	method: OrcaRouterCredentialMethod;
	/** The scope OrcaRouter granted, when the flow reported one. */
	scope: string | null;
	issuedAt: string;
};

export function credentialMethodLabel(method: OrcaRouterCredentialMethod): "API key" | "OrcaRouter account" {
	return method === "pkce" ? "OrcaRouter account" : "API key";
}

/**
 * A pasted key is only checked for shape. An `sk-orca-` prefix is not proof that it is valid, and
 * OrcaRouter exposes no non-billing validation request, so validity is established by the first
 * real request (or by the connection test) instead.
 */
export function isPlausibleOrcaRouterApiKey(key: string): boolean {
	const trimmed = key.trim();
	return trimmed.length > 12 && trimmed.startsWith(ORCAROUTER_API_KEY_PREFIX);
}

export function credentialFromApiKey(key: string): OrcaRouterCredential {
	const trimmed = key.trim();
	if (!trimmed) throw new Error("ORCAROUTER_API_KEY_REQUIRED");

	return { key: trimmed, method: "api_key", scope: null, issuedAt: new Date().toISOString() };
}

export function credentialFromPkce(input: { key: string; scope: string | null }): OrcaRouterCredential {
	const trimmed = input.key.trim();
	if (!trimmed) throw new Error("ORCAROUTER_PKCE_KEY_MISSING");

	return { key: trimmed, method: "pkce", scope: input.scope, issuedAt: new Date().toISOString() };
}

/**
 * A PKCE-issued key is a durable key, not a refresh token: there is no refresh grant to call and it
 * must simply be reused until OrcaRouter revokes it. This is the only "refresh" behaviour the
 * connector has, and it exists so callers cannot accidentally implement a fake one.
 */
export function reuseStoredOrcaRouterCredential(credential: OrcaRouterCredential): OrcaRouterCredential {
	return credential;
}
