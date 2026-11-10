import { QueryClient, dehydrate, hydrate } from "@tanstack/react-query";
import { encode, decode } from "./codec";
import Storage from "@/data/storage";

/** One owner per account. Destroy the owner on identity changes, never reuse another account's cache. */
export function createAccountQueryClient(scope: string) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { staleTime: 30_000, retry: 1 },
			mutations: { retry: false },
			dehydrate: { serializeData: encode },
			hydrate: { deserializeData: decode },
		},
	});
	const key = `query:${scope}`;
	try {
		const cached = Storage.getItemSync(key);
		if (cached) hydrate(queryClient, JSON.parse(cached));
	} catch {
		Storage.removeItemSync(key);
	}
	let timer: ReturnType<typeof setTimeout> | undefined;
	const stop = queryClient.getQueryCache().subscribe(() => {
		clearTimeout(timer);
		timer = setTimeout(() => {
			// Tokens never enter query data. Only successful, account-bound resource queries are persisted.
			Storage.setItemSync(
				key,
				JSON.stringify(
					dehydrate(queryClient, {
						shouldDehydrateQuery: (query) => query.state.status === "success" && query.meta?.persist !== false,
					}),
				),
			);
		}, 250);
	});
	return {
		queryClient,
		dispose() {
			stop();
			clearTimeout(timer);
			void queryClient.cancelQueries();
			queryClient.clear();
		},
	};
}
export function clearQueryCache(scope: string) {
	Storage.removeItemSync(`query:${scope}`);
}
