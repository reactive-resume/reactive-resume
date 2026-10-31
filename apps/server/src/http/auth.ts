import { isIP } from "node:net";
import { APIError } from "better-auth/api";
import { migrateUserStorage } from "@reactive-resume/api/features/storage";
import { auth, setAccountLinkHook } from "@reactive-resume/auth/config";
import { env } from "@reactive-resume/env/server";
import { TRUSTED_IP_HEADERS } from "@reactive-resume/utils/rate-limit";
import { isAllowedOAuthRedirectUri } from "@reactive-resume/utils/url-security.node";

setAccountLinkHook(({ fromUserId, toUserId, excludedStoragePrefixes }) =>
	migrateUserStorage(fromUserId, toUserId, excludedStoragePrefixes),
);

const oauthAuthorizeSanitizedParams = [
	"prompt",
	"redirect_uri",
	"client_id",
	"code_challenge",
	"code_challenge_method",
	"response_type",
	"scope",
	"state",
	"resource",
] as const;

function sanitizeOAuthAuthorizeRequest(request: Request): Request {
	if (request.method !== "GET") return request;

	const url = new URL(request.url);
	if (!url.pathname.endsWith("/oauth2/authorize")) return request;

	const sanitizeValue = (value: string) =>
		value
			.replace(/[\r\n\t]+/g, " ")
			.replace(/\s+/g, " ")
			.trim();
	const sanitizeParam = (key: string) => {
		const values = url.searchParams.getAll(key);
		if (!values.length) return;
		url.searchParams.delete(key);
		for (const value of values) url.searchParams.append(key, sanitizeValue(value));
	};

	for (const key of oauthAuthorizeSanitizedParams) sanitizeParam(key);

	const redirectUri = url.searchParams.get("redirect_uri");
	if (redirectUri && !URL.canParse(redirectUri)) {
		try {
			const decodedRedirectUri = decodeURIComponent(redirectUri);
			if (URL.canParse(decodedRedirectUri)) {
				url.searchParams.set("redirect_uri", decodedRedirectUri);
			}
		} catch {
			// Ignore malformed encoded values and let Better Auth validation handle them.
		}
	}

	if (url.toString() === request.url) return request;
	return new Request(url.toString(), request);
}

