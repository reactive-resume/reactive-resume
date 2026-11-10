import type { RouterOutput } from "@/api/client";
// The OAuth plumbing behind session.ts: discovery, dynamic client registration, the redirect URI and the server
// check the server picker runs. Nothing here reads or writes tokens.
import type { DiscoveryDocument } from "expo-auth-session";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export const scopes = ["openid", "profile", "email", "offline_access", "api:read", "api:write", "api:delete"];

/** The host the app is associated with (Universal Links, App Links). The OAuth callback lands there for every server. */
const appHost = "rxresu.me";

/**
 * The OAuth redirect URI, the same for every server (coordinator decision, M3-T1):
 * `https://rxresu.me/auth/native-callback` is the only https URL the app can receive (its associated domain, through
 * Universal Links and App Links); a self-hosted host can never be one. DCR on any server accepts a public https
 * redirect. If the hand-off fails and the browser loads that page instead, the code is useless without the PKCE
 * verifier, and the fallback page (SV1) never logs it.
 * Development builds talking to a local http server use the app's private-use scheme instead (RFC 8252 §7.1), because
 * no https callback can be verified locally; that server must run with `FLAG_ALLOW_UNSAFE_OAUTH_REDIRECT_URI=true`.
 */
export function redirectUri(origin: string): string {
	if (__DEV__ && origin.startsWith("http:")) return `${appScheme()}:/auth/native-callback`;
	return `https://${appHost}/auth/native-callback`;
}

// Hosts a development build may reach over http: the simulator's own machine and the Android emulator's host alias.
const developmentHosts = new Set(["localhost", "127.0.0.1", "10.0.2.2"]);

/** Servers the app talks to: https only; development builds also allow http on the local machine. */
export function isAllowedServer(origin: string): boolean {
	try {
		const url = new URL(origin);
		if (url.origin !== origin || url.username || url.password) return false;
		return url.protocol === "https:" || (__DEV__ && url.protocol === "http:" && developmentHosts.has(url.hostname));
	} catch {
		return false;
	}
}

// SecureStore keys allow only `[A-Za-z0-9._-]`. Hex of the origin's UTF-8 bytes is collision-free within that set.
export const storeKey = (prefix: string, origin: string) =>
	`${prefix}.${Array.from(new TextEncoder().encode(origin), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;

/** Accepts `resume.example.org`, `https://resume.example.org/dashboard` and the like; returns the origin or null. */
export function toOrigin(input: string): string | null {
	const trimmed = input.trim();
	if (!trimmed || /\s/.test(trimmed)) return null;
	try {
		const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
		if (url.username || url.password) return null;
		if (url.protocol !== "https:" && url.protocol !== "http:") return null;
		if (!url.hostname.includes(".") && url.hostname !== "localhost") return null;
		return url.origin;
	} catch {
		return null;
	}
}

type Metadata = {
	issuer?: unknown;
	authorization_response_iss_parameter_supported?: unknown;
	authorization_endpoint?: unknown;
	token_endpoint?: unknown;
	revocation_endpoint?: unknown;
	registration_endpoint?: unknown;
	scopes_supported?: unknown;
};

export type Discovery = DiscoveryDocument & {
	issuer: string;
	tokenEndpoint: string;
	registrationEndpoint: string;
	/** RFC 9207: the authorization response carries `iss`, which must then equal `issuer`. */
	issParameterSupported: boolean;
};

const discoveries = new Map<string, Discovery>();
const requestTimeout = 10_000;

/**
 * Why a server cannot be used: `unreachable` (no Reactive Resume answered), `outdated` (no app sign-in yet) or
 * `mismatch` (its metadata names another origin as issuer or endpoint).
 */
export class ServerError extends Error {
	constructor(readonly reason: "unreachable" | "outdated" | "mismatch") {
		super(reason);
		this.name = "ServerError";
	}
}

const getJson = async (url: string): Promise<unknown> => {
	const response = await fetch(url, {
		headers: { accept: "application/json" },
		signal: AbortSignal.timeout(requestTimeout),
	});
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	return response.json();
};

/**
 * Reads `/.well-known/oauth-authorization-server`, cached per origin for the app's lifetime. Throws `ServerError`:
 * `outdated` when the server answers but cannot register the app or issue refresh tokens (`offline_access`).
 */
