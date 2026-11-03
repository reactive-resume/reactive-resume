import type { QueryKey } from "@tanstack/react-query";
import { StandardRPCJsonSerializer } from "@orpc/client/standard";
import { matchQuery, MutationCache, QueryClient } from "@tanstack/react-query";

const serializer = new StandardRPCJsonSerializer();

/** Prepared mutations read their hidden rows separately; other caches retain the normal mutation policy. */
export const invalidateMutationQueries = (queryClient: QueryClient, canonicalKey?: QueryKey) =>
	queryClient.invalidateQueries({
		predicate: (query) => {
			const key = query.queryKey[0];
			return key !== "auth" && key !== "flags" && (!canonicalKey || !matchQuery({ queryKey: canonicalKey }, query));
		},
	});

export const getQueryClient = () => {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				gcTime: 5 * 60 * 1000, // 5 minutes
				staleTime: 60 * 1000, // 1 minute
				queryKeyHashFn(queryKey) {
					const [json, meta] = serializer.serialize(queryKey);
					return JSON.stringify({ json, meta });
				},
			},
		},
		mutationCache: new MutationCache({
			onSettled: (_1, _2, _3, _4, _5, context) => {
				if (context?.meta?.noInvalidate) return;
				void invalidateMutationQueries(queryClient);
			},
		}),
	});

	return queryClient;
};
