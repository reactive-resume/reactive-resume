/**
 * OrcaRouter OAuth 2.0 + PKCE (Flow B, out-of-band code).
 *
 * The verifier never leaves this process until the exchange and is never logged, put in a URL, or
 * returned in an error. The auth code is single-use with a 10 minute TTL.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
	buildOrcaRouterAuthorizeUrl,
	buildOrcaRouterExchangeUrl,
	type OrcaRouterOrigins,
	ORCAROUTER_APP_NAME,
	ORCAROUTER_SCOPE,
} from "./origins";

const VERIFIER_BYTES = 32;
const STATE_BYTES = 16;
const MAX_EXCHANGE_RESPONSE_BYTES = 64 * 1024;
const EXCHANGE_TIMEOUT_MS = 30_000;

export type OrcaRouterPkceAttempt = {
	verifier: string;
	challenge: string;
	state: string;
	authorizeUrl: string;
};

/** base64url without padding, per RFC 7636 §4.2. */
export function base64Url(buffer: Buffer): string {
	return buffer.toString("base64url").replace(/=+$/, "");
}

export function createCodeChallenge(verifier: string): string {
	return base64Url(createHash("sha256").update(verifier, "utf8").digest());
}

export function createCodeVerifier(): string {
	return base64Url(randomBytes(VERIFIER_BYTES));
}

export function createState(): string {
	return base64Url(randomBytes(STATE_BYTES));
}

/** Constant-time comparison for the redirect `state`, which is the only thing binding the callback to this attempt. */
export function constantTimeEqual(left: string, right: string): boolean {
	const a = Buffer.from(left, "utf8");
	const b = Buffer.from(right, "utf8");
	if (a.length !== b.length || a.length === 0) return false;
	return timingSafeEqual(a, b);
}

export type CreatePkceAttemptInput = {
	origins: OrcaRouterOrigins;
	appName?: string;
	/** Purely a display hint for the consent screen; it is not a credential and is not persisted. */
	loginHint?: string | undefined;
	workspaceHint?: string | undefined;
	/** `consent` forces re-approval even if this user approved the app before. */
	prompt?: "consent" | undefined;
};

/**
 * A fresh verifier and state for every attempt, from the platform CSPRNG. The authorize URL carries
 * only the S256 challenge — never the verifier.
 */
export function createPkceAttempt(input: CreatePkceAttemptInput): OrcaRouterPkceAttempt {
	const verifier = createCodeVerifier();
	const state = createState();
	const params: Record<string, string> = {
		// Flow B: this app is a hosted web UI, so it cannot listen on the user's loopback interface.
		callback_url: "oob",
		code_challenge: createCodeChallenge(verifier),
		code_challenge_method: "S256",
		state,
		app_name: input.appName?.trim() || ORCAROUTER_APP_NAME,
		scope: ORCAROUTER_SCOPE,
	};
	// Pre-fills only; neither value carries authority and both are the user's own identifiers.
	if (input.loginHint) params.login_hint = input.loginHint;
	if (input.workspaceHint) params.workspace_hint = input.workspaceHint;
	if (input.prompt) params.prompt = input.prompt;

	return {
		verifier,
		state,
		challenge: params.code_challenge ?? "",
		authorizeUrl: buildOrcaRouterAuthorizeUrl(input.origins, params),
	};
}

export function buildExchangeRequestBody(code: string, verifier: string) {
	return { code, code_verifier: verifier, code_challenge_method: "S256" as const };
}

export type OrcaRouterConnectFailureCode =
	| "denied"
	| "cancelled"
	| "expired"
	| "invalid_code"
	| "verifier_mismatch"
	| "challenge_method"
	| "rate_limited"
	| "scope_downgrade"
	| "unreachable"
	| "provider_error"
	| "malformed_response";

export type OrcaRouterConnectFailure = {
	code: OrcaRouterConnectFailureCode;
	/** Terminal: retrying without user action cannot help, so the account is marked for reauthentication. */
	terminal: boolean;
	message: string;
};

/** Raised by the exchange helper; never carries the code, the verifier, or the returned key. */
export class OrcaRouterConnectError extends Error {
	readonly failure: OrcaRouterConnectFailure;

	constructor(failure: OrcaRouterConnectFailure) {
		super(failure.message);
		this.name = "OrcaRouterConnectError";
		this.failure = failure;
	}
}

/** `api` is what this app needs; a granted `connector`-only or missing scope does not satisfy it. */
export function scopeSatisfies(granted: string | null | undefined): boolean {
	if (typeof granted !== "string") return false;
	return granted
		.split(/\s+/)
		.map((scope) => scope.trim())
		.includes(ORCAROUTER_SCOPE);
}

