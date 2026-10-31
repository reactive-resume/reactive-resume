import type { QueryClient } from "@tanstack/react-query";
import { broadcastAccountChange, invalidateAccountScope, subscribeAccountChange } from "./account-scope";
import { useNewDocumentsStore } from "@/features/documents/new-documents";
import { clearStoredThumbnails } from "@/features/documents/thumbnail-store";
import { useLetterEditorStore } from "@/features/letters/store";
import { clearResumeDrafts } from "@/features/resume/builder/draft";

export { getAccountGeneration } from "./account-scope";

/** Forgets the account that just signed out or was deleted: cached queries, and thumbnails saved on this device. */
export function clearAccountData(queryClient: QueryClient) {
	invalidateAccountScope();
	forgetAccountState(queryClient);
	broadcastAccountChange();
	void clearStoredThumbnails();
}

/**
 * Applies a sign-out or account change made in another tab. Every mounted form and queued save belongs to the old
 * account, so this tab fences them and reloads into the session the browser now holds; nothing typed for the old
 * account is shown or written under the new one.
 */
let syncing = false;
export function syncAccountDataAcrossTabs(queryClient: QueryClient) {
	if (syncing) return;
	syncing = true;
	return subscribeAccountChange(() => {
		forgetAccountState(queryClient);
		void clearStoredThumbnails();
		window.location.reload();
	});
}

function forgetAccountState(queryClient: QueryClient) {
	clearResumeDrafts();
	useLetterEditorStore.getState().reset();
	queryClient.clear();
	useNewDocumentsStore.setState({ ids: [] });
	for (const kind of ["localStorage", "sessionStorage"] as const) {
		try {
			const storage = window[kind];
			for (const key of Object.keys(storage)) {
				if (
					/^(?:letter-sender:|reactive-resume:unsaved:|career[-:]|applications-follow-up-dismissed$|new-documents$)/.test(
						key,
					)
				)
					storage.removeItem(key);
			}
		} catch {
			// Blocked browser storage must not prevent signing out.
		}
	}
}
