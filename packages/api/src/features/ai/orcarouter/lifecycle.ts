import { APICallError } from "ai";
import { aiProvidersService } from "../../ai-providers/service";

/**
 * Terminal `401` handling for OrcaRouter.
 *
 * A PKCE-issued key is durable, not a refresh token: there is no refresh grant to call, so an
 * authentication rejection means the user has to reconnect. The transition is bound to the exact
 * credential generation that made the rejected request, so a late failure from an old request cannot
 * mark a key that has already been replaced as broken. The stored secret is left in place until a
 * successful reconnect replaces it.
 */

const REAUTH_REASON = "OrcaRouter no longer accepts this key. Connect again to keep using OrcaRouter.";

export function isAuthenticationRejection(error: unknown): boolean {
	let current: unknown = error;
	for (let depth = 0; depth < 8 && current !== null && current !== undefined; depth++) {
		if (APICallError.isInstance(current) && (current.statusCode === 401 || current.statusCode === 403)) return true;
		current = (current as { cause?: unknown }).cause;
	}
	return false;
}

export type RejectedProvider = {
	id: string;
	provider: string;
	/** The key fingerprint captured when this request claimed its credential. */
	apiKeyFingerprint: string;
};

/**
 * Marks the exact provider + credential generation as needing reauthentication. Returns whether this
 * call performed the transition. Never called for a provider that is not OrcaRouter, and never
 * attempts a refresh.
 */
export function markOrcaRouterCredentialRejected(input: {
	userId: string;
	provider: RejectedProvider;
	error: unknown;
}): Promise<boolean> {
	if (input.provider.provider !== "orcarouter") return Promise.resolve(false);
	if (!isAuthenticationRejection(input.error)) return Promise.resolve(false);

	// Never let a bookkeeping transition break the user-facing error path.
	return aiProvidersService
		.markNeedsReauth({
			id: input.provider.id,
			userId: input.userId,
			credentialGeneration: input.provider.apiKeyFingerprint,
			reason: REAUTH_REASON,
		})
		.catch((error: unknown) => {
			console.error("[orca] Failed to record reauthentication state", error);
			return false;
		});
}
