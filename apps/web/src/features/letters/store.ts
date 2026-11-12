import type { Proposal, ProposalApplications } from "@reactive-resume/resume/proposals";
import type { CoverLetterDraftVersion, CoverLetter } from "@reactive-resume/schema/cover-letter/data";
import { t } from "@lingui/core/macro";
import { ORPCError } from "@orpc/client";
import { isEqual } from "es-toolkit";
import { create } from "zustand/react";
import {
	acknowledgeProposalApplications,
	appliedApplications,
	queueProposalApplications,
	readProposalApplications,
	restoreProposalApplications,
	proposalAiOperationIds,
} from "@reactive-resume/resume/proposals";
import {
	coverLetterDocumentSchema,
	coverLetterDraftVersionSchema,
	coverLetterSchema,
} from "@reactive-resume/schema/cover-letter/data";
import { generateId } from "@reactive-resume/utils/string";
import { getAccountGeneration, getAccountId } from "@/libs/auth/account-scope";
import { client, streamClient } from "@/libs/orpc/client";

type LetterMetadata = CoverLetter["style"]["metadata"];

/**
 * What's typed in the letter editor: saved once typing pauses. `metadata` is the letter's own type, colors and page;
 * setting it ends the design link.
 */
export type LetterEdits = Partial<
	Pick<
		CoverLetter,
		| "name"
		| "recipient"
		| "content"
		| "greeting"
		| "signOff"
		| "recipientName"
		| "recipientCompany"
		| "letterDate"
		| "aiOperationIds"
	>
> & {
	/** The letter's own sender details, all of them editable once the sender link is off. */
	sender?: Partial<CoverLetter["style"]["basics"] & { picture: Pick<CoverLetter["style"]["picture"], "hidden"> }>;
	/** The letter language stays independent from its linked design. */
	locale?: string;
	metadata?: Partial<Pick<LetterMetadata, "typography" | "design" | "page">>;
};

const mergeEdits = (edits: LetterEdits, next: LetterEdits): LetterEdits => ({
	...edits,
	...next,
	...(edits.metadata && next.metadata ? { metadata: { ...edits.metadata, ...next.metadata } } : {}),
	...(edits.sender && next.sender ? { sender: { ...edits.sender, ...next.sender } } : {}),
});

const applyEdits = (letter: CoverLetter, { metadata, sender, locale, ...fields }: LetterEdits): CoverLetter => ({
	...letter,
	...fields,
	...(fields.aiOperationIds && !isEqual(fields.aiOperationIds, letter.aiOperationIds ?? []) ? { aiUsage: null } : {}),
	...(metadata ? { designLinked: false } : {}),
	style: {
		...letter.style,
		...(metadata ? { metadata: { ...letter.style.metadata, ...metadata } } : {}),
		...(locale
			? {
					metadata: {
						...letter.style.metadata,
						...metadata,
						page: { ...(metadata?.page ?? letter.style.metadata.page), locale },
					},
				}
			: {}),
		...(sender ? senderStyle(letter.style, sender) : {}),
	},
});

function senderStyle(style: CoverLetter["style"], { picture, ...basics }: NonNullable<LetterEdits["sender"]>) {
	return {
		basics: { ...style.basics, ...basics },
		picture: picture ? { ...style.picture, ...picture } : style.picture,
	};
}

/** `conflict`: the letter changed somewhere else, so saving stops until it's reloaded. */
type LetterSaveStatus = "saved" | "saving" | "error" | "conflict";

/**
 * A draft from the posting, kept apart from the letter: streaming, ready to keep, or failed. The body changes only
 * when a draft is kept, so a failed or discarded draft leaves the letter as it was.
 */
export type LetterDraft =
	| { phase: "idle" }
	/**
	 * `versions` are the earlier finished drafts, oldest first, so Shorter or More personal never loses one.
	 * `stopped` marks text Stop cut short.
	 */
	| {
			phase: "streaming" | "ready";
			text: string;
			aiOperationIds: string[];
			versions: CoverLetterDraftVersion[];
			stopped?: true;
	  }
	| { phase: "failed"; provider: string | null; error: unknown; versions: CoverLetterDraftVersion[] };

/** The most drafts kept side by side: the current one and up to four before it. */
const MAX_DRAFT_VERSIONS = 5;

