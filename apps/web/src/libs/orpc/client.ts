import type { InferRouterOutputs, RouterClient } from "@orpc/server";
import type router from "@reactive-resume/api/routers";
import { createORPCClient, onError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { BatchLinkPlugin } from "@orpc/client/plugins";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { rpcFetch } from "./fetch";
import { getAccountId } from "@/libs/auth/account-scope";

/**
 * The account a call belongs to. Captured when the call starts (before any await, batching or body staging), so a
 * session switch during dispatch cannot relabel a payload that was built for the previous account. `bound` marks a call
 * whose caller named its account explicitly: those never batch, so a mixed batch can never hide one under another.
 */
export type ClientContext = { accountId?: string; bound?: boolean };

const getRpcUrl = () => `${window.location.origin}/api/rpc`;

const accountHeaders = (options: { context: ClientContext }) =>
	options.context.accountId ? { "x-account-id": options.context.accountId } : {};

export const client: RouterClient<typeof router, ClientContext> = createORPCClient(
	new RPCLink<ClientContext>({
		url: getRpcUrl,
		fetch: rpcFetch,
		headers: accountHeaders,
		plugins: [
			new BatchLinkPlugin<ClientContext>({
				mode: "streaming",
				groups: [{ condition: () => true, context: {} }],
				// An explicitly bound call must keep its own envelope; batching could merge it with another account.
				exclude: (options) => options.context.bound === true,
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
		fetch: rpcFetch,
		headers: accountHeaders,
		interceptors: [
			(options) => {
				const bound = options.context.accountId !== undefined;
				const accountId = options.context.accountId ?? getAccountId() ?? undefined;
				return options.next({
					...options,
					context: accountId ? { ...options.context, accountId, ...(bound ? { bound: true } : {}) } : options.context,
				});
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
