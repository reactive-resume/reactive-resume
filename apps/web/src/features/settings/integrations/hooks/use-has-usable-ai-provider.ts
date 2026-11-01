import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/libs/orpc/client";

/**
 * Single source of truth for "is an AI provider ready to use" (enabled AND its connection test succeeded).
 * Replaces the predicate that was duplicated across the import dialog, agent setup, and AI settings.
 */
export function useHasUsableAiProvider() {
	const query = useQuery(orpc.aiProviders.list.queryOptions());
	// An unsuccessful lookup cannot establish which connection is safe to use, even with stale cached data.
	const usableProviders = query.isSuccess
		? query.data.filter((provider) => provider.enabled && provider.testStatus === "success")
		: [];

	return {
		providers: query.isSuccess ? query.data : [],
		error: query.error,
		hasUsableProvider: usableProviders.length > 0,
		isLoading: query.isPending,
		isUnavailable: query.isPending || query.isError,
		retry: () => void query.refetch(),
		usableProviders,
	};
}
