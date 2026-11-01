import type { InferRouterOutputs, RouterClient } from "@orpc/server";
import type router from "@reactive-resume/api/routers";
import { createORPCClient, onError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { BatchLinkPlugin } from "@orpc/client/plugins";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { authorizeAiRequest } from "./ai-consent";
import { rpcFetch } from "./fetch";
import { getAccountId } from "@/libs/auth/account-scope";

/**
 * The account a call belongs to. Captured when the call starts (before any await, batching or body staging), so a
 * session switch during dispatch cannot relabel a payload that was built for the previous account. `bound` marks a call
 * whose caller named its account explicitly: those never batch, so a mixed batch can never hide one under another.
 * The AI/web destination fields are the per-call consent context added by the AI consent owner.
 */
export type ClientContext = {
	accountId?: string;
	bound?: boolean;
	aiDestination?: string;
	webDestination?: string;
};

const getRpcUrl = () => `${window.location.origin}/api/rpc`;

const headers = ({ context }: { context: ClientContext }) => ({
	...(context.accountId ? { "x-account-id": context.accountId } : {}),
	...(context.aiDestination ? { "x-ai-destination": context.aiDestination } : {}),
	...(context.webDestination ? { "x-web-destination": context.webDestination } : {}),
});

export const client: RouterClient<typeof router, ClientContext> = createORPCClient(
	new RPCLink<ClientContext>({
		url: getRpcUrl,
		headers,
		fetch: rpcFetch,
		plugins: [
			new BatchLinkPlugin<ClientContext>({
				mode: "streaming",
				groups: [{ condition: () => true, context: {} }],
				// A consent-scoped AI call and an explicitly bound call must each keep their own request envelope.
				exclude: ({ context }) => context.bound === true || Boolean(context.aiDestination || context.webDestination),
			}),
		],
		interceptors: [
			// Runs before the request is encoded, so the header carries the account this call was made for, not whichever
			// account the tab discovered while the request was being prepared.
			(options) => {
				const bound = options.context.accountId !== undefined;
				const accountId = options.context.accountId ?? getAccountId() ?? undefined;
				return options.next({
					...options,
					context: accountId ? { ...options.context, accountId, ...(bound ? { bound: true } : {}) } : options.context,
				});
			},
			async (options) => {
				const destination = await authorizeAiRequest(options.path, options.input, client, options.signal);
				return options.next({ ...options, context: { ...options.context, ...destination } });
			},
			onError((error) => {
				if (error instanceof DOMException && error.name === "AbortError") return;
				console.warn("[oRPC client]", error);
			}),
		],
	}),
);

export const streamClient: RouterClient<typeof router, ClientContext> = createORPCClient(
	new RPCLink<ClientContext>({
		url: getRpcUrl,
		headers,
		fetch: rpcFetch,
		interceptors: [
			(options) => {
				const bound = options.context.accountId !== undefined;
				const accountId = options.context.accountId ?? getAccountId() ?? undefined;
				return options.next({
					...options,
					context: accountId ? { ...options.context, accountId, ...(bound ? { bound: true } : {}) } : options.context,
				});
			},
			async (options) => {
				const destination = await authorizeAiRequest(options.path, options.input, client, options.signal);
				return options.next({ ...options, context: { ...options.context, ...destination } });
			},
			onError((error) => {
				if (error instanceof DOMException && error.name === "AbortError") return;
				console.warn("[oRPC stream client]", error);
			}),
		],
	}),
);

export const orpc = createTanstackQueryUtils(client);

export type RouterOutput = InferRouterOutputs<typeof router>;
