import type { QueryClient } from "@tanstack/react-query";
import { useNewDocumentsStore } from "@/features/documents/new-documents";
import { clearStoredThumbnails } from "@/features/documents/thumbnail-store";
import { useLetterEditorStore } from "@/features/letters/store";
import { clearResumeDrafts } from "@/features/resume/builder/draft";

/** Forgets the account that just signed out or was deleted: cached queries, and thumbnails saved on this device. */
export function clearAccountData(queryClient: QueryClient) {
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
	void clearStoredThumbnails();
}
