import type { DraftAdapter } from "./store";
import type { PendingDocument } from "./types";
import { letterAdapter, resumeAdapter } from "./adapters";
import { nativeEnvironment, watchDraft } from "./native";
import { createDraftStore } from "./store";
import { streamClient } from "@/api/client";
import { getSession } from "@/auth/session";
import { isFake } from "@/data/fixtures";

function createNativeDraft<D extends { id: string; isLocked: boolean }, T>(adapter: DraftAdapter<D, T>) {
	const draft = createDraftStore(adapter, nativeEnvironment);
	const { open, close, flush } = draft.store.getState();
	let stop: (() => void) | undefined;
	let stream: AbortController | undefined;
	let reconnect: ReturnType<typeof setTimeout> | undefined;
	let visit = 0;

	function stopStream() {
		visit++;
		stream?.abort();
		clearTimeout(reconnect);
	}

	async function subscribe(id: string, current: number) {
		if (current !== visit) return;
		stream = new AbortController();
		const signal = stream.signal;
		try {
			const events = await streamClient.resume.updates.subscribe({ id }, { signal });
			for await (const _event of events) {
				if (signal.aborted || current !== visit) return;
				await draft.refresh();
			}
		} catch {
			/* No payloads in logs; SSE retries when the connection returns. */
		}
		if (!signal.aborted && current === visit) reconnect = setTimeout(() => void subscribe(id, current), 2500);
	}

	draft.store.setState({
		open: async (id) => {
			stopStream();
			const current = visit;
			await open(id);
			if (current !== visit) return;
			stop ??= watchDraft({ ...draft, flush });
			void draft.replay().catch(() => {});
			if (adapter.kind === "resume" && !isFake() && getSession().status !== "guest") void subscribe(id, current);
		},
		close: async () => {
			stopStream();
			await close();
		},
	});
	return {
		...draft,
		clearDraftsFor: (owner: string) => {
			try {
				draft.clearDraftsFor(owner);
			} finally {
				if (!draft.store.getState().document) {
					stopStream();
					stop?.();
					stop = undefined;
				}
			}
		},
		suspend: () => {
			stopStream();
			stop?.();
			stop = undefined;
			draft.suspend();
		},
	};
}

export const resume = createNativeDraft(resumeAdapter);
export const letter = createNativeDraft(letterAdapter);

export const useResumeStore = resume.store;
export const useLetterStore = letter.store;

/** Call before discarding a signed-out account's tokens; never clear another account's local work. */
export function clearDraftsFor(scope: string) {
	try {
		resume.clearDraftsFor(scope);
	} finally {
		letter.clearDraftsFor(scope);
	}
}

export const getDraftScope = nativeEnvironment.scope;

/** Current account's recoverable drafts; never fetches a server document or refreshes credentials. */
export async function listPendingDrafts(): Promise<PendingDocument[]> {
	const scope = await getDraftScope();
	if (!scope) return [];
	const [resumes, letters] = await Promise.all([resume.listPending(), letter.listPending()]);
	if ((await getDraftScope()) !== scope) return [];
	return [
		...resumes.map(({ id, name }) => ({ type: "resume" as const, id, name })),
		...letters.map(({ id, name }) => ({ type: "letter" as const, id, name })),
	];
}

export function subscribePendingDrafts(listener: () => void) {
	const stopResume = resume.subscribePending(listener);
	const stopLetter = letter.subscribePending(listener);
	return () => {
		stopResume();
		stopLetter();
	};
}
