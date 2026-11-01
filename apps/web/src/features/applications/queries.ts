import type { OfferHint } from "./next-step";
import type { Application, ApplicationSummary } from "./types";
import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
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
	// Lanes too: a move between two lanes of one stage leaves status and reason alone.
	return detail &&
		detail.status === summary.status &&
		detail.closedReason === summary.closedReason &&
		(detail.laneId ?? null) === (summary.laneId ?? null)
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

/** Every saved offer, the one query Career's Offers page shares; Next step reads reply deadlines from it. */
export const savedOffersQueryOptions = () => orpc.career.savedItems.queryOptions({ input: { kind: "offer" } });

/**
 * Each application's newest saved offer, as Next step needs it. Undefined until the offers have loaded (or when
 * they can't), so an application at Offer reads "Decide on the offer" rather than claiming no terms were saved.
 */
export function useOfferHints(enabled = true): ReadonlyMap<string, OfferHint> | undefined {
	const { data } = useQuery({ ...savedOffersQueryOptions(), enabled });
	return useMemo(() => {
		if (!data) return undefined;
		const hints = new Map<string, OfferHint & { at: number }>();
		for (const item of data) {
			if (item.data.kind !== "offer" || !item.applicationId) continue;
			const at = new Date(item.createdAt).getTime();
			const known = hints.get(item.applicationId);
			if (!known || at > known.at) hints.set(item.applicationId, { respondBy: item.data.respondBy, at });
		}
		return hints;
	}, [data]);
}

/** What Next step knows of an application's offer: its hint, null when none is saved, undefined when unknown. */
export const offerHintFor = (hints: ReadonlyMap<string, OfferHint> | undefined, applicationId: string) =>
	hints ? (hints.get(applicationId) ?? null) : undefined;
