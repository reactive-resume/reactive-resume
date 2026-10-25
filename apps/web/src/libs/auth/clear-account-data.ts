import type { QueryClient } from "@tanstack/react-query";
import { clearStoredThumbnails } from "@/features/documents/thumbnail-store";

/** Forgets the account that just signed out or was deleted: cached queries, and thumbnails saved on this device. */
export function clearAccountData(queryClient: QueryClient) {
	queryClient.clear();
	void clearStoredThumbnails();
}
