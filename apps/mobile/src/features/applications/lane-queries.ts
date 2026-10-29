import type { ApplicationPipeline } from "@reactive-resume/schema/applications/lanes";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { createDefaultApplicationLanes, getActiveApplicationLanes, unsupportedLaneApi } from "./lanes";
import { client } from "@/api/client";
import { getAccountScope, getServer, useSession } from "@/auth/session";

export type LaneMetadata = { supported: boolean; pipeline: ApplicationPipeline };

export const applicationLanesQueryOptions = (server = getServer(), scope = getAccountScope()) =>
	queryOptions({
		queryKey: ["application-lanes", server, scope],
		queryFn: async ({ signal }): Promise<LaneMetadata> => {
			try {
				const pipeline = await client.applications.lanes.get(undefined, {
					signal,
					context: { scope: scope ?? undefined },
				});
				return { supported: true, pipeline };
			} catch (error) {
				if (!unsupportedLaneApi(error)) throw error;
				return { supported: false, pipeline: { revision: 0, lanes: createDefaultApplicationLanes() } };
			}
		},
		staleTime: 30_000,
	});

export function useApplicationLanes() {
	const session = useSession();
	const query = useQuery({ ...applicationLanesQueryOptions(session.server), enabled: session.status === "signed-in" });
	const lanes = query.data?.pipeline.lanes ?? createDefaultApplicationLanes();
	return {
		...query,
		lanes,
		active: getActiveApplicationLanes(lanes),
		supported: query.data?.supported === true,
		// Without metadata, default choices can still use safe canonical writes while the retry notice stays visible.
		ready: query.isSuccess || (query.isError && !query.data),
	};
}
