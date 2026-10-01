import type { CoverLetter } from "@reactive-resume/schema/cover-letter/data";
import { t } from "@lingui/core/macro";
import { ORPCError } from "@orpc/client";
import { create } from "zustand/react";
import { generateId } from "@reactive-resume/utils/string";
import { client, streamClient } from "@/libs/orpc/client";

type LetterMetadata = CoverLetter["style"]["metadata"];

/**
 * What's typed in the letter editor: saved once typing pauses. `metadata` is the letter's own type, colors and page;
 * setting it ends the design link.
 */
export type LetterEdits = Partial<
	Pick<CoverLetter, "name" | "recipient" | "content" | "recipientName" | "recipientCompany" | "letterDate">
> & { metadata?: Partial<Pick<LetterMetadata, "typography" | "design" | "page">> };

const mergeEdits = (edits: LetterEdits, next: LetterEdits): LetterEdits =>
	edits.metadata && next.metadata
		? { ...edits, ...next, metadata: { ...edits.metadata, ...next.metadata } }
		: { ...edits, ...next };

const applyEdits = (letter: CoverLetter, { metadata, ...fields }: LetterEdits): CoverLetter =>
	metadata
		? {
				...letter,
				...fields,
				designLinked: false,
				style: { ...letter.style, metadata: { ...letter.style.metadata, ...metadata } },
			}
		: { ...letter, ...fields };

/** `conflict`: the letter changed somewhere else, so saving stops until it's reloaded. */
type LetterSaveStatus = "saved" | "saving" | "error" | "conflict";

/**
 * A draft from the posting, kept apart from the letter: streaming, ready to keep, or failed. The body changes only
 * when a draft is kept, so a failed or discarded draft leaves the letter as it was.
 */
export type LetterDraft =
	| { phase: "idle" }
	| { phase: "streaming" | "ready"; text: string }
	| { phase: "failed"; provider: string | null; error: unknown };

const SAVE_DELAY_MS = 800;

type LetterEditorStore = {
	letter: CoverLetter | null;
	status: LetterSaveStatus;
	/** Edits not sent yet; they stay on top of whatever the server returns. */
	pending: LetterEdits;
	/** One editing visit: its saves share one History version. */
	sessionId: string;
	draft: LetterDraft;
	load: (letter: CoverLetter) => void;
	edit: (edits: LetterEdits) => void;
	/** Saves everything typed so far. False on failure; edits remain for retry. */
	flush: () => Promise<boolean>;
	/**
	 * Saves what's pending, then makes a change that returns the letter (a link, a template, a restore). Throws what
	 * the change throws, so the caller can say what went wrong.
	 */
	change: (action: (letter: CoverLetter) => Promise<CoverLetter>) => Promise<CoverLetter>;
	reset: () => void;
};

const idleDraft: LetterDraft = { phase: "idle" };

let timer: ReturnType<typeof setTimeout> | undefined;
let inflight: Promise<void> | null = null;
let drafting: AbortController | null = null;

const hasEdits = (edits: LetterEdits) => Object.keys(edits).length > 0;

export const useLetterEditorStore = create<LetterEditorStore>()((set, get) => ({
	letter: null,
	status: "saved",
	pending: {},
	sessionId: generateId(),
	draft: idleDraft,

	load: (letter) => {
		clearTimeout(timer);
		drafting?.abort();
		drafting = null;
		set({ letter, status: "saved", pending: {}, sessionId: generateId(), draft: idleDraft });
	},

	edit: (edits) => {
		set((state) =>
			state.letter
				? {
						letter: applyEdits(state.letter, edits),
						pending: mergeEdits(state.pending, edits),
						status: state.status === "conflict" ? "conflict" : "saving",
					}
				: state,
		);
		clearTimeout(timer);
		timer = setTimeout(() => void get().flush(), SAVE_DELAY_MS);
	},

	flush: async () => {
		const { sessionId } = get();
		clearTimeout(timer);
		if (inflight) await inflight;
		if (get().sessionId !== sessionId) return false;

		const { letter, pending, status } = get();
		if (!letter || !hasEdits(pending) || status === "conflict") return status === "saved";
		const current = (state: LetterEditorStore) => state.letter?.id === letter.id && state.sessionId === sessionId;

		set({ pending: {}, status: "saving" });
		inflight = (async () => {
			try {
				const saved = await client.coverLetters.update({
					id: letter.id,
					expectedRevision: letter.revision,
					sessionId,
					...pending,
				});
				// What was typed stays as typed (the server trims and cleans what it stores), and so does anything typed
				// since.
				set((state) =>
					current(state)
						? {
								letter: applyEdits(saved, mergeEdits(pending, state.pending)),
								status: hasEdits(state.pending) ? "saving" : "saved",
							}
						: state,
				);
			} catch (error) {
				const conflict = error instanceof ORPCError && error.code === "CONFLICT";
				set((state) =>
					current(state)
						? { pending: mergeEdits(pending, state.pending), status: conflict ? "conflict" : "error" }
						: state,
				);
			} finally {
				inflight = null;
			}
		})();
		await inflight;

		// Typed while that save was on its way.
		if (!current(get())) return false;
		if (get().status === "saving" && hasEdits(get().pending)) return get().flush();
		return get().status === "saved";
	},

	change: async (action) => {
		const { sessionId } = get();
		if (!(await get().flush())) throw new Error(t`Couldn't save your changes. Try again before continuing.`);
		const { letter } = get();
		if (!letter || get().sessionId !== sessionId) throw new Error("No letter is open.");
		const next = await action(letter);
		set((state) =>
			state.letter?.id === letter.id && state.sessionId === sessionId
				? { letter: applyEdits(next, state.pending) }
				: state,
		);
		return next;
	},

	reset: () => {
		clearTimeout(timer);
		drafting?.abort();
		drafting = null;
		set({ letter: null, status: "saved", pending: {}, sessionId: generateId(), draft: idleDraft });
	},
}));

/** Streams a draft from the posting (or a Shorter / More personal revision of `previous`) into `draft`. */
export async function startLetterDraft(variant: "draft" | "shorter" | "personal" = "draft", previous?: string) {
	const letter = useLetterEditorStore.getState().letter;
	if (!letter) return;
	drafting?.abort();
	const controller = new AbortController();
	drafting = controller;
	const setDraft = (draft: LetterDraft) => {
		if (drafting === controller) useLetterEditorStore.setState({ draft });
	};
	setDraft({ phase: "streaming", text: "" });

	try {
		const stream = await streamClient.coverLetters.draft(
			{ id: letter.id, variant, ...(previous ? { previous } : {}) },
			{ signal: controller.signal },
		);
		let text = "";
		for await (const chunk of stream) {
			text += chunk;
			setDraft({ phase: "streaming", text });
		}
		if (!text.trim()) throw new Error("The draft came back empty.");
		setDraft({ phase: "ready", text: text.trim() });
	} catch (error) {
		if (controller.signal.aborted) return;
		const data = error instanceof ORPCError ? (error.data as { provider?: unknown } | undefined) : undefined;
		setDraft({ phase: "failed", provider: typeof data?.provider === "string" ? data.provider : null, error });
	}
}

export function discardLetterDraft() {
	drafting?.abort();
	drafting = null;
	useLetterEditorStore.setState({ draft: idleDraft });
}