function isRegistrationPayload(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function defaultPublicClientRegistration(request: Request): Promise<Request> {
	if (request.method !== "POST") return request;

	const url = new URL(request.url);
	if (!url.pathname.endsWith("/oauth2/register")) return request;

	const cloned = request.clone();
	let body: Record<string, unknown>;

	try {
		const payload: unknown = await cloned.json();
		if (!isRegistrationPayload(payload)) return request;
		body = payload;
	} catch {
		return request;
	}

	// MCP clients that authenticate with PKCE alone omit the method, and Better Auth
	// would otherwise register them as `client_secret_basic`. Honor an explicit choice:
	// forcing it to "none" issues no client secret, so the client's own Basic/post
	// credentials are rejected at the token endpoint with 401 invalid_client.
	if (!request.headers.get("authorization")) {
		body.token_endpoint_auth_method ??= "none";
	}

	return new Request(url.toString(), {
		method: request.method,
		headers: request.headers,
		body: JSON.stringify(body),
	});
}

// Every endpoint that writes client metadata; update-client nests it under `update`.
const clientMetadataPaths = ["/oauth2/register", "/oauth2/create-client", "/oauth2/update-client"];

async function validateOAuthClientMetadata(request: Request): Promise<Response | undefined> {
	if (request.method !== "POST") return;

	const url = new URL(request.url);
	const path = clientMetadataPaths.find((suffix) => url.pathname.endsWith(suffix));
	if (!path) return;

	const cloned = request.clone();
	let body: Record<string, unknown>;

	try {
		const payload: unknown = await cloned.json();
		const metadata = path === "/oauth2/update-client" && isRegistrationPayload(payload) ? payload.update : payload;
		if (!isRegistrationPayload(metadata)) {
			return Response.json({ message: "Invalid registration payload" }, { status: 400 });
		}
		body = metadata;
	} catch {
		return Response.json({ message: "Invalid registration payload" }, { status: 400 });
	}

	// The provider would POST to this URL on sign-out; nothing here needs back-channel logout.
	if (body.backchannel_logout_uri !== undefined) {
		return Response.json(
			{ error: "invalid_client_metadata", error_description: "backchannel_logout_uri is not supported" },
			{ status: 400 },
		);
	}

	const oauthTrustedOrigins = [new URL(env.APP_URL).origin.toLowerCase()];

	const redirectUris = [body.redirect_uris, body.post_logout_redirect_uris].flatMap((uris) =>
		Array.isArray(uris) ? uris : [],
	);
	for (const redirectUri of redirectUris) {
		if (
			typeof redirectUri !== "string" ||
			!isAllowedOAuthRedirectUri(redirectUri, oauthTrustedOrigins, {
				allowUnsafe: env.FLAG_ALLOW_UNSAFE_OAUTH_REDIRECT_URI,
			})
		) {
			return Response.json(
				{ error: "invalid_redirect_uri", error_description: "redirect_uri is not allowed" },
				{ status: 400 },
			);
		}
	}
}

export async function handleAuth(incomingRequest: Request, trustedClient = "unknown") {
	// Only the server adapter may supply the client address. Never forward client-sent proxy headers to auth.
	const headers = new Headers(incomingRequest.headers);
	for (const name of TRUSTED_IP_HEADERS) headers.delete(name);
	if (isIP(trustedClient)) headers.set("X-Real-IP", trustedClient);
	const request = new Request(incomingRequest, { headers });
	const registrationValidationError = await validateOAuthClientMetadata(request);
	if (registrationValidationError) return registrationValidationError;

	const sanitizedRequest = sanitizeOAuthAuthorizeRequest(request);
	const finalRequest = await defaultPublicClientRegistration(sanitizedRequest);

	return auth.handler(finalRequest);
}

export async function handleOAuth(request: Request) {
	try {
		return await resumeOAuth(request);
	} catch (error) {
		// Before-hooks can throw even when the provider is called with asResponse.
		if (error instanceof APIError) return Response.json(error.body, { status: error.statusCode });
		throw error;
	}
}

async function resumeOAuth(request: Request) {
	const session = await auth.api.getSession({ headers: request.headers });
	const url = new URL(request.url);

	if (session?.user) {
		// Resume authorization without granting consent. The provider decides whether
		// the user must sign in, explicitly approve a client, or reuse an existing grant.
		// Its signed query must survive the login round trip byte-for-byte.
		const response = await auth.api.oauth2Continue({
			asResponse: true,
			request,
			headers: request.headers,
			body: { postLogin: true, oauth_query: url.search.slice(1) },
		});
		if (!(response instanceof Response)) throw new Error("OAuth provider did not return a response");
		if (!response.ok) return response;
		const result: unknown = await response.json().catch(() => null);
		if (
			!result ||
			typeof result !== "object" ||
			!("url" in result) ||
			typeof result.url !== "string" ||
			!result.url ||
			!(result.url.startsWith("/") || URL.canParse(result.url)) ||
			!URL.canParse(result.url, env.APP_URL)
		)
			return Response.json({ error: "invalid_provider_response" }, { status: 502 });
		const headers = new Headers(response.headers);
		headers.delete("content-type");
		headers.delete("content-length");
		const target = new URL(result.url, env.APP_URL);
		if (["javascript:", "data:", "vbscript:", "file:", "blob:"].includes(target.protocol)) {
			return Response.json({ error: "invalid_provider_response" }, { status: 502 });
		}
		if (target.origin === new URL(env.APP_URL).origin && target.pathname === "/api/auth/oauth") {
			return redirectToOAuthLogin(target, true, headers);
		}
		headers.set("Location", result.url);
		return new Response(null, { status: 302, headers });
	}

	return redirectToOAuthLogin(url);
}

function redirectToOAuthLogin(url: URL, reauthenticate = false, headers = new Headers()) {
	const prompt = new Set(url.searchParams.get("prompt")?.split(" ") ?? []);
	const loginUrl = new URL(prompt.has("create") ? "/auth/register" : "/auth/login", env.APP_URL);
	if (reauthenticate) loginUrl.searchParams.set("reauthenticate", "true");
	loginUrl.searchParams.set("callbackURL", `/api/auth/oauth${url.search}`);
	headers.set("Location", `${loginUrl.pathname}${loginUrl.search}`);
	return new Response(null, {
		status: 302,
		headers,
	});
}
