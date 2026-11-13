import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { resume, letter, clearDraftsFor } from "./draft/runtime";
import { clearQueryCache } from "./query-client";
import { writeQueue, queueKinds } from "./queue";
import { getRetainedAccountScope } from "@/auth/session";
import { useSession } from "@/auth/session";

export class PendingChangesError extends Error {
	constructor(readonly counts: Awaited<ReturnType<typeof pendingCounts>>) {
		super("Changes are waiting to sync.");
		this.name = "PendingChangesError";
	}
}
export async function pendingCounts(scope = getRetainedAccountScope()) {
	const counts = Object.fromEntries(queueKinds.map((kind) => [kind, 0])) as Record<(typeof queueKinds)[number], number>;
	if (!scope) return counts;
	Object.assign(counts, writeQueue.count(scope));
	counts.documents += (await resume.listPending()).length;
	counts.letters += (await letter.listPending()).length;
	return counts;
}
let pendingVersion = 0;
function subscribePending(listener: () => void) {
	const changed = () => {
		pendingVersion++;
		listener();
	};
	const stops = [writeQueue.subscribe(changed), resume.subscribePending(changed), letter.subscribePending(changed)];
	return () => {
		for (const stop of stops) stop();
	};
}
/** S8 counts draft-backed documents as well as generic queued profile/Career/application writes. */
export function usePendingChanges() {
	const session = useSession();
	const version = useSyncExternalStore(subscribePending, () => pendingVersion);
	const scope = getRetainedAccountScope();
	return useQuery({
		queryKey: [scope, "pending-counts", version, session.status],
		queryFn: () => pendingCounts(scope),
		staleTime: 0,
		meta: { persist: false },
	});
}
export async function prepareSignOut(scope: string | null, discard: boolean) {
	if (!scope) return;
	if (writeQueue.isSaving(scope)) throw new Error("Changes are saving. Try again.");
	if (discard) return;
	// Flush authored state to the durable draft store before counting it.
	await Promise.all([resume.store.getState().flush(), letter.store.getState().flush()]);
	const counts = await pendingCounts(scope);
	if (!discard && Object.values(counts).some(Boolean)) throw new PendingChangesError(counts);
}
export async function clearAccountData(scope: string) {
	clearDraftsFor(scope);
	writeQueue.discard(scope);
	clearQueryCache(scope);
	const { clearRenderCache } = await import("@/render/page-renderer");
	await clearRenderCache(scope);
}