/**
 * Maps an exchange response to a user-actionable failure. `null` means the response was a success
 * whose granted scope satisfies this app.
 */
export function classifyExchangeResponse(status: number, body: unknown): OrcaRouterConnectFailure | null {
	const error = typeof body === "object" && body !== null ? (body as { error?: unknown }).error : undefined;
	const description =
		typeof body === "object" && body !== null ? (body as { error_description?: unknown }).error_description : undefined;
	const providerMessage = typeof description === "string" && description.trim() ? description.trim() : null;

	if (status === 200) {
		const key = typeof body === "object" && body !== null ? (body as { key?: unknown }).key : undefined;
		if (typeof key !== "string" || !key.trim()) {
			return { code: "malformed_response", terminal: true, message: "OrcaRouter did not return a key. Try again." };
		}
		const scope = (body as { scope?: unknown }).scope;
		if (!scopeSatisfies(typeof scope === "string" ? scope : null)) {
			return {
				code: "scope_downgrade",
				terminal: true,
				message:
					"OrcaRouter granted less access than this app asked for. Ask an OrcaRouter workspace admin for access, then connect again.",
			};
		}
		return null;
	}

	if (status === 400) {
		return {
			code: "challenge_method",
			terminal: true,
			message: providerMessage ?? "OrcaRouter rejected the PKCE challenge method. Start the connection again.",
		};
	}
	if (status === 403) {
		return {
			code: "invalid_code",
			terminal: true,
			message:
				providerMessage ?? "That code is unknown, already used, or expired. Codes last 10 minutes; connect again.",
		};
	}
	if (status === 429) {
		return {
			code: "rate_limited",
			terminal: true,
			message:
				"OrcaRouter limits each account to 10 connections per day. The current key keeps working; try again tomorrow.",
		};
	}
	if (status >= 500) {
		return {
			code: "provider_error",
			terminal: false,
			message: "OrcaRouter is unavailable right now. Try again shortly.",
		};
	}
	if (status === 401) {
		return {
			code: "verifier_mismatch",
			terminal: true,
			message: "OrcaRouter rejected this connection attempt. Start it again.",
		};
	}
	return {
		code: "provider_error",
		terminal: false,
		message:
			typeof error === "string"
				? `OrcaRouter refused the exchange (${status}).`
				: `OrcaRouter refused the exchange (${status}).`,
	};
}

export type ExchangeOrcaRouterCodeInput = {
	origins: OrcaRouterOrigins;
	code: string;
	verifier: string;
	/** Injectable for tests; defaults to the global fetch. */
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
};

export type ExchangeOrcaRouterCodeResult = { key: string; scope: string };

async function readBoundedBody(response: Response): Promise<unknown> {
	const text = await response.text();
	if (text.length > MAX_EXCHANGE_RESPONSE_BYTES) return null;
	const trimmed = text.trim();
	if (!trimmed) return {};
	try {
		return JSON.parse(trimmed);
	} catch {
		return null;
	}
}

/**
 * Redeems an auth code for a normal OrcaRouter API key. The code and verifier are used once and are
 * not echoed back; the returned key is only ever returned to the caller that will encrypt it.
 */
export async function exchangeOrcaRouterCode(
	input: ExchangeOrcaRouterCodeInput,
): Promise<ExchangeOrcaRouterCodeResult> {
	const fetchImpl = input.fetchImpl ?? fetch;
	let response: Response;
	try {
		response = await fetchImpl(buildOrcaRouterExchangeUrl(input.origins), {
			method: "POST",
			headers: { "Content-Type": "application/json", Accept: "application/json" },
			body: JSON.stringify(buildExchangeRequestBody(input.code, input.verifier)),
			signal: input.signal ?? AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
		});
	} catch (error) {
		// The caught error may be a transport error whose message includes the request URL; it never
		// includes the body, but it is not surfaced verbatim anyway.
		const aborted = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
		throw new OrcaRouterConnectError({
			code: "unreachable",
			terminal: false,
			message: aborted
				? "OrcaRouter did not answer in time. Try connecting again."
				: "Could not reach OrcaRouter to finish connecting. Check this server's network and try again.",
		});
	}

	const body = await readBoundedBody(response);
	if (body === null) {
		throw new OrcaRouterConnectError({
			code: "malformed_response",
			terminal: false,
			message: "OrcaRouter returned an unreadable response. Try connecting again.",
		});
	}

	const failure = classifyExchangeResponse(response.status, body);
	if (failure) throw new OrcaRouterConnectError(failure);

	const { key, scope } = body as { key: string; scope: string };
	return { key, scope };
}
