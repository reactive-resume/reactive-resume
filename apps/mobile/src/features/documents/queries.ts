import type { DocumentSummary } from "./filter";
import { plural, t } from "@lingui/core/macro";
import { ORPCError } from "@orpc/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getNetworkStateAsync } from "expo-network";
import { useRef, useState } from "react";
import { SUBMITTED_DOCUMENT_LOCKED } from "@reactive-resume/schema/applications/errors";
import { documentRef } from "./filter";
import { client, orpc } from "@/api/client";
import { getServer, useSession } from "@/auth/session";
import { showToast } from "@/ui";

type BatchOptions = {
	applies?: (document: DocumentSummary) => boolean;
	alreadyDone?: (document: DocumentSummary) => boolean;
	notify?: boolean;
};

// One request body stays bounded even when an older client has loaded the whole library.
const BATCH_SIZE = 500;
const chunks = <T>(items: readonly T[]) =>
	Array.from({ length: Math.ceil(items.length / BATCH_SIZE) }, (_, index) =>
		items.slice(index * BATCH_SIZE, (index + 1) * BATCH_SIZE),
	);

export function documentError(error: unknown) {
	if (error instanceof ORPCError) {
		if (error.data?.reason === SUBMITTED_DOCUMENT_LOCKED)
			return t`This application keeps the documents you submitted. Choose an application without a submitted letter, or duplicate the letter for another job.`;
		if (error.code === "UNAUTHORIZED") return t`Your session expired. Sign in again.`;
		if (error.code === "FORBIDDEN") return t`Unlock it first, then try again.`;
		if (error.code === "NOT_FOUND") return t`This document is no longer available. Refresh and try again.`;
		if (error.code === "TOO_MANY_REQUESTS" || error.code === "RATE_LIMIT_EXCEEDED")
			return t`Too many requests. Try again later.`;
		if (error.code === "BAD_REQUEST") return t`Check the file or fields and try again.`;
		if (error.code === "RESUME_SLUG_ALREADY_EXISTS")
			return t`Another resume already uses this address. Choose a different one.`;
		if (error.code === "RESUME_LOCKED") return t`This resume is locked. Unlock it to make changes.`;
		if (error.code === "INVALID_SLUG")
			return `${t`Use at most 64 characters.`} ${t`The address must contain only lowercase letters and numbers, separated by single dashes.`}`;
	}
	return t`Couldn't complete this action. Try again.`;
}

export function useDocuments(trashed = false) {
	const session = useSession();
	const options = orpc.documents.list.queryOptions({ input: { trashed } });
	return useQuery({
		...options,
		queryKey: [...options.queryKey, session.server],
		enabled: session.status === "signed-in",
	});
}

export function useDocumentRefresh() {
	const queryClient = useQueryClient();
	return () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: orpc.documents.key() }),
			queryClient.invalidateQueries({ queryKey: orpc.resume.key() }),
			queryClient.invalidateQueries({ queryKey: orpc.coverLetters.key() }),
			queryClient.invalidateQueries({ queryKey: orpc.applications.key() }),
		]);
}

