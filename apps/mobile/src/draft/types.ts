import type { RouterOutput } from "@/api/client";
import type { Proposal, ProposalApplications } from "@reactive-resume/resume/proposals";
// The draft store contract (M3-T3 implements it), for resumes and cover letters. It ports
// apps/web/src/features/resume/builder/draft.ts: a debounced save (500 ms resumes, 800 ms letters), undo/redo,
// kv-store persistence with an offline queue, and a conflict check on reconnect.
import type { WritableDraft } from "immer";

export type ResumeDocument = RouterOutput["resume"]["getById"];
export type LetterDocument = RouterOutput["coverLetters"]["getById"];

/**
 * - `offline`: no connection; changes are kept on this device and sent when it reconnects.
 * - `error`: the server rejected the save or couldn't be reached while online; changes are kept and Retry is offered.
 */
export type SaveStatus = "idle" | "saving" | "saved" | "offline" | "error";

/**
 * The server copy changed since this draft was loaded (409 `RESUME_VERSION_CONFLICT`, or a stale letter revision).
 * - `keep-mine` re-sends the draft without the version check.
 * - `use-theirs` drops the draft and loads the server copy.
 * - `keep-both` saves the draft as a new document and loads the server copy here.
 */
export type ConflictChoice = "keep-mine" | "use-theirs" | "keep-both";

export type DraftConflict<TDocument> = {
	/** The server copy at the time of the conflict. */
	remote: TDocument;
	/** An older app's draft cannot overwrite this document, even with Keep mine. */
	reason?: "CURRENT_CLIENT_REQUIRED";
};

export type UpdateOptions = {
	/** Filled by the synchronous proposal recipe; travels with this undo step. */
	applied?: readonly Pick<Proposal, "id" | "after" | "snapshot">[];
	/** The field being edited. Consecutive edits with the same key within 1 s merge into one undo step. */
	coalesceKey?: string | undefined;
	/** Always a step of its own (adding, moving or deleting). */
	newStep?: boolean | undefined;
	/** Merges into the current step when the previous edit had the same key, however long ago. */
	sameStep?: boolean | undefined;
};

export type DraftState<TDocument, TData> = {
	/** The document with the draft's data; null until loaded. */
	document: TDocument | null;
	data: TData | null;
	status: SaveStatus;
	/** Locked documents are read-only: `update` does nothing. */
	locked: boolean;
	conflict: DraftConflict<TDocument> | null;
	proposalApplications: ProposalApplications;
	/** External baseline for cached proposal marks; ordinary local saves keep them valid. */
	proposalRevision: string | number | null;
	canUndo: boolean;
	canRedo: boolean;
};

export type DraftActions<TDocument, TData> = {
	/** Loads the document (from the kv-store draft first, then the server) and starts syncing. */
	open: (id: string) => Promise<void>;
	/** Flushes pending changes and stops syncing. */
	close: () => Promise<void>;
	update: (recipe: (draft: WritableDraft<TData>) => void, options?: UpdateOptions) => void;
	/** Name, tags, visibility and other fields next to the data. Not part of undo. */
	updateDocument: (recipe: (draft: WritableDraft<TDocument>) => void) => void;
	undo: () => void;
	redo: () => void;
	/** Sends the latest unsaved changes again ("Not saved · Retry"). */
	retry: () => void;
	resolveConflict: (choice: ConflictChoice) => Promise<void>;
	/** Saves now instead of after the debounce: on blur, when the app goes to the background, when leaving. */
	flush: () => Promise<void>;
};

export type DraftStore<TDocument, TData> = DraftState<TDocument, TData> & DraftActions<TDocument, TData>;

export type ResumeDraftStore = DraftStore<ResumeDocument, ResumeDocument["data"]>;
/** A letter's editable fields (recipient, content, style…) sit on the document itself, so its data is the document. */
export type LetterDraftStore = DraftStore<LetterDocument, LetterDocument>;

/** Navigation metadata only; authored content remains owned by its draft store. */
export type PendingDocument = { type: "resume" | "letter"; id: string; name: string };
