import type { InferRouterInputs, InferRouterOutputs, RouterClient } from "@orpc/server";
import type router from "@reactive-resume/api/routers";
import { createORPCClient, onError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { BatchLinkPlugin } from "@orpc/client/plugins";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { authorizeAiRequest } from "./ai-consent";
import { rpcFetch } from "./fetch";

type AiContext = { aiDestination?: string; webDestination?: string };

const getRpcUrl = () => `${window.location.origin}/api/rpc`;

export const client: RouterClient<typeof router> = createORPCClient(
	new RPCLink<AiContext>({
		url: getRpcUrl,
		headers: ({ context }) => ({
			...(context.aiDestination ? { "x-ai-destination": context.aiDestination } : {}),
			...(context.webDestination ? { "x-web-destination": context.webDestination } : {}),
		}),
		fetch: rpcFetch,
		plugins: [
			new BatchLinkPlugin({
				mode: "streaming",
				exclude: ({ context }) => !!(context.aiDestination || context.webDestination),
				groups: [{ condition: () => true, context: {} }],
			}),
		],
		interceptors: [
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

export const streamClient: RouterClient<typeof router> = createORPCClient(
	new RPCLink<AiContext>({
		url: getRpcUrl,
		headers: ({ context }) => ({
			...(context.aiDestination ? { "x-ai-destination": context.aiDestination } : {}),
			...(context.webDestination ? { "x-web-destination": context.webDestination } : {}),
		}),
		fetch: rpcFetch,
		interceptors: [
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
export type RouterInput = InferRouterInputs<typeof router>;
