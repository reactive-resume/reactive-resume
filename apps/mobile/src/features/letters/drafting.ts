// AI draft of the letter body, streamed over SSE. Ported from startLetterDraft in apps/web/src/features/letters/store.ts.
import { ORPCError } from "@orpc/client";
import Storage from "expo-sqlite/kv-store";
import { create } from "zustand";
import { draftForOwner, letterDraftOwnerKey } from "./draft-owner";
import { saveLetter } from "./save";
import { streamClient } from "@/api/client";
import { getAccountScope, getServer } from "@/auth/session";
import { useLetterStore } from "@/draft";

export type DraftVariant = "draft" | "shorter" | "personal";

/**
 * A draft kept apart from the letter: streaming, ready to keep, or failed. The body changes only when a draft is
 * kept, so a failed or discarded draft leaves the letter as it was. `last` is what Try again repeats.
 */
export type LetterDraft =
	| { phase: "idle" }
	| { phase: "streaming" | "ready"; text: string; revision: number; operation: string }
	| { phase: "failed"; provider: string | null; error: unknown }
	/** What's typed couldn't be saved (offline, error, conflict), so the server would draft from stale links. */
	| { phase: "unsaved" };

type LastDraft = { variant: DraftVariant; previous?: string | undefined };
type DraftingState = {
	/** The account, server and letter that own this draft. A different letter/account sees idle, never this text. */
	owner: string | null;
	draft: LetterDraft;
	last: LastDraft;
};

const idle: LetterDraft = { phase: "idle" };
const defaultLast: LastDraft = { variant: "draft" };

/** Storage and in-memory identity are scoped by server, account and letter so drafts cannot cross either boundary. */
export const letterDraftOwner = (id: string) => letterDraftOwnerKey(getServer(), getAccountScope(), id);

/** The draft a screen may render: only when the store belongs to this exact server/account/letter. */
export { draftForOwner };

export const useLetterDrafting = create<DraftingState>()(() => ({ owner: null, draft: idle, last: defaultLast }));

/** The visible draft for one letter; another letter's ready/streaming draft is never returned. */
export function useLetterDraftFor(id: string) {
	const owner = letterDraftOwner(id);
	return useLetterDrafting((state) => draftForOwner(state, owner, idle));
}

/** What Try again repeats, scoped to the same letter as the visible draft. */
export function useLetterDraftLastFor(id: string) {
	const owner = letterDraftOwner(id);
	return useLetterDrafting((state) => (state.owner === owner ? state.last : defaultLast));
}

let drafting: AbortController | null = null;
/** Invalidates an in-flight restore when the letter changes, is discarded, or a new draft starts. */
let restoreVersion = 0;
let operationSequence = 0;
const nextOperation = () => `draft-${++operationSequence}`;

/** An unkept draft survives leaving and reopening the editor, so seeing it again costs no second request. */
export async function restoreLetterDraft(id: string) {
	const current = useLetterStore.getState().document;
	if (!current || current.id !== id) return;
	const owner = letterDraftOwner(id);
	const revision = current.revision;
	const state = useLetterDrafting.getState();
	if (state.owner !== owner || (state.draft.phase === "ready" && state.draft.revision !== revision))
		useLetterDrafting.setState({ owner, draft: idle, last: defaultLast });
	if (useLetterDrafting.getState().draft.phase !== "idle") return;
	const request = ++restoreVersion;
	try {
		const raw = await Storage.getItem(owner);
		const value = raw ? (JSON.parse(raw) as { text?: unknown; variant?: unknown; revision?: unknown }) : null;
		if (typeof value?.text !== "string" || !value.text.trim()) return;
		// A newer restore/discard/leave, another letter, or a changed revision invalidates this read.
		const latest = useLetterStore.getState().document;
		if (
			request !== restoreVersion ||
			letterDraftOwner(id) !== owner ||
			latest?.id !== id ||
			latest.revision !== revision ||
			useLetterDrafting.getState().owner !== owner ||
			value.revision !== revision
		)
			return;
		const variant =
			value.variant === "shorter" || value.variant === "personal" || value.variant === "draft"
				? value.variant
				: "draft";
		useLetterDrafting.setState((currentState) =>
			currentState.owner === owner
				? {
						draft: { phase: "ready", text: value.text as string, revision, operation: nextOperation() },
						last: { variant },
					}
				: currentState,
		);
	} catch {
		// Unreadable storage leaves the letter as it was; drafting can still start fresh.
	}
}