const SAVE_DELAY_MS = 800;

type LetterEditorStore = {
	proposalApplications: ProposalApplications;
	pendingProposalApplications: ProposalApplications;
	/**
	 * Set while the edits are this app's own: it applies assistant edits only through checked decisions. Edits restored
	 * from an older app's recovery lack it and are sent without proposalSafety until the server takes them or the letter
	 * is reloaded, so updating the app never vouches for what the older one queued.
	 */
	proposalSafety?: "v1" | undefined;
	letter: CoverLetter | null;
	/** The server's name, kept apart from optimistic edits for the browser title. */
	savedName: string | null;
	status: LetterSaveStatus;
	/** Sender editing pauses while a link, restore, template change or recovery replaces server state. */
	changing: boolean;
	/** Edits not sent yet; they stay on top of whatever the server returns. */
	pending: LetterEdits;
	/** One editing visit: its saves share one History version. */
	sessionId: string;
	draft: LetterDraft;
	load: (letter: CoverLetter, options?: { recover?: boolean }) => void;
	edit: (
		edits: LetterEdits,
		options?: {
			applied?: readonly Pick<Proposal, "id" | "after" | "snapshot" | "aiOperationIds">[];
			restoreApplications?: ProposalApplications;
			/** Undo or Redo itself: the stacks are theirs to change. */
			history?: boolean;
		},
	) => void;
	/** Saves everything typed so far. False on failure; edits remain for retry. */
	flush: () => Promise<boolean>;
	/**
	 * Saves what's pending, then makes a change that returns the letter (a link, a template, a restore). Throws what
	 * the change throws, so the caller can say what went wrong.
	 */
	change: (action: (letter: CoverLetter) => Promise<CoverLetter>) => Promise<CoverLetter>;
	/** Keeps conflicting edits as a standalone letter before replacing this visit with the saved version. */
	reloadFromServer: () => Promise<CoverLetter | null>;
	reset: () => void;
	/** P8: what Undo and Redo put back, newest last. Text fields only (see `UNDOABLE`). */
	undoStack: LetterEdits[];
	redoStack: LetterEdits[];
	undo: () => void;
	redo: () => void;
};

// ponytail: Undo covers the letter's own text; sender, language and design changes are not stepped back.
const UNDOABLE = [
	"name",
	"recipient",
	"content",
	"greeting",
	"signOff",
	"recipientName",
	"recipientCompany",
	"letterDate",
	"aiOperationIds",
] as const;
const UNDO_LIMIT = 100;
/** Typing in one field within this pause is one step. */
const UNDO_GROUP_MS = 1000;
let lastUndoAt = 0;
let lastUndoKeys = "";

/** The values `edits` replace, so applying the result undoes them. Undefined when nothing undoable changes. */
export function inverseEdits(letter: CoverLetter, edits: LetterEdits): LetterEdits | undefined {
	const inverse: Record<string, unknown> = {};
	for (const key of UNDOABLE) if (key in edits && edits[key] !== letter[key]) inverse[key] = letter[key];
	return Object.keys(inverse).length > 0 ? (inverse as LetterEdits) : undefined;
}

const idleDraft: LetterDraft = { phase: "idle" };

const draftKey = (id: string) => `letter-draft:${getAccountId() ?? "signed-out"}:${id}`;
type StoredDraft = {
	text: string;
	versions?: CoverLetterDraftVersion[];
	aiOperationIds?: string[];
	variant: "draft" | "shorter" | "personal";
	revision: number;
	stopped?: true;
};

/** An unkept draft survives a same-tab reload with Keep/Discard, so it never costs a second paid request. */
function readStoredDraft(id: string, revision: number): LetterDraft | null {
	try {
		const value = JSON.parse(sessionStorage.getItem(draftKey(id)) ?? "null") as
			| (Omit<StoredDraft, "versions"> & { versions?: unknown[]; versionAiOperationIds?: unknown[] })
			| null;
		if (!value || typeof value.text !== "string" || !value.text.trim() || value.revision !== revision) return null;
		const versions = Array.isArray(value.versions)
			? value.versions
					.flatMap((version, index) => {
						const parsed = coverLetterDraftVersionSchema.safeParse(
							typeof version === "string"
								? { text: version, aiOperationIds: value.versionAiOperationIds?.[index] }
								: version,
						);
						return parsed.success ? [parsed.data] : [];
					})
					.slice(-4)
			: [];
		return {
			phase: "ready",
			text: value.text,
			aiOperationIds: coverLetterDraftVersionSchema.parse({ text: value.text, aiOperationIds: value.aiOperationIds })
				.aiOperationIds,
			versions,
			...(value.stopped ? { stopped: true as const } : {}),
		};
	} catch {
		return null;
	}
}

