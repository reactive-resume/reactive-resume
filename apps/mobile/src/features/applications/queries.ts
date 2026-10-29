import type { Application, ApplicationSummary } from "./types";
import type { RouterInput } from "@/api/client";
import type { ListViewToken } from "react-native";
import { t } from "@lingui/core/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { applicationLanesQueryOptions } from "./lane-queries";
import { resolveLane } from "./lanes";
import { client, orpc } from "@/api/client";
import { getAccountScope, getServer, useSession } from "@/auth/session";
import { syncReminders } from "@/features/reminders";
import { showToast } from "@/ui";

/** Same unfiltered list for list, board, calendar and detail; isolated by server. */
export const applicationsListQueryOptions = (server = getServer(), scope = getAccountScope()) => {
	const options = orpc.applications.listSummary.queryOptions({
		input: { includeInitialDetails: 3 },
		context: { scope: scope ?? undefined },
	});
	return { ...options, queryKey: [...options.queryKey, server] };
};
export const applicationsListQueryKey = (server = getServer()) => applicationsListQueryOptions(server).queryKey;
export const applicationDetailQueryOptions = (id: string, server = getServer()) => {
	const options = orpc.applications.getById.queryOptions({
		input: { id },
		context: { scope: getAccountScope() ?? undefined },
	});
	return { ...options, queryKey: [...options.queryKey, server] };
};
export const applicationDetailQueryKey = (id: string, server = getServer()) =>
	applicationDetailQueryOptions(id, server).queryKey;

function getInitialApplicationDetail(summary: ApplicationSummary | undefined) {
	const detail = summary?.initialDetail;
	return detail &&
		detail.status === summary.status &&
		detail.closedReason === summary.closedReason &&
		(detail.laneId ?? null) === (summary.laneId ?? null)
		? detail
		: undefined;
}

export function useApplications() {
	const session = useSession();
	const queryClient = useQueryClient();
	const query = useQuery({ ...applicationsListQueryOptions(session.server), enabled: session.status === "signed-in" });

	useEffect(() => {
		if (!query.data || session.status !== "signed-in") return;
		const listUpdatedAt = query.dataUpdatedAt;
		for (const application of query.data) {
			const initialDetail = getInitialApplicationDetail(application);
			if (!initialDetail) continue;
			const detailKey = applicationDetailQueryOptions(application.id, session.server).queryKey;
			const existing = queryClient.getQueryData<Application>(detailKey);
			if (existing && existing.updatedAt.getTime() >= initialDetail.updatedAt.getTime()) continue;
			void queryClient.cancelQueries({ queryKey: detailKey }, { revert: false });
			queryClient.setQueryData(detailKey, initialDetail, { updatedAt: listUpdatedAt });
		}
	}, [query.data, query.dataUpdatedAt, queryClient, session.server, session.status]);

	return query;
}
export function useApplication(id: string) {
	const session = useSession();
	const queryClient = useQueryClient();
	const listKey = applicationsListQueryKey(session.server);
	const summary = queryClient.getQueryData<ApplicationSummary[]>(listKey)?.find((application) => application.id === id);
	const listUpdatedAt = queryClient.getQueryState(listKey)?.dataUpdatedAt;
	const initialDetail = getInitialApplicationDetail(summary);

	return useQuery({
		...applicationDetailQueryOptions(id, session.server),
		enabled: session.status === "signed-in" && !!id,
		initialData: initialDetail,
		...(listUpdatedAt !== undefined ? { initialDataUpdatedAt: listUpdatedAt } : {}),
	});
}

export function useApplicationDetailPrefetch() {
	const queryClient = useQueryClient();
	const prefetchInFlight = useRef(new Set<string>());
	const prefetchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const onViewableItemsChanged = useCallback(
		({ viewableItems }: { viewableItems: ListViewToken[] }) => {
			clearTimeout(prefetchTimer.current);
			// Section headers also appear in viewability callbacks, without an application ID.
			const ids = viewableItems.flatMap(({ item }) => (typeof item.id === "string" ? [item.id] : [])).slice(0, 2);
			prefetchTimer.current = setTimeout(() => {
				for (const id of ids) {
					const options = applicationDetailQueryOptions(id);
					if (
						prefetchInFlight.current.has(id) ||
						queryClient.getQueryData(options.queryKey) ||
						queryClient.getQueryState(options.queryKey)?.fetchStatus === "fetching"
					)
						continue;
					if (prefetchInFlight.current.size >= 2) break;
					prefetchInFlight.current.add(id);
					void queryClient
						.fetchQuery(options)
						.catch(() => {})
						.finally(() => prefetchInFlight.current.delete(id));
				}
			}, 120);
		},
		[queryClient],
	);
	useEffect(() => () => clearTimeout(prefetchTimer.current), []);
	return onViewableItemsChanged;
}

/** Invalidates all application views, tags, stats and linked document summaries after writes. */
export function useInvalidateApplications() {
	const queryClient = useQueryClient();
	return async () => {
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: orpc.applications.key() }),
			queryClient.invalidateQueries({ queryKey: orpc.documents.list.key() }),
			queryClient.invalidateQueries({ queryKey: ["applications-prior-no-response"] }),
		]);
	};
}

