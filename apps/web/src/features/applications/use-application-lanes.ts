import type { LaneMode } from "./lanes";
import { ORPCError } from "@orpc/client";
import { useQuery } from "@tanstack/react-query";
import { createDefaultApplicationLanes, getActiveApplicationLanes } from "@reactive-resume/schema/applications/lanes";
import { orpc } from "@/libs/orpc/client";

/**
 * True only when the server predates lanes: an unknown procedure comes back as a bare 404 body rather than an oRPC
 * error. A procedure's own NOT_FOUND, auth failures and network errors are not this.
 */
function isLanesUnsupported(error: unknown) {
	if (!(error instanceof ORPCError) || error.status !== 404) return false;
	const data: unknown = error.data;
	return typeof data === "object" && data !== null && "body" in data;
}

export const applicationLanesQueryOptions = () =>
	orpc.applications.lanes.get.queryOptions({
		staleTime: 60_000,
		retry: (count, error) => !isLanesUnsupported(error) && count < 2,
	});
export const applicationLanesQueryKey = () => orpc.applications.lanes.get.queryKey();

/**
 * The owner's lanes. On a server without lanes, the six fixed defaults (`mode: "legacy"`, write `status` only); the
 * same defaults show while loading or after an error, which the caller reports.
 */
export function useApplicationLanes() {
	const query = useQuery(applicationLanesQueryOptions());
	const unsupported = isLanesUnsupported(query.error);
	const lanes = query.data?.lanes ?? createDefaultApplicationLanes();
	const mode: LaneMode = query.data ? "lanes" : "legacy";
	return {
		lanes,
		active: getActiveApplicationLanes(lanes),
		revision: query.data?.revision ?? 0,
		mode,
		unsupported,
		error: query.isError && !unsupported && !query.data ? query.error : null,
		isPending: query.isPending,
		refetch: query.refetch,
	};
}