function writeStoredDraft(id: string, draft: StoredDraft) {
	try {
		// Keep text-only versions readable by older app bundles.
		sessionStorage.setItem(
			draftKey(id),
			JSON.stringify({
				...draft,
				versions: draft.versions?.map((version) => version.text),
				versionAiOperationIds: draft.versions?.map((version) => version.aiOperationIds),
			}),
		);
	} catch {
		// Blocked storage leaves the draft in this view; only a reload loses it.
	}
}

function clearStoredLetterDraft(id: string) {
	try {
		sessionStorage.removeItem(draftKey(id));
	} catch {
		// Nothing to clear.
	}
}

let timer: ReturnType<typeof setTimeout> | undefined;
let inflight: Promise<void> | null = null;
let drafting: AbortController | null = null;

const recoveryEditsSchema = coverLetterSchema
	.pick({
		name: true,
		recipient: true,
		content: true,
		aiOperationIds: true,
		greeting: true,
		signOff: true,
		recipientName: true,
		recipientCompany: true,
		letterDate: true,
	})
	.partial()
	.extend({
		locale: coverLetterSchema.shape.style.shape.metadata.shape.page.shape.locale.optional(),
		sender: coverLetterSchema.shape.style.shape.basics
			.extend({ picture: coverLetterSchema.shape.style.shape.picture.pick({ hidden: true }) })
			.partial()
			.optional(),
		metadata: coverLetterSchema.shape.style.shape.metadata
			.pick({ typography: true, design: true, page: true })
			.partial()
			.optional(),
	});

type LetterRecovery = {
	letter: CoverLetter;
	pending: LetterEdits;
	proposalApplications: ProposalApplications;
	pendingProposalApplications: ProposalApplications;
	proposalSafety?: unknown;
	storedAt: number;
	key: string;
	raw: string;
};
const RECOVERY_PREFIX = "reactive-resume:unsaved:letter:";
let restoredRecovery: { key: string; raw: string } | undefined;
let savingEdits: { sessionId: string; pending: LetterEdits } | null = null;
let recoveryCopy: { sessionId: string; letter: CoverLetter; copy: CoverLetter } | undefined;

function readRecovery(id: string): LetterRecovery | undefined {
	try {
		let latest: LetterRecovery | undefined;
		for (const key of Object.keys(window.localStorage)) {
			if (!key.startsWith(`${RECOVERY_PREFIX}${id}:`)) continue;
			try {
				const raw = window.localStorage.getItem(key) ?? "null";
				const value = JSON.parse(raw) as LetterRecovery;
				if (
					!Number.isFinite(value?.storedAt) ||
					(Date.now() - value.storedAt > 7 * 86_400_000 &&
						Object.keys(readProposalApplications(value.pendingProposalApplications)).length === 0)
				) {
					window.localStorage.removeItem(key);
					continue;
				}
				const letter = coverLetterSchema.parse({
					...value.letter,
					createdAt: new Date(value.letter.createdAt),
					updatedAt: new Date(value.letter.updatedAt),
				});
				const pending: LetterEdits = Object.fromEntries(
					Object.entries(recoveryEditsSchema.parse(value.pending)).filter(
						([key, parsed]) => Object.hasOwn(value.pending, key) && parsed !== undefined,
					),
				);
				const dirty =
					hasEdits(pending) || Object.keys(readProposalApplications(value.pendingProposalApplications)).length > 0;
				const latestDirty =
					latest && (hasEdits(latest.pending) || Object.keys(latest.pendingProposalApplications).length > 0);
				if (
					letter.id !== id ||
					(latest && ((latestDirty && !dirty) || (Boolean(latestDirty) === dirty && latest.storedAt > value.storedAt)))
				)
					continue;
				latest = {
					...value,
					key,
					raw,
					letter,
					pending,
					proposalApplications: readProposalApplications(value.proposalApplications),
					pendingProposalApplications: readProposalApplications(value.pendingProposalApplications),
				};
			} catch {
				/* Invalid recovery data never replaces a server document. */
			}
		}
		return latest;
	} catch {
		return undefined;
	}
}

