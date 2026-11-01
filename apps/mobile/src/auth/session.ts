/**
 * The signed-in session: which server the app talks to and its OAuth tokens. Tokens live only in SecureStore
 * (Keychain / Keystore) and are never logged, rendered or written anywhere else.
 *
 * Sign-in (M3-T1) is OAuth 2.1 authorization code + PKCE (S256) in the system browser, against any server:
 * - Discovery from `<server>/.well-known/oauth-authorization-server`; dynamic client registration once per server,
 *   with `client_id` cached in SecureStore by server origin. Re-register only when the token endpoint answers
 *   `invalid_client`.
 * - Send `resource=<server origin>` (RFC 8707) on authorize, token and refresh requests. Without it the server issues
 *   an opaque access token that `/api/rpc` rejects.
 * - The redirect is `https://rxresu.me/auth/native-callback` for every server (the app's associated domain, through
 *   Universal Links / App Links); see `redirectUri` in oauth.ts. On iOS pass `preferUniversalLinks: true` to
 *   `promptAsync`.
 * - Mix-up defence: discovery must name the chosen origin as issuer and endpoint host (oauth.ts `discover`); the
 *   redirect must carry the request's `state` and, when the server advertises RFC 9207, its `iss`.
 * - Every session transition (sign-in commit, sign-out, refresh, expiry) runs through one queue, so none interleave.
 * - Refresh is single-flight. A refresh whose answer never arrived may have rotated the token on the server; sending
 *   the old one again would look like a replay and revoke the family. So it is never sent again: a persisted marker
 *   turns a lost answer (or a process kill) into `expired`.
 * - Each account (sign-in) gets a new identity number. Requests carry it; a 401 retry or refresh for an account that
 *   is no longer current fails instead of borrowing the new account's token.
 */
import { i18n } from "@lingui/core";
import * as AuthSession from "expo-auth-session";
import * as Network from "expo-network";
import * as SecureStore from "expo-secure-store";
import Storage from "expo-sqlite/kv-store";
import * as WebBrowser from "expo-web-browser";
import { useSyncExternalStore } from "react";
import { fnv1a } from "@reactive-resume/utils/string";
import {
	discover,
	forgetClient,
	getClientId,
	isAllowedServer,
	parseAuthorizationResponse,
	redirectUri,
	registerClient,
	scopes,
	storeKey,
} from "./oauth";

export const DEFAULT_SERVER = "https://rxresu.me";

/**
 * - `loading`: tokens are being read from SecureStore at launch.
 * - `signed-out`: no tokens for the current server.
 * - `signed-in`: an access token (or a refresh token to get one) is stored.
 * - `expired`: the refresh token was rejected; the user must sign in again. The server is kept.
 */
export type SessionStatus = "loading" | "signed-out" | "signed-in" | "expired";

export type Session = {
	status: SessionStatus;
	/** The server origin, for example `https://rxresu.me`. */
	server: string;
};

export type Tokens = {
	accessToken: string;
	refreshToken?: string | undefined;
	/** Unix seconds. */
	expiresAt?: number | undefined;
};

const serverKey = "server";
const tokensKey = (server: string) => storeKey("tokens", server);
// Set while a refresh request is out; holds a fingerprint of the refresh token it sent.
const refreshMarkerKey = (server: string) => storeKey("refreshing", server);
// Refresh this long before the access token expires, so a request never leaves with a token about to lapse.
const expirySkewSeconds = 60;
const refreshTimeout = 20_000;
const revokeTimeout = 5_000;

let session: Session = { status: "loading", server: DEFAULT_SERVER };
let tokens: Tokens | null = null;
// The signed-in account, `JSON.stringify([server, sub])` (the draft store's scope). Kept through `expired`, so signing
// out from there still clears that account's drafts; cleared on sign-out.
let accountScope: string | null = null;
// Changes whenever the account behind the tokens changes (sign-in, sign-out, expiry), never on a refresh.
let identity = 0;
let refreshing: { account: number; result: Promise<string | null> } | null = null;
let queue: Promise<unknown> = Promise.resolve();
// Counts sign-in attempts; sign-out bumps it too. An attempt commits only if it is still the latest.
let attempts = 0;
const listeners = new Set<() => void>();
const identityListeners = new Set<() => void>();

