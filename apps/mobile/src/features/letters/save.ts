// Saving the letter before server work, and finishing that work only in the editor visit that started it.
import type { LetterDocument } from "@/draft/types";
import type { WritableDraft } from "immer";
import { client } from "@/api/client";
import { getDraftScope, useLetterStore } from "@/draft";

let visit = 0;

/** The letter layout calls this when an editor visit starts and when it ends. */
export function nextLetterVisit() {
	visit++;
	for (const stop of rebasing.values()) stop();
}

type Visit = { visit: number; id: string; scope: string | null };

/** Reads the visit before any await, so a visit that ends while the scope loads still counts as ended. */
async function startVisit(id: string): Promise<Visit> {
	const current = visit;
	return { visit: current, id, scope: await getDraftScope() };
}

/** Same editor visit, same letter, same account: only then may a late result touch the open draft. */
async function isCurrent(started: Visit) {
	if (visit !== started.visit || useLetterStore.getState().document?.id !== started.id) return false;
	return (await getDraftScope()) === started.scope && visit === started.visit;
}

/**
 * Saves what's typed. True only when the server has it: `flush` also resolves after a failed, offline or
 * conflicting save, and the letter may have changed meanwhile.
 */
export async function saveLetter(id: string) {
	if (useLetterStore.getState().document?.id !== id) return false;
	await useLetterStore.getState().flush();
	const state = useLetterStore.getState();
	return state.document?.id === id && !state.conflict && (state.status === "saved" || state.status === "idle");
}

/** Letters whose link change is waiting for a confirmed save, each with its stop function. */
const rebasing = new Map<string, () => void>();

/** A fresh copy of the style is what makes the store rebase it into every undo/redo step. */
function rebaseHistory() {
	const { document, canUndo, canRedo } = useLetterStore.getState();
	// ponytail: costs one empty save, so only when there is history to rebase.
	if (!document || !(canUndo || canRedo)) return;
	const style = structuredClone(document.style);
	useLetterStore.getState().updateDocument((letter) => void (letter.style = style));
}

/**
 * Rebases the server-resolved style into history on the first confirmed save after a link change: at once, or after
 * Retry or an offline replay. Ends when another letter opens, the editor closes, or the visit ends.
 */
function rebaseWhenSaved(id: string) {
	rebasing.get(id)?.();
	let confirmed = false;
	const unsubscribe = useLetterStore.subscribe((state) => {
		if (state.document?.id !== id) return stop();
		if (state.conflict || state.status !== "saved") return;
		confirmed = true;
		stop();
		// After the store has finished publishing this save.
		void Promise.resolve().then(() => {
			if (useLetterStore.getState().document?.id === id) rebaseHistory();
		});
	});
	const stop = () => {
		unsubscribe();
		if (rebasing.get(id) === stop) rebasing.delete(id);
	};
	rebasing.set(id, stop);
	// The rebase queues another save at once, so the caller can't read "saved" from the store afterwards.
	return () => confirmed;
}

export type RelinkResult = "linked" | "queued" | "unsaved";

/**
 * Links (application, resume, live sender details, matching design) change on the server, which then resolves the
 * sender and design from the resume. They stay out of undo, like web's server-side changes.
 *
 * - Pending edits are saved first, on their own: a design edit sent together with `designLinked: true` makes the
 *   server end the link again. If they can't be saved, nothing changes (`unsaved`).
 * - The link change then goes alone. Once a save confirms it (now, or after Retry or reconnect: `queued`), the
 *   resolved style goes into every undo/redo step, so undoing typing never brings back the old copies.
 */
export async function relinkLetter(recipe: (letter: WritableDraft<LetterDocument>) => void): Promise<RelinkResult> {
	const id = useLetterStore.getState().document?.id;
	if (!id) return "unsaved";
	const started = await startVisit(id);
	if (!(await saveLetter(id)) || !(await isCurrent(started))) return "unsaved";
	useLetterStore.getState().updateDocument(recipe);
	// Armed after the change: queueing it has already left "saved", so only a later save can confirm it.
	const confirmed = rebaseWhenSaved(id);
	return (await saveLetter(id)) || confirmed() ? "linked" : "queued";
}

/**
 * Restores a version. The server saves "Before restore" first; reopening resets the draft's baseline and undo.
 * False when the user has since left, switched letters or accounts: their open draft is never replaced.
 */
export async function restoreLetterVersion(id: string, versionId: string, unsaved: () => Error) {
	const started = await startVisit(id);
	if (!(await saveLetter(id))) throw unsaved();
	await client.coverLetters.restoreVersion({ id, versionId, proposalSafety: "v1" });
	if (!(await isCurrent(started))) return false;
	await useLetterStore.getState().open(id);
	return true;
}