/** The autosave owner retains authored edits and unsynchronized decisions in one recovery record. */
function persistRecovery() {
	const state = useLetterEditorStore.getState();
	if (!state.letter) return;
	const pending = mergeEdits(savingEdits?.sessionId === state.sessionId ? savingEdits.pending : {}, state.pending);
	try {
		const key = `${RECOVERY_PREFIX}${state.letter.id}:${state.sessionId}`;
		if (!hasEdits(pending) && Object.keys(state.proposalApplications).length === 0) window.localStorage.removeItem(key);
		else
			window.localStorage.setItem(
				key,
				JSON.stringify({
					letter: state.letter,
					pending,
					proposalApplications: state.proposalApplications,
					pendingProposalApplications: state.pendingProposalApplications,
					proposalSafety: state.proposalSafety,
					storedAt: Date.now(),
				}),
			);
		if (
			!hasEdits(pending) &&
			Object.keys(state.pendingProposalApplications).length === 0 &&
			restoredRecovery &&
			restoredRecovery.key !== key &&
			window.localStorage.getItem(restoredRecovery.key) === restoredRecovery.raw
		)
			window.localStorage.removeItem(restoredRecovery.key);
	} catch {
		/* Full or blocked storage never discards the in-memory edits; autosave can still retry. */
	}
}

const hasEdits = (edits: LetterEdits) => Object.keys(edits).length > 0;

