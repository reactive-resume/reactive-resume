import type { Credentials } from "@/auth/session";
// The typed API, same router types as apps/web/src/libs/orpc/client.ts. Requests go to the signed-in server with the
// session's bearer token through `expo/fetch`, which streams response bodies (SSE event iterators); React Native's
// built-in fetch does not.
import type { InferRouterInputs, InferRouterOutputs, RouterClient } from "@orpc/server";
// The server router is a type-only peer dependency, so the runtime:server deny rule for app:mobile still holds;
// the mobile override in the root vite.config.ts rejects value imports from it.
// @boundaries-ignore type-only import of the server router
import type router from "@reactive-resume/api/routers";
import { createORPCClient, onError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { fetch as expoFetch } from "expo/fetch";
import { authorizeAiRequest } from "./ai-consent";
import { getAccountScope, getCredentials, recoverFromUnauthorized, rejectCredentials } from "@/auth/session";

/**
 * Per-call context. `scope` binds a call to one account (the draft store's scope, `JSON.stringify([server, user id])`):
 * the call fails instead of going out when the session no longer belongs to that account.
 */
export type ClientContext = { scope?: string | undefined };

export class SessionChangedError extends Error {
	constructor() {
		super("The account changed before the request was sent.");
		this.name = "SessionChangedError";
	}
}

/**
 * Sends a request built from one credentials snapshot, so the server and the token always belong together. A 401 to a
 * token that still looked valid refreshes once and retries; a second 401 marks the session expired.
 * `send` must be repeatable (buffered body). 401s that are not about the token (`NEED_PASSWORD`) pass through.
 */
async function withCredentials(
	send: (credentials: Credentials) => Promise<Response>,
	scope?: string | undefined,
): Promise<Response> {
	const credentials = await getCredentials();
	if (scope !== undefined && credentials.scope !== scope) throw new SessionChangedError();
	const response = await send(credentials);
	if (response.status !== 401 || !credentials.accessToken) return response;

	const body = await response.text();
	const rejected = new Response(body, { status: response.status, headers: response.headers });
	if (!body.includes("UNAUTHORIZED")) return rejected;
	const retry = await recoverFromUnauthorized(credentials);
	if (!retry) return rejected;
	const second = await send(retry);
	if (second.status === 401) await rejectCredentials(retry);
	return second;
}

const bearer = (credentials: Credentials, headers: Headers) => {
	headers.set("x-client-timezone", Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
	if (credentials.accessToken) headers.set("authorization", `Bearer ${credentials.accessToken}`);
	else headers.delete("authorization");
	return headers;
};

// RPCLink builds URLs against a placeholder origin; the real server comes from the same snapshot as the token.
const placeholder = "https://server.invalid";

// RPCLink hands over a Request; expo/fetch takes a URL and init. Bodies are buffered (no request streaming), so a
// request can be retried after a refresh.
const rpcFetch = async (request: Request, _init: unknown, options: { context: ClientContext }): Promise<Response> => {
	if (!request.url.startsWith(placeholder)) throw new Error("Unexpected request URL.");
	const path = request.url.slice(placeholder.length);
	const hasBody = request.method !== "GET" && request.method !== "HEAD";
	const body = hasBody ? await request.arrayBuffer() : null;
	return withCredentials(async (credentials) => {
		const response = await expoFetch(`${credentials.server}${path}`, {
			method: request.method,
			headers: bearer(credentials, new Headers(request.headers)),
			body,
			signal: request.signal,
		});
		return response as unknown as Response;
	}, options.context.scope);
};

const isAbort = (error: unknown) => error instanceof Error && error.name === "AbortError";

const createLink = (label: string) =>
	new RPCLink<ClientContext>({
		url: `${placeholder}/api/rpc`,
		fetch: rpcFetch,
		interceptors: [
			async (options) => {
				const { path, input, context, signal, next } = options;
				const scope = context.scope ?? getAccountScope();
				await authorizeAiRequest(path, input, client, scope, signal);
				return next({ ...options, context: { ...context, ...(scope ? { scope } : {}) } });
			},
			// Logs the failure only: errors can carry request data, which must never reach the device log.
			onError((error) => {
				if (isAbort(error)) return;
				console.warn(`[${label}]`, error instanceof Error ? error.name : "error");
			}),
		],
	});

/** Request/response calls. */
export const client: RouterClient<typeof router, ClientContext> = createORPCClient(createLink("oRPC client"));

/** Long-lived event iterators (assistant, resume updates, letter drafts), kept apart from `client`. */
export const streamClient: RouterClient<typeof router, ClientContext> = createORPCClient(
	createLink("oRPC stream client"),
);

/** TanStack Query helpers: `orpc.resume.list.queryOptions()` and friends. */
export const orpc = createTanstackQueryUtils(client);

export type RouterInput = InferRouterInputs<typeof router>;
export type RouterOutput = InferRouterOutputs<typeof router>;

/**
 * Binary endpoints outside `/api/rpc` (exports, `pdf-checks`, `file-imports`), relative to `/api/openapi`.
 * Sends the bearer token and returns the raw response; callers check `ok` and read `arrayBuffer()`/`json()`.
 * The body is sent again after a token refresh, so pass a repeatable one (string, `FormData`, bytes), never a stream.
 */
export async function rest(path: `/${string}`, init: RequestInit = {}, scope = getAccountScope()): Promise<Response> {
	if (path === "/career/voice/transcribe") {
		if (!(init.body instanceof FormData)) throw new Error("Expected a recording form.");
		await authorizeAiRequest(
			["career", "voice", "transcribe"],
			{ providerId: init.body.get("providerId") },
			client,
			scope,
			init.signal ?? undefined,
		);
	}
	return withCredentials(async (credentials) => {
		const response = await expoFetch(`${credentials.server}/api/openapi${path}`, {
			method: init.method ?? "GET",
			headers: bearer(credentials, new Headers(init.headers)),
			body: init.body ?? null,
			signal: init.signal ?? null,
		});
		return response as unknown as Response;
	}, scope ?? undefined);
}
