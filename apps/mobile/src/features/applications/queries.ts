import type { Application, ApplicationSummary } from "./types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { orpc } from "@/api/client";
import { getServer, useSession } from "@/auth/session";
import { syncReminders } from "@/features/reminders";

/** Same unfiltered list for list, board, calendar and detail; isolated by server. */
export const applicationsListQueryOptions = (server = getServer()) => {
	const options = orpc.applications.listSummary.queryOptions({ input: { includeInitialDetails: 3 } });
	return { ...options, queryKey: [...options.queryKey, server] };
};
export const applicationsListQueryKey = (server = getServer()) => applicationsListQueryOptions(server).queryKey;
export const applicationDetailQueryOptions = (id: string, server = getServer()) => {
	const options = orpc.applications.getById.queryOptions({ input: { id } });
	return { ...options, queryKey: [...options.queryKey, server] };
};
export const applicationDetailQueryKey = (id: string, server = getServer()) =>
	applicationDetailQueryOptions(id, server).queryKey;

export function useApplications() {
	const session = useSession();
	const queryClient = useQueryClient();
	const query = useQuery({ ...applicationsListQueryOptions(session.server), enabled: session.status === "signed-in" });

	useEffect(() => {
		if (!query.data || session.status !== "signed-in") return;
		const listUpdatedAt = query.dataUpdatedAt;
		for (const application of query.data) {
			const initialDetail = application.initialDetail;
			if (
				!initialDetail ||
				initialDetail.status !== application.status ||
				initialDetail.closedReason !== application.closedReason
			)
				continue;
			const detailKey = applicationDetailQueryOptions(application.id, session.server).queryKey;
			const existing = queryClient.getQueryState<Application>(detailKey)?.data;
			if (existing && new Date(existing.updatedAt).getTime() >= new Date(initialDetail.updatedAt).getTime()) continue;
			void queryClient.cancelQueries({ queryKey: detailKey }).then(() => {
				const current = queryClient.getQueryState<Application>(detailKey)?.data;
				if (current && new Date(current.updatedAt).getTime() >= new Date(initialDetail.updatedAt).getTime()) return;
				queryClient.setQueryData(detailKey, initialDetail, { updatedAt: listUpdatedAt });
			});
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
	const initialDetail =
		summary?.initialDetail &&
		summary.initialDetail.status === summary.status &&
		summary.initialDetail.closedReason === summary.closedReason
			? summary.initialDetail
			: undefined;

	return useQuery({
		...applicationDetailQueryOptions(id, session.server),
		enabled: session.status === "signed-in" && !!id,
		...(initialDetail
			? { initialData: initialDetail, ...(listUpdatedAt ? { initialDataUpdatedAt: listUpdatedAt } : {}) }
			: {}),
	});
}

/** Invalidates all application views, tags, stats and linked document summaries after writes. */
export function useInvalidateApplications() {
	const queryClient = useQueryClient();
	return async () => {
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: orpc.applications.key() }),
			queryClient.invalidateQueries({ queryKey: orpc.documents.list.key() }),
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
	const create = useMutation({ ...orpc.applications.create.mutationOptions(), onSettled });
	const update = useMutation({
		...orpc.applications.update.mutationOptions(),
		onMutate: async (input) => {
			const listKey = applicationsListQueryKey();
			await queryClient.cancelQueries({ queryKey: listKey });
			const previous = queryClient.getQueryData<ApplicationSummary[]>(listKey);
			queryClient.setQueryData<ApplicationSummary[]>(listKey, (rows) =>
				rows?.map((row) =>
					row.id === input.id
						? {
								...row,
								...(input.status ? { status: input.status } : {}),
								...(input.closedReason !== undefined ? { closedReason: input.closedReason } : {}),
							}
						: row,
				),
			);
			return { previous, listKey };
		},
		onError: (_error, _input, context) => {
			if (context?.previous) queryClient.setQueryData(context.listKey, context.previous);
		},
		onSuccess: (_data, input) => {
			if (input.status === "closed") cancelReminders([input.id]);
		},
		onSettled,
	});
	const remove = useMutation({
		...orpc.applications.delete.mutationOptions(),
		onSuccess: (_data, input) => cancelReminders([input.id]),
		onSettled,
	});
	const bulkUpdate = useMutation({
		...orpc.applications.bulkUpdate.mutationOptions(),
		onSuccess: (_data, input) => {
			if (input.status === "closed") cancelReminders(input.ids);
		},
		onSettled,
	});
	const bulkDelete = useMutation({
		...orpc.applications.bulkDelete.mutationOptions(),
		onSuccess: (_data, input) => cancelReminders(input.ids),
		onSettled,
	});
	const importCsv = useMutation({ ...orpc.applications.import.mutationOptions(), onSettled });
	return { create, update, remove, bulkUpdate, bulkDelete, importCsv };
}