export const useLetterEditorStore = create<LetterEditorStore>()((set, get) => ({
	proposalApplications: {},
	pendingProposalApplications: {},
	proposalSafety: "v1",
	letter: null,
	savedName: null,
	status: "saved",
	changing: false,
	pending: {},
	sessionId: generateId(),
	draft: idleDraft,
	undoStack: [],
	redoStack: [],

	undo: () => {
		const { letter, undoStack } = get();
		const step = undoStack.at(-1);
		if (!letter || !step || letter.isLocked) return;
		const back = inverseEdits(letter, step) ?? {};
		lastUndoAt = 0;
		get().edit(step, { history: true });
		set((state) => ({ undoStack: state.undoStack.slice(0, -1), redoStack: [...state.redoStack, back] }));
	},

	redo: () => {
		const { letter, redoStack } = get();
		const step = redoStack.at(-1);
		if (!letter || !step || letter.isLocked) return;
		const back = inverseEdits(letter, step) ?? {};
		lastUndoAt = 0;
		get().edit(step, { history: true });
		set((state) => ({ redoStack: state.redoStack.slice(0, -1), undoStack: [...state.undoStack, back] }));
	},

	load: (letter, options = {}) => {
		recoveryCopy = undefined;
		lastUndoAt = 0;
		if (options.recover === false) {
			// Explicit Reload discards this visit, never another tab's independent recovery entry.
			const current = get();
			try {
				if (current.letter?.id === letter.id)
					window.localStorage.removeItem(`${RECOVERY_PREFIX}${letter.id}:${current.sessionId}`);
				if (
					restoredRecovery?.key.startsWith(`${RECOVERY_PREFIX}${letter.id}:`) &&
					window.localStorage.getItem(restoredRecovery.key) === restoredRecovery.raw
				)
					window.localStorage.removeItem(restoredRecovery.key);
			} catch {
				/* Reload still opens the server document when browser storage is unavailable. */
			}
		} else persistRecovery();
		let recovery = options.recover === false ? undefined : readRecovery(letter.id);
		if (
			recovery &&
			Object.keys(recovery.pendingProposalApplications).length === 0 &&
			isEqual(applyEdits(letter, recovery.pending), letter)
		)
			recovery = { ...recovery, pending: {} };
		if (
			recovery &&
			!hasEdits(recovery.pending) &&
			Object.keys(recovery.pendingProposalApplications).length === 0 &&
			recovery.letter.revision !== letter.revision
		)
			recovery = undefined;
		restoredRecovery = recovery ? { key: recovery.key, raw: recovery.raw } : undefined;
		const restore =
			recovery && (hasEdits(recovery.pending) || Object.keys(recovery.pendingProposalApplications).length > 0)
				? recovery
				: undefined;
		clearTimeout(timer);
		drafting?.abort();
		drafting = null;
		set({
			proposalApplications: recovery?.proposalApplications ?? {},
			pendingProposalApplications: recovery?.pendingProposalApplications ?? {},
			// What an older app's recovery holds is sent on its terms (see proposalSafety).
			proposalSafety: !restore || restore.proposalSafety === "v1" ? "v1" : undefined,
			letter: restore ? { ...applyEdits(letter, restore.pending), revision: restore.letter.revision } : letter,
			savedName: letter.name,
			status: restore
				? restore.letter.revision !== letter.revision
					? "conflict"
					: "saving"
				: Object.keys(recovery?.pendingProposalApplications ?? {}).length
					? "saving"
					: "saved",
			changing: false,
			pending: restore?.pending ?? {},
			sessionId: generateId(),
			// A ready draft from before a reload is shown again, never re-requested.
			draft: readStoredDraft(letter.id, letter.revision) ?? idleDraft,
			undoStack: [],
			redoStack: [],
		});
		if (restore || Object.keys(get().pendingProposalApplications).length > 0)
			timer = setTimeout(() => void get().flush(), SAVE_DELAY_MS);
	},

	edit: (input, options = {}) => {
		const { letter, changing, proposalApplications, pendingProposalApplications } = get();
		const sources = proposalAiOperationIds(options.applied ?? []);
		const withSources = sources.length
			? {
					...input,
					aiOperationIds: [...new Set([...(input.aiOperationIds ?? letter?.aiOperationIds ?? []), ...sources])],
				}
			: input;
		const { sender, ...otherEdits } = withSources;
		const edits = sender && (changing || (letter?.sourceResumeId && letter.senderLinked)) ? otherEdits : withSources;
		if (!hasEdits(edits) || letter?.isLocked) return;
		const inverse = letter && !options.history ? inverseEdits(letter, edits) : undefined;
		if (inverse) {
			const keys = Object.keys(inverse).sort().join();
			const now = Date.now();
			const grouped = keys === lastUndoKeys && now - lastUndoAt < UNDO_GROUP_MS;
			lastUndoAt = now;
			lastUndoKeys = keys;
			set((state) => ({
				undoStack: grouped ? state.undoStack : [...state.undoStack, inverse].slice(-UNDO_LIMIT),
				redoStack: [],
			}));
		}
		set((state) =>
			state.letter
				? {
						letter: applyEdits(state.letter, edits),
						proposalApplications: options.restoreApplications
							? restoreProposalApplications(state.proposalApplications, options.restoreApplications)
							: { ...state.proposalApplications, ...appliedApplications(options.applied ?? []) },
						pending: mergeEdits(state.pending, edits),
						status: state.status === "conflict" ? "conflict" : "saving",
					}
				: state,
		);
		set({
			pendingProposalApplications: queueProposalApplications(
				proposalApplications,
				get().proposalApplications,
				pendingProposalApplications,
			),
		});
		persistRecovery();
		clearTimeout(timer);
		timer = setTimeout(() => void get().flush(), SAVE_DELAY_MS);
	},

	flush: async () => {
		const { sessionId } = get();
		clearTimeout(timer);
		// A save that finishes can start a follow-up for what was typed meanwhile; wait for that one too.
		while (inflight) await inflight;
		if (get().sessionId !== sessionId) return false;

		const { letter, pending, status, pendingProposalApplications, proposalSafety } = get();
		if (
			!letter ||
			letter.isLocked ||
			(!hasEdits(pending) && Object.keys(pendingProposalApplications).length === 0) ||
			status === "conflict"
		)
			return status === "saved";
		const current = (state: LetterEditorStore) => state.letter?.id === letter.id && state.sessionId === sessionId;

		savingEdits = { sessionId, pending };
		persistRecovery();
		set({ pending: {}, status: "saving" });
		inflight = (async () => {
			try {
				const saved = await client.coverLetters.update({
					id: letter.id,
					expectedRevision: letter.revision,
					sessionId,
					...(proposalSafety ? { proposalSafety } : {}),
					...pending,
					...(Object.keys(pendingProposalApplications).length
						? { proposalApplications: { ...pendingProposalApplications } }
						: {}),
				});
				// What was typed stays as typed (the server trims and cleans what it stores), and so does anything typed
				// since.
				set((state) =>
					current(state)
						? {
								letter: applyEdits(saved, mergeEdits(pending, state.pending)),
								// The server took what this letter held; what's typed from here on is this app's own.
								proposalSafety: "v1",
								pendingProposalApplications: acknowledgeProposalApplications(
									state.pendingProposalApplications,
									pendingProposalApplications,
								),
								savedName: saved.name,
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
				if (savingEdits?.sessionId === sessionId) savingEdits = null;
				if (current(get())) persistRecovery();
			}
		})();
		await inflight;

		// Typed while that save was on its way.
		if (!current(get())) return false;
		if (
			get().status === "saving" &&
			(hasEdits(get().pending) || Object.keys(get().pendingProposalApplications).length > 0)
		)
			return get().flush();
		return get().status === "saved";
	},

	change: async (action) => {
		const { sessionId } = get();
		if (get().changing) throw new Error(t`Couldn't save your changes. Try again before continuing.`);
		set({ changing: true });
		try {
			if (!(await get().flush())) throw new Error(t`Couldn't save your changes. Try again before continuing.`);
			const { letter } = get();
			if (!letter || get().sessionId !== sessionId) throw new Error("No letter is open.");
			const next = await action(letter);
			set((state) =>
				state.letter?.id === letter.id && state.sessionId === sessionId
					? { letter: applyEdits(next, state.pending), savedName: next.name }
					: state,
			);
			return next;
		} finally {
			if (get().sessionId === sessionId) set({ changing: false });
		}
	},

	reloadFromServer: async () => {
		const { letter, sessionId, changing, status } = get();
		if (!letter || changing || status !== "conflict") return null;
		set({ changing: true });
		persistRecovery();
		const current = () => get().sessionId === sessionId;
		const unchanged = () => {
			if (!current()) return false;
			if (get().letter !== letter)
				throw new Error(
					t`Your letter changed while reloading. Your edits are still open. Reload again to keep a new copy.`,
				);
			return true;
		};
		try {
			// A failed read can retry without making another copy of the same draft.
			let copy =
				recoveryCopy?.sessionId === sessionId && recoveryCopy.letter === letter ? recoveryCopy.copy : undefined;
			if (!copy) {
				copy = await client.coverLetters.import({
					...(letter.aiOperationIds ? { aiOperationIds: letter.aiOperationIds } : {}),
					document: coverLetterDocumentSchema.parse({
						...letter,
						format: "reactive-resume-cover-letter",
						version: 1,
						name: t`${letter.name} (mine)`.slice(0, 100),
					}),
				});
				if (current()) recoveryCopy = { sessionId, letter, copy };
			}
			if (!unchanged()) return null;
			const saved = await client.coverLetters.getById({ id: letter.id });
			if (!unchanged()) return null;
			get().load(saved, { recover: false });
			return copy;
		} finally {
			if (current()) set({ changing: false });
		}
	},

	reset: () => {
		recoveryCopy = undefined;
		lastUndoAt = 0;
		persistRecovery();
		clearTimeout(timer);
		drafting?.abort();
		drafting = null;
		set({
			proposalApplications: {},
			pendingProposalApplications: {},
			proposalSafety: "v1",
			letter: null,
			savedName: null,
			status: "saved",
			changing: false,
			pending: {},
			sessionId: generateId(),
			draft: idleDraft,
			undoStack: [],
			redoStack: [],
		});
	},
}));

/** Streams a draft from the posting (or a Shorter / More personal revision of `previous`) into `draft`. */
export async function startLetterDraft(
	variant: "draft" | "shorter" | "personal" = "draft",
	previous?: string,
	previousAiOperationIds: string[] = [],
) {
	const { letter, sessionId } = useLetterEditorStore.getState();
	if (!letter) return;
	const account = getAccountGeneration();
	drafting?.abort();
	const controller = new AbortController();
	drafting = controller;
	const current = () =>
		drafting === controller &&
		getAccountGeneration() === account &&
		useLetterEditorStore.getState().sessionId === sessionId;
	let revision = letter.revision;
	// A revision keeps what came before it; the oldest drops off past the limit.
	const before = useLetterEditorStore.getState().draft;
	const versions = (
		before.phase === "ready"
			? [...before.versions, { text: before.text, aiOperationIds: before.aiOperationIds }]
			: before.phase === "idle"
				? []
				: before.versions
	).slice(-(MAX_DRAFT_VERSIONS - 1));
	const setDraft = (draft: LetterDraft) => {
		if (!current()) return;
		useLetterEditorStore.setState({ draft });
		if (draft.phase === "ready")
			writeStoredDraft(letter.id, {
				text: draft.text,
				aiOperationIds: draft.aiOperationIds,
				versions,
				variant,
				revision,
			});
	};
	clearStoredLetterDraft(letter.id);
	let aiOperationIds = variant === "draft" ? [] : previousAiOperationIds;
	setDraft({ phase: "streaming", text: "", aiOperationIds, versions });

	try {
		// Draft from the same saved links and revision the editor shows.
		const saved = await useLetterEditorStore.getState().flush();
		if (!current()) return;
		if (!saved) throw new Error("Save the letter before drafting. Your edits are still here.");
		const savedLetter = useLetterEditorStore.getState().letter;
		if (!savedLetter || savedLetter.id !== letter.id) return;
		revision = savedLetter.revision;
		const stream = await streamClient.coverLetters.draft(
			{ id: letter.id, variant, includeProvenance: true, ...(previous ? { previous } : {}) },
			{ signal: controller.signal },
		);
		let text = "";
		for await (const chunk of stream) {
			if (typeof chunk !== "string") {
				aiOperationIds = [...new Set([...aiOperationIds, chunk.aiOperationId])];
			} else text += chunk;
			setDraft({ phase: "streaming", text, aiOperationIds, versions });
		}
		if (!text.trim()) throw new Error("The draft came back empty.");
		setDraft({ phase: "ready", text: text.trim(), aiOperationIds, versions });
	} catch (error) {
		if (controller.signal.aborted) return;
		const data = error instanceof ORPCError ? (error.data as { provider?: unknown } | undefined) : undefined;
		setDraft({
			phase: "failed",
			provider: typeof data?.provider === "string" ? data.provider : null,
			error,
			versions,
		});
	}
}

/** The draft's earlier version, or nothing: what's left when a run is stopped or its failure dismissed. */
function settleDraft(
	text: string,
	versions: CoverLetterDraftVersion[],
	stopped: boolean,
	aiOperationIds: string[] = [],
): LetterDraft {
	const { letter } = useLetterEditorStore.getState();
	const last = versions.at(-1);
	const draft: LetterDraft = text.trim()
		? { phase: "ready", text: text.trim(), aiOperationIds, versions, ...(stopped ? { stopped: true as const } : {}) }
		: last !== undefined
			? { phase: "ready", ...last, versions: versions.slice(0, -1) }
			: idleDraft;
	if (letter) {
		if (draft.phase === "ready")
			writeStoredDraft(letter.id, {
				text: draft.text,
				aiOperationIds: draft.aiOperationIds,
				versions: draft.versions,
				variant: "draft",
				revision: letter.revision,
				...(draft.stopped ? { stopped: true as const } : {}),
			});
		else clearStoredLetterDraft(letter.id);
	}
	return draft;
}

/** Stops a draft that's streaming and keeps what arrived as a draft to review; with nothing yet, the last version. */
export function stopLetterDraft() {
	const { draft } = useLetterEditorStore.getState();
	drafting?.abort();
	drafting = null;
	if (draft.phase !== "streaming") return;
	useLetterEditorStore.setState({ draft: settleDraft(draft.text, draft.versions, true, draft.aiOperationIds) });
}

/** Closes a failed run, going back to the draft before it when there was one. */
export function dismissLetterDraftFailure() {
	const { draft } = useLetterEditorStore.getState();
	if (draft.phase !== "failed") return;
	useLetterEditorStore.setState({ draft: settleDraft("", draft.versions, false) });
}

export function discardLetterDraft() {
	const id = useLetterEditorStore.getState().letter?.id;
	drafting?.abort();
	drafting = null;
	if (id) clearStoredLetterDraft(id);
	useLetterEditorStore.setState({ draft: idleDraft });
}
