import { randomUUID } from "node:crypto";
import { ORPCError } from "@orpc/client";
import { createPkceAttempt, exchangeOrcaRouterCode, OrcaRouterConnectError } from "@reactive-resume/ai/orcarouter/pkce";
import { aiProvidersService } from "../../ai-providers/service";
import { pendingConnectStore, PENDING_CONNECT_TTL_SECONDS } from "./connect-store";
import { resolveOrcaRouterOrigins } from "./origins";

export type BeginConnectInput = {
	userId: string;
	/** Continue an existing OrcaRouter provider row instead of creating a new one. */
	providerId?: string | null;
	label?: string | null;
	/** Display-only hints for the consent screen; neither carries authority. */
	loginHint?: string | null;
	workspaceHint?: string | null;
	prompt?: "consent" | null;
};

export type BeginConnectResult = {
	connectId: string;
	authorizeUrl: string;
	expiresInSeconds: number;
};

type CompleteConnectResult = {
	providerId: string;
	method: "pkce";
	scope: string | null;
};

/**
 * Starts a Flow B (out-of-band) PKCE authorization.
 *
 * Flow B is used because this client is a hosted web UI: the browser that shows the consent screen is
 * not on the same machine as the server that holds the verifier, so there is no loopback address the
 * server could listen on and no redirect URI to pre-register. The code is displayed and pasted back.
 */
export const orcaRouterConnectService = {
	begin: async (input: BeginConnectInput): Promise<BeginConnectResult> => {
		// Only a provider row this user owns can be reconnected; a foreign id is rejected before any
		// pending state is kept.
		if (input.providerId) await aiProvidersService.assertOwnedProvider({ id: input.providerId, userId: input.userId });

		const origins = resolveOrcaRouterOrigins();
		const attempt = createPkceAttempt({
			origins,
			loginHint: input.loginHint?.trim() || undefined,
			workspaceHint: input.workspaceHint?.trim() || undefined,
			prompt: input.prompt === "consent" ? "consent" : undefined,
		});

		const connectId = randomUUID();
		await pendingConnectStore.save(connectId, {
			userId: input.userId,
			verifier: attempt.verifier,
			state: attempt.state,
			authorizeUrl: attempt.authorizeUrl,
			label: input.label?.trim() || null,
			providerId: input.providerId ?? null,
			attempt: 1,
			createdAt: Date.now(),
		});

		return { connectId, authorizeUrl: attempt.authorizeUrl, expiresInSeconds: PENDING_CONNECT_TTL_SECONDS };
	},

	cancel: async (input: { connectId: string; userId: string }) => {
		const stored = await pendingConnectStore.get(input.connectId);
		// Cancelling an attempt that already finished, expired, or belongs to someone else changes
		// nothing, and must not reveal whether the id exists.
		if (stored && stored.userId === input.userId) await pendingConnectStore.remove(input.connectId);
		return { status: "cancelled" as const };
	},

	/** Confirms the attempt still belongs to this user without exposing the verifier or the authorize URL. */
	status: async (input: { connectId: string; userId: string }) => {
		const stored = await pendingConnectStore.get(input.connectId);
		if (!stored || stored.userId !== input.userId) return { status: "cancelled" as const };
		const remaining = PENDING_CONNECT_TTL_SECONDS * 1000 - (Date.now() - stored.createdAt);
		return { status: "pending" as const, remainingSeconds: Math.max(0, Math.round(remaining / 1000)) };
	},

	/**
	 * Reads the pending attempt. Exposed as part of the service so a test can assert that the verifier
	 * never appears in anything handed to the browser, without reaching into the store module.
	 */
	peekPendingAttempt: (connectId: string) => pendingConnectStore.get(connectId),

	/**
	 * Redeems the pasted code. The verifier never leaves the server, and the returned key goes straight
	 * into the project's existing encrypted credential store — the same one the API-key path uses.
	 */
	complete: async (input: { userId: string; connectId: string; code: string }): Promise<CompleteConnectResult> => {
		const code = input.code.trim();
		if (!code) throw new ORPCError("BAD_REQUEST", { message: "Paste the code OrcaRouter showed you." });

		const stored = await pendingConnectStore.get(input.connectId);
		if (!stored || stored.userId !== input.userId) {
			throw new ORPCError("BAD_REQUEST", {
				message: "That connection attempt has expired or was cancelled. Start it again.",
			});
		}
		if (Date.now() - stored.createdAt > PENDING_CONNECT_TTL_SECONDS * 1000) {
			await pendingConnectStore.remove(input.connectId);
			throw new ORPCError("BAD_REQUEST", {
				message: "That connection attempt expired. OrcaRouter codes last 10 minutes; start it again.",
			});
		}

		const origins = resolveOrcaRouterOrigins();
		let exchanged: { key: string; scope: string };
		try {
			exchanged = await exchangeOrcaRouterCode({ origins, code, verifier: stored.verifier });
		} catch (error) {
			if (error instanceof OrcaRouterConnectError && error.failure.terminal) {
				// A terminal failure (denied, expired, already used, verifier mismatch, scope downgrade, 429)
				// leaves nothing to retry with the same attempt; keeping it would only invite a hot loop.
				await pendingConnectStore.remove(input.connectId);
			}
			const message = error instanceof OrcaRouterConnectError ? error.failure.message : "Could not finish connecting.";
			throw new ORPCError("BAD_REQUEST", { message });
		}

		// The code is single-use and is consumed the moment the exchange succeeds.
		await pendingConnectStore.remove(input.connectId);

		const credential = { apiKey: exchanged.key, credentialMethod: "pkce", credentialScope: exchanged.scope };
		const provider = stored.providerId
			? await aiProvidersService.replaceCredential({
					id: stored.providerId,
					userId: input.userId,
					...credential,
					...(stored.label ? { label: stored.label } : {}),
				})
			: await aiProvidersService.create({
					userId: input.userId,
					label: stored.label ?? "OrcaRouter",
					provider: "orcarouter",
					model: "",
					...credential,
				});

		return { providerId: provider.id, method: "pkce", scope: exchanged.scope };
	},
};
