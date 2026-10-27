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

export function getInitialApplicationDetail(summary: ApplicationSummary | null | undefined) {
	const detail = summary?.initialDetail;
	return detail && detail.status === summary.status && detail.closedReason === summary.closedReason
		? detail
		: undefined;
}

export function hydrateApplicationDetail(queryClient: QueryClient, summary: ApplicationSummary) {
	const detail = getInitialApplicationDetail(summary);
	if (!detail) return;
	const detailKey = applicationDetailQueryOptions(summary.id).queryKey;
	const existing = queryClient.getQueryData<Application>(detailKey);
	if (existing && existing.updatedAt.getTime() >= detail.updatedAt.getTime()) return;
	void queryClient.cancelQueries({ queryKey: detailKey }, { revert: false });
	// List snapshots render immediately, then refresh on the first detail open.
	queryClient.setQueryData(detailKey, detail, { updatedAt: 0 });
}
