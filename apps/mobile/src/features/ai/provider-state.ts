import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/api/client";
import { useSession } from "@/auth/session";

/** Readiness is unknown on loading/error. Disabled (signed-out) queries never report loading. */
export function useHasAIProvider() {
	const session = useSession();
	const options = orpc.aiProviders.list.queryOptions();
	const query = useQuery({
		...options,
		queryKey: [...options.queryKey, session.server],
		enabled: session.status === "signed-in",
	});
	const available = session.status === "signed-in" && query.isSuccess;
	const providers = available ? query.data : [];
	const usableProviders = providers.filter((provider) => provider.enabled && provider.testStatus === "success");
	return {
		providers,
		usableProviders,
		// The server orders explicit default first, then stable oldest runnable fallback.
		defaultProvider: usableProviders[0] ?? null,
		hasAIProvider: usableProviders.length > 0,
		isLoading: session.status === "signed-in" && query.isPending,
		isUnavailable: !available,
		error: query.error,
		retry: () => void query.refetch(),
	};
}