/** Runs session transitions one after another, in call order. */
function transition<T>(step: () => Promise<T>): Promise<T> {
	const run = queue.then(step, step);
	queue = run.catch(() => null);
	return run;
}

/** The `sub` claim of a JWT access token, read without verifying it (the server verifies). */
function subjectOf(accessToken: string): string | null {
	try {
		const encoded = accessToken.split(".")[1];
		if (!encoded) return null;
		const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
		const payload = JSON.parse(atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4))) as { sub?: unknown };
		return typeof payload.sub === "string" ? payload.sub : null;
	} catch {
		return null;
	}
}

const scopeOf = (server: string, accessToken: string | null | undefined) => {
	const subject = accessToken ? subjectOf(accessToken) : null;
	return subject ? JSON.stringify([server, subject]) : null;
};

// FNV-1a: tells two refresh tokens apart without storing one a second time.
const fingerprint = (value: string) => fnv1a(value).toString(16);

const setSession = (next: Session) => {
	session = next;
	for (const listener of listeners) listener();
};

/** A new account (or none) is behind the session: account-scoped caches must go before anything renders. */
const changeIdentity = () => {
	identity++;
	for (const listener of identityListeners) listener();
};

/** Calls `listener` synchronously on every session change (status or server). Returns the unsubscribe function. */
export function subscribeSession(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/**
 * Calls `listener` synchronously when the account changes: sign-in, account or server switch, sign-out, expiry.
 * Not on a token refresh. Clear account-scoped caches here.
 */
export function subscribeIdentity(listener: () => void): () => void {
	identityListeners.add(listener);
	return () => identityListeners.delete(listener);
}

/** The current session, outside React. */
export function getSession(): Session {
	return session;
}

/** The current session. Re-renders when the status or server changes. */
export function useSession(): Session {
	return useSyncExternalStore(subscribeSession, () => session);
}

/** The server origin requests go to. */
export function getServer(): string {
	return session.server;
}

/**
 * The signed-in account as the draft store's scope, `JSON.stringify([server origin, user id])`, read from the stored
 * token without a network refresh, so drafts open offline. Null unless signed in.
 */
export function getAccountScope(): string | null {
	return session.status === "signed-in" ? accountScope : null;
}

/**
 * A server and the access token for it, read together. `scope` is the account the token belongs to; `account` is the
 * session identity the snapshot was taken from.
 */
export type Credentials = { server: string; accessToken: string | null; scope: string | null; account: number };

/**
 * The current server with its access token (refreshed first when it is about to expire), from one account. If the
 * account changes while a refresh runs, the token is null rather than the next account's.
 */
export async function getCredentials(): Promise<Credentials> {
	const { server } = session;
	const account = identity;
	const token = await getAccessToken();
	const accessToken = identity === account ? token : null;
	return { server, accessToken, scope: scopeOf(server, accessToken), account };
}

/**
 * The server answered 401 to `used`, although its token looked valid. Refreshes once (shared with any refresh in
 * flight) and returns the credentials to retry with, for the same account only; null when there is nothing to retry,
 * including when the account changed since `used` was taken.
 */
export async function recoverFromUnauthorized(used: Credentials): Promise<Credentials | null> {
	if (!used.accessToken || used.account !== identity || !tokens) return null;
	// Another request already refreshed this account: retry with the newer token.
	if (tokens.accessToken !== used.accessToken) return { ...used, accessToken: tokens.accessToken };
	if (refreshing?.account === used.account) {
		const accessToken = await refreshing.result;
		return accessToken && accessToken !== used.accessToken && used.account === identity
			? { ...used, accessToken }
			: null;
	}
	if (!tokens.refreshToken) {
		await transition(() => expire(used.account));
		return null;
	}
	const accessToken = await refreshOnce(used.account, tokens.refreshToken);
	if (!accessToken || accessToken === used.accessToken || used.account !== identity) return null;
	return { ...used, accessToken };
}

/** The retry after a refresh was rejected too: the server no longer accepts this account's tokens. */
export function rejectCredentials(used: Credentials): Promise<void> {
	return transition(async () => {
		if (tokens?.accessToken === used.accessToken) await expire(used.account);
	});
}

let restoring: Promise<void> | null = null;

/**
 * Reads the last server and its tokens from SecureStore. Call once at launch. An unreadable store signs out. A refresh
 * that was still out when the app last stopped leaves the session `expired`: its token may already be rotated.
 *
 * The root layout and the cold-start link handler both call it; they share one restore, queued as a session
 * transition, so a sign-in that follows can never be overwritten by a slow read of the previous server.
 */
export function restoreSession(): Promise<void> {
	restoring ??= transition(readStoredSession);
	return restoring;
}

async function readStoredSession(): Promise<void> {
	try {
		const { clearAccountExportCache } = await import("@/features/settings/export-cache");
		clearAccountExportCache();
		const storedServer = await SecureStore.getItemAsync(serverKey);
		const server = storedServer && isAllowedServer(storedServer) ? storedServer : DEFAULT_SERVER;
		const stored = await SecureStore.getItemAsync(tokensKey(server));
		tokens = stored ? (JSON.parse(stored) as Tokens) : null;
		accountScope = scopeOf(server, tokens?.accessToken);
		// A refresh was sent and its outcome never fully landed on disk: whatever tokens are stored may be consumed.
		if (await SecureStore.getItemAsync(refreshMarkerKey(server))) {
			tokens = null;
			setSession({ status: "expired", server });
			await retireTokens(server);
			return;
		}
		setSession({ status: tokens ? "signed-in" : "signed-out", server });
	} catch {
		tokens = null;
		accountScope = null;
		setSession({ status: "signed-out", server: DEFAULT_SERVER });
	}
}

/** Development previews may install a local fixture only when no real account is present. */
export async function installDevelopmentSession(origin: string): Promise<void> {
	if (!__DEV__ || !["localhost", "127.0.0.1", "[::1]", "10.0.2.2"].includes(new URL(origin).hostname))
		throw new Error("Preview sessions require a local development server.");
	if (new URL(origin).origin !== origin) throw new Error("Expected a development server origin.");
	await restoreSession();
	return transition(async () => {
		if (
			session.status !== "signed-out" ||
			tokens ||
			accountScope ||
			(await SecureStore.getItemAsync(tokensKey(origin)))
		)
			throw new Error("Sign out before opening a development preview.");
		const next = { accessToken: `fixture.${btoa(JSON.stringify({ sub: "rr-M3T4-preview" }))}.fixture` };
		await SecureStore.setItemAsync(tokensKey(origin), JSON.stringify(next));
		await SecureStore.setItemAsync(serverKey, origin);
		tokens = next;
		accountScope = scopeOf(origin, next.accessToken);
		changeIdentity();
		setSession({ status: "signed-in", server: origin });
	});
}

/**
 * Signs in to `server` (an origin) in the system browser, then makes it the current server with its tokens in one
 * queued step. Until then nothing changes: a cancelled or failed sign-in leaves the current server and tokens as they
 * were. Resolves true when signed in and false when the user cancelled; throws on discovery, registration, redirect
 * or token errors.
 */
export async function signIn(server: string): Promise<boolean> {
	const origin = new URL(server).origin;
	if (!isAllowedServer(origin)) throw new Error("The app needs an https server.");
	const attempt = ++attempts;
	// A cancelled or superseded attempt resolves false, even if its discovery or exchange failed meanwhile.
	const next = await authorize(origin, attempt).catch((error: unknown) => {
		if (attempt !== attempts) return null;
		throw error;
	});
	if (!next) return false;
	return transition(async () => {
		// Sign-out (or a newer sign-in) started after this attempt: its tokens must not bring the session back.
		if (attempt !== attempts) {
			await revoke(origin, next.refreshToken);
			return false;
		}
		const { clearAccountExportCache } = await import("@/features/settings/export-cache");
		clearAccountExportCache();
		await SecureStore.setItemAsync(tokensKey(origin), JSON.stringify(next));
		await SecureStore.setItemAsync(serverKey, origin);
		await SecureStore.deleteItemAsync(refreshMarkerKey(origin));
		tokens = next;
		accountScope = scopeOf(origin, next.accessToken);
		changeIdentity();
		setSession({ status: "signed-in", server: origin });
		return true;
	});
}

/** A sign-in that failed at the redirect, with the OAuth error code `messages.ts` maps. */
class SignInError extends Error {
	constructor(readonly code: string) {
		super(code);
		this.name = "SignInError";
	}
}

/** Discovery, DCR, PKCE in the system browser and the code exchange. Null when the user cancels or `attempt` is stale. */
async function authorize(origin: string, attempt: number): Promise<Tokens | null> {
	const discovery = await discover(origin);
	const clientId = await registerClient(origin, discovery);
	const request = new AuthSession.AuthRequest({
		clientId,
		redirectUri: redirectUri(origin),
		scopes,
		usePKCE: true,
		// OpenID's `ui_locales`: the browser's sign-in pages open in the app's language, and a new account (with its
		// verification email) starts in it. Servers that don't read it ignore it.
		extraParams: { resource: origin, ui_locales: i18n.locale },
	});
	await request.makeAuthUrlAsync(discovery);
	// This attempt, bound to its state: only a redirect carrying the same state (and issuer) may use its verifier.
	const pending = {
		state: request.state,
		issuer: discovery.issuer,
		verifier: request.codeVerifier ?? "",
		redirect: request.redirectUri,
	};
	// Cancelled (or superseded) during discovery or registration: never open the browser.
	if (attempt !== attempts) return null;
	// iOS 17.4+: an https redirect completes through ASWebAuthenticationSession's `.https` callback.
	const result = await request.promptAsync(discovery, { preferUniversalLinks: true });
	if (result.type === "cancel" || result.type === "dismiss" || attempt !== attempts) return null;
	if (result.type !== "success" && result.type !== "error") throw new SignInError(`authorization_${result.type}`);

	// Parsed here, by hand and from the query only, rather than trusting expo-auth-session's URL parsing.
	let params: Record<string, string>;
	try {
		params = parseAuthorizationResponse(result.url);
	} catch {
		throw new SignInError("invalid_response");
	}
	if (params.state !== pending.state) throw new SignInError("state_mismatch");
	// RFC 9207. Better Auth 1.7.7 advertises `authorization_response_iss_parameter_supported` and adds `iss` to code and
	// error redirects; a server that does not advertise it must at least not name another issuer.
	if (
		discovery.issParameterSupported
			? params.iss !== pending.issuer
			: params.iss !== undefined && params.iss !== pending.issuer
	)
		throw new SignInError("issuer_mismatch");
	if (params.error) throw new SignInError(params.error);
	if (!params.code) throw new SignInError("no_code");

	try {
		const response = await AuthSession.exchangeCodeAsync(
			{
				clientId,
				code: params.code,
				redirectUri: pending.redirect,
				extraParams: { code_verifier: pending.verifier, resource: origin },
			},
			discovery,
		);
		return toTokens(response);
	} catch (error) {
		if (error instanceof AuthSession.TokenError && error.code === "invalid_client")
			await forgetClient(origin).catch(() => null);
		throw error;
	}
}

const toTokens = (response: AuthSession.TokenResponse, previousRefreshToken?: string): Tokens => ({
	accessToken: response.accessToken,
	refreshToken: response.refreshToken ?? previousRefreshToken,
	expiresAt: response.expiresIn ? response.issuedAt + response.expiresIn : undefined,
});

/** Cancels the sign-in in progress: closes its browser and invalidates the attempt; `signIn` then resolves false. */
export function cancelSignIn(): void {
	attempts++;
	WebBrowser.dismissAuthSession();
}

// kv-store prefixes other features keep per account (`<prefix><scope>:<id>`): application notes (M5-T2) and Career
// workspace drafts (M6-T2). Resume and letter drafts are cleared by the draft runtime.
const scopedStoragePrefixes = ["reactive-resume:application-notes:", "reactive-resume:career-draft:"];

/** Best-effort revocation of a refresh token on `server`, given up after `revokeTimeout`. */
async function revoke(server: string, refreshToken: string | undefined): Promise<void> {
	if (!refreshToken) return;
	await Promise.race([
		Promise.all([discover(server), getClientId(server)]).then(([discovery, clientId]) => {
			if (!clientId || !discovery.revocationEndpoint) return;
			return AuthSession.revokeAsync(
				{ clientId, token: refreshToken, tokenTypeHint: AuthSession.TokenTypeHint.RefreshToken },
				discovery,
			);
		}),
		// A revocation endpoint that never answers must not hold sign-out (and the transition queue).
		new Promise<void>((resolve) => setTimeout(resolve, revokeTimeout)),
	]).catch(() => null);
}

/** Sign-out finished, but some of the account's data on this device could not be removed. */
export class SignOutCleanupError extends AggregateError {
	constructor(errors: unknown[]) {
		super(errors, "Signed out, but some local data could not be removed.");
		this.name = "SignOutCleanupError";
	}
}

/**
 * Signs out the current account, after any queued refresh, and invalidates every sign-in still in the browser.
 * Against a snapshot of that account only: revokes its refresh token (best effort, bounded), clears its local data
 * (drafts, application notes, Career drafts) and every stored library thumbnail, then deletes its tokens. The server and its registered
 * client are kept. Access tokens already issued stay valid until they expire (at most an hour).
 * Credentials are always removed and the session always ends signed out; a cleanup that fails does not stop the others
 * and is reported afterwards as a `SignOutCleanupError`.
 */
export function signOut(): Promise<void> {
	attempts++;
	return transition(async () => {
		const departing = { server: session.server, tokens, scope: accountScope, account: identity };
		const errors: unknown[] = [];
		const attempt = async (step: () => unknown) => {
			try {
				await step();
			} catch (error) {
				errors.push(error);
			}
		};

		await revoke(departing.server, departing.tokens?.refreshToken);
		await attempt(async () => {
			// Imported here, like the draft runtime below, to keep this module free of feature imports.
			const { clearStoredThumbnails } = await import("@/features/documents/thumbnail-store");
			await clearStoredThumbnails();
		});
		await attempt(async () => {
			const { clearAccountExportCache } = await import("@/features/settings/export-cache");
			clearAccountExportCache();
		});
		const { scope } = departing;
		if (scope) {
			await attempt(async () => {
				// Imported here: the draft runtime imports the API client, which imports this module.
				const { clearDraftsFor } = await import("@/draft/runtime");
				clearDraftsFor(scope);
			});
			await attempt(() => {
				const prefixes = scopedStoragePrefixes.map((prefix) => `${prefix}${scope}:`);
				for (const key of Storage.getAllKeysSync())
					if (prefixes.some((prefix) => key.startsWith(prefix))) Storage.removeItemSync(key);
			});
		}

		try {
			await SecureStore.deleteItemAsync(tokensKey(departing.server));
			await SecureStore.deleteItemAsync(refreshMarkerKey(departing.server));
		} catch (error) {
			errors.push(error);
			// The tokens may still be on disk: a marker makes the next launch expire them instead of signing back in.
			await SecureStore.setItemAsync(refreshMarkerKey(departing.server), "signed-out").catch(() => null);
		}
		if (identity === departing.account) {
			tokens = null;
			accountScope = null;
			changeIdentity();
			setSession({ status: "signed-out", server: departing.server });
		}
		if (errors.length > 0) throw new SignOutCleanupError(errors);
	});
}

/**
 * A valid access token for the current account, or null when signed out. Refreshes first when the token is about to
 * expire; concurrent callers share one refresh.
 */
export function getAccessToken(): Promise<string | null> {
	if (!tokens) return Promise.resolve(null);
	// The refresh token is retired while its refresh is out; wait for that refresh.
	if (refreshing?.account === identity) return refreshing.result;
	const expiresSoon = tokens.expiresAt !== undefined && tokens.expiresAt - expirySkewSeconds <= Date.now() / 1000;
	if (!expiresSoon) return Promise.resolve(tokens.accessToken);
	if (!tokens.refreshToken) return Promise.resolve(null);
	return refreshOnce(identity, tokens.refreshToken);
}

/** Single flight through the transition queue: every caller shares the refresh in progress. */
function refreshOnce(account: number, refreshToken: string): Promise<string | null> {
	if (refreshing?.account === account) return refreshing.result;
	const current = {
		account,
		result: transition(() => refreshAccessToken(account, refreshToken)).finally(() => {
			if (refreshing === current) refreshing = null;
		}),
	};
	refreshing = current;
	return current.result;
}

async function refreshAccessToken(account: number, refreshToken: string): Promise<string | null> {
	if (identity !== account || !tokens) return null;
	// A refresh queued earlier already rotated this account's token.
	if (tokens.refreshToken !== refreshToken) return tokens.accessToken;
	const { server } = session;
	const stale = tokens;

	// Offline: nothing would reach the server, so keep the old token and let the request fail on its own.
	const network = await Network.getNetworkStateAsync().catch(() => null);
	if (network && (network.isConnected === false || network.isInternetReachable === false)) return stale.accessToken;

	const [discovery, clientId] = await Promise.all([discover(server), getClientId(server)]).catch(() => [null, null]);
	if (!discovery) return stale.accessToken;
	if (!clientId) {
		await expire(account);
		return null;
	}

	await SecureStore.setItemAsync(refreshMarkerKey(server), fingerprint(refreshToken));
	// From here the token counts as spent: whatever happens, it is never sent again.
	tokens = { ...stale, refreshToken: undefined };
	try {
		const response = await Promise.race([
			AuthSession.refreshAsync({ clientId, refreshToken, extraParams: { resource: server } }, discovery),
			// A request that never answers would hold the transition queue (and sign-out) forever.
			new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Refresh timed out.")), refreshTimeout)),
		]);
		const next = toTokens(response, undefined);
		// The marker goes only once the new tokens are durably stored.
		await SecureStore.setItemAsync(tokensKey(server), JSON.stringify(next));
		await SecureStore.deleteItemAsync(refreshMarkerKey(server));
		if (identity !== account) return null;
		tokens = next;
		accountScope = scopeOf(server, next.accessToken) ?? accountScope;
		return next.accessToken;
	} catch (error) {
		// No answer, an error answer, or a store that would not keep the result: fail closed and ask for a new sign-in.
		try {
			if (error instanceof AuthSession.TokenError && error.code === "invalid_client") await forgetClient(server);
		} catch {
			// Re-registration then waits for the next invalid_client; the session must still end.
		} finally {
			await expire(account);
		}
		return null;
	}
}

/**
 * The account's refresh token is gone, rejected or possibly spent. Drops the tokens and marks the session `expired`,
 * which keeps the user on the current screen with a prompt to sign in again. Runs inside the transition queue.
 */
async function expire(account: number): Promise<void> {
	if (identity !== account) return;
	const { server } = session;
	tokens = null;
	changeIdentity();
	setSession({ status: "expired", server });
	try {
		const { clearAccountExportCache } = await import("@/features/settings/export-cache");
		clearAccountExportCache();
	} finally {
		await retireTokens(server);
	}
}

/**
 * Deletes the stored tokens, then the refresh marker. The marker stays if the tokens could not be deleted, so the next
 * launch expires the session instead of sending a possibly spent token.
 */
async function retireTokens(server: string): Promise<void> {
	try {
		await SecureStore.deleteItemAsync(tokensKey(server));
	} catch {
		return;
	}
	await SecureStore.deleteItemAsync(refreshMarkerKey(server)).catch(() => null);
}