export function useApplicationMutations() {
	const invalidate = useInvalidateApplications();
	const queryClient = useQueryClient();
	// Settlement refetches authoritative state, including after a lost reply or optimistic rollback.
	const onSettled = () => {
		void invalidate();
	};
	// Deleted or closed applications need nothing, so their reminders on this device go (syncing to no targets).
	const cancelReminders = (ids: string[]) => {
		for (const id of ids) void syncReminders(id, []).catch(() => {});
	};
	const scope = getAccountScope();
	const server = getServer();
	const ensureLaneWrite = async (input: { laneId?: string | null | undefined }) => {
		if (!input.laneId) return;
		const metadata = await queryClient.fetchQuery({ ...applicationLanesQueryOptions(server, scope), staleTime: 0 });
		if (!metadata.supported) throw new Error(t`Update your server before moving applications to a custom lane.`);
	};
	const create = useMutation({
		...orpc.applications.create.mutationOptions(),
		mutationFn: async (input: RouterInput["applications"]["create"]) => {
			await ensureLaneWrite(input);
			return client.applications.create(input, { context: { scope: scope ?? undefined } });
		},
		onSettled,
	});
	const update = useMutation({
		...orpc.applications.update.mutationOptions(),
		mutationFn: async (input: RouterInput["applications"]["update"]) => {
			await ensureLaneWrite(input);
			return client.applications.update(input, { context: { scope: scope ?? undefined } });
		},
		onMutate: async (input) => {
			const listKey = applicationsListQueryKey(server);
			await queryClient.cancelQueries({ queryKey: listKey });
			const previous = queryClient.getQueryData<ApplicationSummary[]>(listKey);
			const metadata = queryClient.getQueryData(applicationLanesQueryOptions(server, scope).queryKey);
			const lane = input.laneId ? metadata?.pipeline.lanes.find((item) => item.id === input.laneId) : undefined;
			queryClient.setQueryData<ApplicationSummary[]>(listKey, (rows) =>
				rows?.map((row) =>
					row.id === input.id
						? {
								...row,
								...(input.status
									? {
											status: input.status,
											...(input.status !== row.status
												? {
														laneId: metadata ? resolveLane(metadata.pipeline.lanes, { status: input.status }).id : null,
													}
												: {}),
										}
									: {}),
								...(lane ? { laneId: lane.id, status: lane.category, closedReason: lane.closedReason } : {}),
								...(input.closedReason !== undefined ? { closedReason: input.closedReason } : {}),
							}
						: row,
				),
			);
			return { previous, listKey };
		},
		onError: (_error, _input, context) => {
			if (scope === getAccountScope() && context?.previous) queryClient.setQueryData(context.listKey, context.previous);
		},
		onSuccess: (data) => {
			if (data.status === "closed") cancelReminders([data.id]);
		},
		onSettled,
	});
	const remove = useMutation({
		...orpc.applications.delete.mutationOptions(),
		onSuccess: (_data, input) => {
			cancelReminders([input.id]);
		},
		onSettled,
	});
	const bulkUpdate = useMutation({
		...orpc.applications.bulkUpdate.mutationOptions(),
		mutationFn: async (input: RouterInput["applications"]["bulkUpdate"]) => {
			await ensureLaneWrite(input);
			return client.applications.bulkUpdate(input, { context: { scope: scope ?? undefined } });
		},
		onSuccess: async (data, input) => {
			const metadata = queryClient.getQueryData(applicationLanesQueryOptions(server, scope).queryKey);
			const category = input.status ?? metadata?.pipeline.lanes.find((lane) => lane.id === input.laneId)?.category;
			// A successful receipt for every requested row plus an immutable target category confirms closure.
			if (category === "closed" && data.updated === input.ids.length) {
				cancelReminders(input.ids);
				return;
			}
			if (scope !== getAccountScope()) return;
			// Bulk's count is not evidence of each row's canonical status. Read the authoritative result.
			try {
				await queryClient.cancelQueries({ queryKey: applicationsListQueryKey(server) });
				const rows = await queryClient.fetchQuery({ ...applicationsListQueryOptions(server, scope), staleTime: 0 });
				if (scope === getAccountScope())
					cancelReminders(
						rows.filter((row) => input.ids.includes(row.id) && row.status === "closed").map((row) => row.id),
					);
			} catch {
				if (scope === getAccountScope())
					showToast({
						message: t`Applications updated, but device reminders couldn't be refreshed. Open application details when you're back online.`,
					});
			}
		},
		onSettled,
	});
	const bulkDelete = useMutation({
		...orpc.applications.bulkDelete.mutationOptions(),
		onSuccess: (_data, input) => {
			cancelReminders(input.ids);
		},
		onSettled,
	});
	const importCsv = useMutation({ ...orpc.applications.import.mutationOptions(), onSettled });
	return { create, update, remove, bulkUpdate, bulkDelete, importCsv };
}