async function storeDraft(owner: string, text: string, variant: DraftVariant, revision: number) {
	try {
		await Storage.setItem(owner, JSON.stringify({ text, variant, revision }));
	} catch {
		// Storage full or unavailable: the draft stays in this view.
	}
}

async function clearDraft(owner: string) {
	try {
		await Storage.removeItem(owner);
	} catch {
		// Nothing to clear.
	}
}

/** Streams a draft (or a Shorter / More personal revision of `previous`) into `useLetterDrafting`. */
export async function startLetterDraft(variant: DraftVariant = "draft", previous?: string) {
	const letter = useLetterStore.getState().document;
	if (!letter) return;
	const owner = letterDraftOwner(letter.id);
	const operation = nextOperation();
	const started = ++restoreVersion;
	drafting?.abort();
	const controller = new AbortController();
	drafting = controller;
	let revision = letter.revision;
	const set = (draft: LetterDraft) => {
		if (drafting !== controller || letterDraftOwner(letter.id) !== owner) return;
		useLetterDrafting.setState((state) => (state.owner === owner ? { draft } : state));
	};
	useLetterDrafting.setState({ owner, last: { variant, previous } });
	void clearDraft(owner);
	set({ phase: "streaming", text: "", revision, operation });

	try {
		// The server drafts from the saved letter's links, so links chosen a moment ago must reach it first.
		const saved = await saveLetter(letter.id);
		if (controller.signal.aborted) return;
		const savedLetter = useLetterStore.getState().document;
		if (
			!savedLetter ||
			savedLetter.id !== letter.id ||
			started !== restoreVersion ||
			letterDraftOwner(letter.id) !== owner
		)
			return set(idle);
		if (!saved) return set({ phase: "unsaved" });
		revision = savedLetter.revision;
		const stream = await streamClient.coverLetters.draft(
			{ id: letter.id, variant, ...(previous ? { previous } : {}) },
			{ signal: controller.signal },
		);
		let text = "";
		for await (const chunk of stream) {
			text += chunk;
			set({ phase: "streaming", text, revision, operation });
		}
		if (!text.trim()) throw new Error("The draft came back empty.");
		set({ phase: "ready", text: text.trim(), revision, operation });
		// A late completion after leave/account/letter change may not persist into the new owner's namespace.
		if (
			drafting === controller &&
			letterDraftOwner(letter.id) === owner &&
			started === restoreVersion &&
			useLetterDrafting.getState().owner === owner &&
			useLetterStore.getState().document?.id === letter.id
		)
			void storeDraft(owner, text.trim(), variant, revision);
	} catch (error) {
		if (controller.signal.aborted) return;
		const data = error instanceof ORPCError ? (error.data as { provider?: unknown } | undefined) : undefined;
		set({ phase: "failed", provider: typeof data?.provider === "string" ? data.provider : null, error });
	}
}

/**
 * Leaving the editor stops a stream and clears the phantom streaming/unsaved card; a ready, unkept draft stays for
 * this letter's next visit. Another letter/account never inherits either state.
 */
export function stopLetterDraft() {
	restoreVersion++;
	drafting?.abort();
	drafting = null;
	useLetterDrafting.setState((state) =>
		state.draft.phase === "streaming" || state.draft.phase === "unsaved" ? { ...state, draft: idle } : state,
	);
}

/** Stop, Discard and Dismiss: the letter stays as it was. Clears only the draft owned by the open letter. */
export function discardLetterDraft() {
	const id = useLetterStore.getState().document?.id;
	restoreVersion++;
	drafting?.abort();
	drafting = null;
	if (id) {
		const owner = letterDraftOwner(id);
		void clearDraft(owner);
		useLetterDrafting.setState((state) => (state.owner === owner ? { ...state, draft: idle } : state));
	}
}
