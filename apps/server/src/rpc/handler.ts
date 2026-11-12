import { onError, ORPCError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { BatchHandlerPlugin, RequestHeadersPlugin, StrictGetMethodPlugin } from "@orpc/server/plugins";
import router from "@reactive-resume/api/routers";
import { describeError, platformRequestId } from "../http/error-log";
import { mergeResponseHeaders } from "../http/headers";
import { readAccountBinding } from "./account-header";
import { getRequestLocale } from "./locale";

// An RPC address is the procedure path itself (no parameters), and an error only gets here once a route matched.
const rpcProcedure = (pathname: string, prefix?: string) => {
	const path = (prefix ? pathname.replace(prefix, "") : pathname).replace(/^\/|\/$/g, "");
	return path.length <= 128 && /^[\w-]+(\/[\w-]+)*$/.test(path) ? path.replaceAll("/", ".") : "unknown";
};

const rpcHandler = new RPCHandler(router, {
	plugins: [new BatchHandlerPlugin(), new RequestHeadersPlugin(), new StrictGetMethodPlugin()],
	// Runs after the batch plugin maps each item and before RequestHeadersPlugin reads the envelope. A batch item may
	// carry its own account expectation; authentication keeps using the envelope, so an item cannot swap the cookie.
	rootInterceptors: [
		(interceptorOptions) => {
			const accountId = readAccountBinding(interceptorOptions.request.headers);
			return interceptorOptions.next({
				...interceptorOptions,
				context: {
					...interceptorOptions.context,
					...(accountId ? { rpcItemAccountId: accountId } : {}),
				},
			});
		},
	],
	interceptors: [
		onError((error, { request, prefix, context }) => {
			// Signed-out or expired callers are routine; their 401 still reaches the client.
			if (error instanceof ORPCError && error.code === "UNAUTHORIZED") return;
			const requestId = platformRequestId(context.reqHeaders);
			// Validation errors can contain submitted profile values; keep payloads out of server logs.
			console.error("[oRPC Server]", {
				procedure: rpcProcedure(request.url.pathname, prefix),
				...describeError(error),
				...(requestId ? { requestId } : {}),
			});
		}),
	],
});

export async function handleRpc(request: Request, trustedClient: string) {
	// RPC answers depend on the caller's cookies or credentials (private resumes, unlocked password-protected ones),
	// so no browser or shared cache may keep them.
	const resHeaders = new Headers({ "Cache-Control": "private, no-store" });
	const { response } = await rpcHandler.handle(request, {
		prefix: "/api/rpc",
		context: {
			locale: getRequestLocale(request),
			reqHeaders: request.headers,
			resHeaders,
			trustedClient,
		},
	});

	if (!response) return new Response("NOT_FOUND", { status: 404, headers: { "Cache-Control": "private, no-store" } });
	return mergeResponseHeaders(response, resHeaders);
}
