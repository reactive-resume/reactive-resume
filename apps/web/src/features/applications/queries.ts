import type { Application, ApplicationSummary } from "./types";
import type { QueryClient } from "@tanstack/react-query";
import { orpc } from "@/libs/orpc/client";

// A single source of truth for the lightweight applications list query so the query key stays identical
// across the board (optimistic drag), the detail panel, and the route.
const LIST_INPUT = { includeInitialDetails: 3 } as const;
const FULL_LIST_INPUT = {} as const;

export const applicationsListQueryOptions = () => orpc.applications.listSummary.queryOptions({ input: LIST_INPUT });
export const applicationsListQueryKey = () => orpc.applications.listSummary.queryKey({ input: LIST_INPUT });
export const applicationsFullListQueryOptions = () => orpc.applications.list.queryOptions({ input: FULL_LIST_INPUT });

export const applicationDetailQueryOptions = (id: string) => orpc.applications.getById.queryOptions({ input: { id } });
export const applicationDetailQueryKey = (id: string) => applicationDetailQueryOptions(id).queryKey;

export function hydrateApplicationDetail(queryClient: QueryClient, summary: ApplicationSummary) {
	const detail = summary.initialDetail;
	if (!detail || !initialDetailMatchesSummary(summary, detail)) return false;
	const detailKey = applicationDetailQueryOptions(summary.id).queryKey;
	const existing = queryClient.getQueryData<Application>(detailKey);
	const detailVersion = new Date(detail.updatedAt).getTime();
	const existingVersion = existing ? new Date(existing.updatedAt).getTime() : -Infinity;
	if (queryClient.getQueryState(detailKey)?.fetchStatus === "fetching")
		void queryClient.cancelQueries({ queryKey: detailKey }, { revert: false });
	if (existingVersion >= detailVersion) return true;
	queryClient.setQueryData(detailKey, detail, { updatedAt: 0 });
	void queryClient.invalidateQueries({ queryKey: detailKey, refetchType: "none" });
	return true;
}

export function initialDetailMatchesSummary(
	summary: Pick<ApplicationSummaryForPrefetch, "status" | "closedReason">,
	detail: Pick<ApplicationSummaryForPrefetch, "status" | "closedReason">,
) {
	return summary.status === detail.status && summary.closedReason === detail.closedReason;
}

export type ApplicationSummaryForPrefetch = {
	status: string;
	closedReason: string | null;
};
