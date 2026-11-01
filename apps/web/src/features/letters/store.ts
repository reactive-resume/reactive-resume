import type { Proposal, ProposalApplications } from "@reactive-resume/resume/proposals";
import type { CoverLetter } from "@reactive-resume/schema/cover-letter/data";
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
} from "@reactive-resume/resume/proposals";
import { coverLetterDocumentSchema, coverLetterSchema } from "@reactive-resume/schema/cover-letter/data";
import { generateId } from "@reactive-resume/utils/string";
import { client, streamClient } from "@/libs/orpc/client";

type LetterMetadata = CoverLetter["style"]["metadata"];

/**
 * What's typed in the letter editor: saved once typing pauses. `metadata` is the letter's own type, colors and page;
 * setting it ends the design link.
 */
export type LetterEdits = Partial<
	Pick<
		CoverLetter,
		"name" | "recipient" | "content" | "greeting" | "signOff" | "recipientName" | "recipientCompany" | "letterDate"
	>
> & {
	/** The letter's own sender details, all of them editable once the sender link is off. */
	sender?: Partial<CoverLetter["style"]["basics"] & { picture: Pick<CoverLetter["style"]["picture"], "hidden"> }>;
	metadata?: Partial<Pick<LetterMetadata, "typography" | "design" | "page">>;
};

const mergeEdits = (edits: LetterEdits, next: LetterEdits): LetterEdits => ({
	...edits,
	...next,
	...(edits.metadata && next.metadata ? { metadata: { ...edits.metadata, ...next.metadata } } : {}),
	...(edits.sender && next.sender ? { sender: { ...edits.sender, ...next.sender } } : {}),
});

const applyEdits = (letter: CoverLetter, { metadata, sender, ...fields }: LetterEdits): CoverLetter => ({
	...letter,
	...fields,
	...(metadata ? { designLinked: false } : {}),
	style: {
		...letter.style,
		...(metadata ? { metadata: { ...letter.style.metadata, ...metadata } } : {}),
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
	| { phase: "streaming" | "ready"; text: string }
	| { phase: "failed"; provider: string | null; error: unknown };

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
			applied?: readonly Pick<Proposal, "id" | "after" | "snapshot">[];
			restoreApplications?: ProposalApplications;
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
};

const idleDraft: LetterDraft = { phase: "idle" };

let timer: ReturnType<typeof setTimeout> | undefined;
let inflight: Promise<void> | null = null;
let drafting: AbortController | null = null;

const recoveryEditsSchema = coverLetterSchema
	.pick({
		name: true,
		recipient: true,
		content: true,
		greeting: true,
		signOff: true,
		recipientName: true,
		recipientCompany: true,
		letterDate: true,
	})
	.partial()
	.extend({
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

	load: (letter, options = {}) => {
		recoveryCopy = undefined;
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
			draft: idleDraft,
		});
		if (restore || Object.keys(get().pendingProposalApplications).length > 0)
			timer = setTimeout(() => void get().flush(), SAVE_DELAY_MS);
	},

	edit: (input, options = {}) => {
		const { letter, changing, proposalApplications, pendingProposalApplications } = get();
		const { sender, ...otherEdits } = input;
		const edits = sender && (changing || (letter?.sourceResumeId && letter.senderLinked)) ? otherEdits : input;
		if (!hasEdits(edits) || letter?.isLocked) return;
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
		if (inflight) await inflight;
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
		});
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