/** Serialize user actions; report partial batches and undo only successful Trash moves. */
export function useDocumentOperations(enabled = true) {
	const refresh = useDocumentRefresh();
	const session = useSession();
	const active = useRef(false);
	const idle = useRef(Promise.resolve());
	const partial = useRef(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const fail = (message: string) => {
		setError(message);
		showToast({ message });
		return false;
	};
	const run = async (task: () => Promise<unknown>) => {
		if (!enabled || active.current) return false;
		active.current = true;
		let finish = () => {};
		idle.current = new Promise<void>((resolve) => {
			finish = resolve;
		});
		partial.current = false;
		setBusy(true);
		setError(null);
		try {
			if (session.status !== "signed-in" || getServer() !== session.server) {
				return fail(t`Sign in to continue.`);
			}
			const network = await getNetworkStateAsync();
			if (network.isConnected === false || network.isInternetReachable === false) {
				return fail(t`You're offline. Try again when you reconnect.`);
			}
			if (getServer() !== session.server) return false;
			await task();
			return !partial.current;
		} catch (cause) {
			return fail(documentError(cause));
		} finally {
			try {
				await refresh();
			} finally {
				active.current = false;
				setBusy(false);
				finish();
			}
		}
	};
	const batch = async (
		documents: readonly DocumentSummary[],
		task: (document: DocumentSummary) => Promise<unknown>,
		{ applies = () => true, alreadyDone = () => false, notify = true }: BatchOptions = {},
	) => {
		const done: DocumentSummary[] = [];
		const unchanged = documents.filter(alreadyDone).length;
		// Sequential calls avoid overwhelming per-account mutation limits.
		for (const document of documents) {
			if (alreadyDone(document) || !applies(document)) continue;
			if (getServer() !== session.server) break;
			try {
				await task(document);
				done.push(document);
			} catch {
				/* Remaining documents can still succeed. */
			}
		}
		const completed = done.length + unchanged;
		const message =
			completed === documents.length
				? plural(completed, { one: "# document updated", other: "# documents updated" })
				: t`Updated ${completed} of ${documents.length}. Locked documents, and letters for public links, were skipped. Refresh and retry any failures.`;
		if (completed !== documents.length) {
			partial.current = true;
			setError(message);
		}
		if (notify) showToast({ message });
		return done;
	};
	const trash = async (documents: readonly DocumentSummary[]) => {
		let done: DocumentSummary[] = [];
		let attempted = false;
		const success = await run(async () => {
			attempted = true;
			done = await batch(documents, (document) => client.documents.trash(documentRef(document)), {
				applies: (document) => !document.isLocked,
				notify: false,
			});
		});
		if (attempted)
			showToast({
				message:
					done.length === documents.length
						? plural(done.length, { one: "# document moved to Trash", other: "# documents moved to Trash" })
						: t`Moved ${done.length} of ${documents.length} to Trash. Locked documents were skipped. Refresh and retry any failures.`,
				action: done.length
					? {
							label: t`Undo`,
							onPress: () => {
								void idle.current.then(() =>
									run(() => batch(done, (document) => client.documents.restore(documentRef(document)))),
								);
							},
						}
					: undefined,
			});
		return success;
	};
	/** Restores the selected loaded documents; the server skips any that changed meanwhile. */
	const restoreSelected = async (documents: readonly DocumentSummary[]) => {
		let restored = 0;
		let attempted = false;
		const success = await run(async () => {
			attempted = true;
			for (const group of chunks(documents)) {
				if (getServer() !== session.server) break;
				try {
					const result = await client.documents.restoreMany({ documents: group.map(documentRef) });
					restored += result.restored;
				} catch {
					/* The remaining groups can still succeed. */
				}
			}
			if (restored !== documents.length) {
				partial.current = true;
				setError(t`Restored ${restored} of ${documents.length}. Refresh and retry any that remain in Trash.`);
			}
		});
		if (attempted && restored > 0)
			showToast({
				message:
					restored === documents.length
						? plural(restored, { one: "# document restored", other: "# documents restored" })
						: t`Restored ${restored} of ${documents.length}. Refresh and retry any that remain in Trash.`,
			});
		return success;
	};
	/** Permanently deletes the selected loaded documents; Empty Trash is a separate server-side operation. */
	const purgeSelected = async (documents: readonly DocumentSummary[]) => {
		let deleted = 0;
		let attempted = false;
		const success = await run(async () => {
			attempted = true;
			for (const group of chunks(documents)) {
				if (getServer() !== session.server) break;
				try {
					const result = await client.documents.purgeMany({ documents: group.map(documentRef) });
					deleted += result.deleted;
				} catch {
					/* The remaining groups can still succeed. */
				}
			}
			if (deleted !== documents.length) {
				partial.current = true;
				setError(t`Deleted ${deleted} of ${documents.length}. Refresh to see what remains.`);
			}
		});
		if (attempted && deleted > 0)
			showToast({
				message:
					deleted === documents.length
						? plural(deleted, { one: "# document deleted forever", other: "# documents deleted forever" })
						: t`Deleted ${deleted} of ${documents.length} forever. Refresh to see what remains.`,
			});
		return success;
	};
	/** Deletes every document in this account's Trash, not only the IDs this device has loaded. */
	const emptyTrash = async () => {
		let deleted = 0;
		const success = await run(async () => {
			deleted = (await client.documents.emptyTrash({})).deleted;
		});
		if (success)
			showToast({
				message:
					deleted === 0
						? t`Trash was already empty`
						: plural(deleted, { one: "# document deleted forever", other: "# documents deleted forever" }),
			});
		return success;
	};
	return {
		run,
		batch,
		trash,
		restoreSelected,
		purgeSelected,
		emptyTrash,
		busy,
		error,
	};
}