export async function discover(origin: string): Promise<Discovery> {
	const cached = discoveries.get(origin);
	if (cached) return cached;

	const metadata = (await getJson(`${origin}/.well-known/oauth-authorization-server`).catch(async () => {
		// A Reactive Resume server that predates app sign-in still answers its flags.
		const isReactiveResume = await getJson(`${origin}/api/openapi/flags`).then(
			() => true,
			() => false,
		);
		throw new ServerError(isReactiveResume ? "outdated" : "unreachable");
	})) as Metadata | null;

	const string = (value: unknown) => (typeof value === "string" && value ? value : undefined);
	const authorizationEndpoint = string(metadata?.authorization_endpoint);
	const tokenEndpoint = string(metadata?.token_endpoint);
	const registrationEndpoint = string(metadata?.registration_endpoint);
	if (!authorizationEndpoint || !tokenEndpoint) throw new ServerError("unreachable");
	const supportsScopes =
		Array.isArray(metadata?.scopes_supported) && metadata.scopes_supported.includes("offline_access");
	if (!registrationEndpoint || !supportsScopes) throw new ServerError("outdated");

	const revocationEndpoint = string(metadata?.revocation_endpoint);
	const issuer = string(metadata?.issuer);
	// Mix-up defence (RFC 9207 §1): the issuer and every endpoint the app sends a code or token to must be on the
	// origin the user chose. Better Auth's issuer is `<origin>/api/auth`.
	const onOrigin = (url: string | undefined) => url === undefined || originOf(url) === origin;
	if (
		!issuer ||
		!onOrigin(issuer) ||
		![authorizationEndpoint, tokenEndpoint, registrationEndpoint, revocationEndpoint].every(onOrigin)
	)
		throw new ServerError("mismatch");

	const discovery: Discovery = {
		issuer,
		issParameterSupported: metadata?.authorization_response_iss_parameter_supported === true,
		authorizationEndpoint,
		tokenEndpoint,
		registrationEndpoint,
		...(revocationEndpoint ? { revocationEndpoint } : {}),
	};
	discoveries.set(origin, discovery);
	return discovery;
}

const originOf = (url: string) => {
	try {
		return new URL(url).origin;
	} catch {
		return null;
	}
};

// The authorization-response parameters a redirect may carry (RFC 6749 §4.1.2, RFC 9207).
const protocolParams = new Set(["code", "state", "iss", "error", "error_description", "error_uri"]);

/**
 * The authorization-response parameters of a redirect URL, parsed by hand: React Native's `URLSearchParams` is not
 * reliable (S3). Only the query counts (the code flow answers in the query). Throws when a protocol parameter repeats
 * or appears in the fragment, where an inherited `#iss=` could otherwise stand in for the real one.
 */
export function parseAuthorizationResponse(url: string): Record<string, string> {
	const decode = (value: string) => {
		try {
			return decodeURIComponent(value.replaceAll("+", " "));
		} catch {
			throw new Error("Malformed redirect.");
		}
	};
	const split = (part: string) =>
		part
			.split("&")
			.filter(Boolean)
			.map((pair): [string, string] => {
				const equals = pair.indexOf("=");
				return [
					decode(equals === -1 ? pair : pair.slice(0, equals)),
					equals === -1 ? "" : decode(pair.slice(equals + 1)),
				];
			});
	const hashStart = url.indexOf("#");
	const beforeHash = hashStart === -1 ? url : url.slice(0, hashStart);
	const queryStart = beforeHash.indexOf("?");
	const query = queryStart === -1 ? "" : beforeHash.slice(queryStart + 1);
	const fragment = hashStart === -1 ? "" : url.slice(hashStart + 1);

	if (split(fragment).some(([key]) => protocolParams.has(key))) throw new Error("Protocol parameter in the fragment.");
	const params: Record<string, string> = {};
	for (const [key, value] of split(query)) {
		if (protocolParams.has(key) && key in params) throw new Error(`Repeated ${key}.`);
		params[key] = value;
	}
	return params;
}

/** The app's `client_id` on this server, if it registered there before. */
export function getClientId(origin: string): Promise<string | null> {
	return SecureStore.getItemAsync(storeKey("client", origin));
}

/** Forgets the client after the server answered `invalid_client`, so the next sign-in registers again. */
export function forgetClient(origin: string): Promise<void> {
	return SecureStore.deleteItemAsync(storeKey("client", origin));
}

/** The cached `client_id`, or a new one from dynamic client registration (body: reports/S3.md §1). */
export async function registerClient(origin: string, discovery: Discovery): Promise<string> {
	const cached = await getClientId(origin);
	if (cached) return cached;

	const response = await fetch(discovery.registrationEndpoint, {
		method: "POST",
		headers: { "content-type": "application/json", accept: "application/json" },
		signal: AbortSignal.timeout(requestTimeout),
		body: JSON.stringify({
			client_name: Platform.OS === "ios" ? "Reactive Resume for iOS" : "Reactive Resume for Android",
			redirect_uris: [redirectUri(origin)],
			token_endpoint_auth_method: "none",
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			application_type: "native",
			scope: scopes.join(" "),
		}),
	});
	const body = (await response.json().catch(() => null)) as { client_id?: unknown } | null;
	if (!response.ok || typeof body?.client_id !== "string")
		throw new Error(`Client registration failed (${response.status})`);
	await SecureStore.setItemAsync(storeKey("client", origin), body.client_id);
	return body.client_id;
}

export type ServerFlags = RouterOutput["flags"]["get"];

/** `flags.get` on a server the app is not signed in to yet (sign-ups, guest login). */
export async function getFlags(origin: string): Promise<ServerFlags> {
	return (await getJson(`${origin}/api/openapi/flags`)) as ServerFlags;
}

export function appScheme(): string {
	const scheme = Constants.expoConfig?.scheme;
	return (Array.isArray(scheme) ? scheme[0] : scheme) ?? "me.rxresu";
}
export async function healthCheck(origin: string): Promise<void> {
	if (!isAllowedServer(origin)) throw new ServerError("mismatch");
	const response = await fetch(`${origin}/api/health`, {
		signal: AbortSignal.timeout(requestTimeout),
		redirect: "error",
	});
	if (!response.ok) throw new ServerError("unreachable");
}
