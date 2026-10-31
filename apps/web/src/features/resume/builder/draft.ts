import type { Proposal, ProposalApplications, ProposalSnapshot } from "@reactive-resume/resume/proposals";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { WritableDraft } from "immer";
import { t } from "@lingui/core/macro";
import { consumeEventIterator, ORPCError } from "@orpc/client";
import { useQueryClient } from "@tanstack/react-query";
import { useBlocker, useParams } from "@tanstack/react-router";
import { debounce, isEqual } from "es-toolkit";
import { useCallback, useEffect, useState } from "react";
import { immer } from "zustand/middleware/immer";
import { create } from "zustand/react";
import {
	acknowledgeProposalApplications,
	appliedApplications,
	queueProposalApplications,
	readProposalApplications,
	restoreProposalApplications,
} from "@reactive-resume/resume/proposals";
import { syncResumeDates } from "@reactive-resume/schema/resume/dates";
import { toast } from "@reactive-resume/ui/components/toast";
import { generateId } from "@reactive-resume/utils/string";
import { orpc, streamClient } from "@/libs/orpc/client";

export type Resume = {
	id: string;
	name: string;
	slug: string;
	tags: string[];
	data: ResumeData;
	isLocked: boolean;
	createdAt: Date;
	updatedAt: Date;
	hasPassword?: boolean | undefined;
	isPublic?: boolean | undefined;
	showDownloadButtons?: boolean | undefined;
	showInSearchEngines?: boolean | undefined;
	hideContactDetails?: boolean | undefined;
	isPrimary?: boolean | undefined;
	/** The job application this resume was made for; Check's Job match reads its posting. */
	applicationId?: string | null;
};

// Mirrors the server-side ResumeUpdatedEvent discriminator (packages/api resume/events.ts).
type ResumeUpdateMutation = "sync" | "create" | "update" | "patch" | "lock" | "password" | "delete";
type ResumeUpdateEvent = { mutation: ResumeUpdateMutation };

/**
 * `conflict`: saving pauses until the local draft is kept as a copy and the server version is reloaded.
 * `offline`: the browser is offline; changes are kept on this device and sent when it reconnects.
 * `error`: the server rejected or couldn't be reached while online; changes are kept on this device
 * and the editor offers Retry.
 */
type SaveStatus = "idle" | "saving" | "saved" | "offline" | "error" | "conflict";

type UpdateResumeDataOptions = {
	/** Proposals this edit applied, recorded with their wording in this undo step alongside the authored data. */
	applied?: readonly Pick<Proposal, "id" | "after" | "snapshot">[];
	/**
	 * Identifies the field being edited. Consecutive edits to the same field within a second merge into
	 * one undo step, so typing a sentence undoes as a whole.
	 */
	coalesceKey?: string;
	/** Always a step of its own (structural actions such as adding, moving or deleting). */
	newStep?: boolean;
	/**
	 * Merges into the current step whenever the previous edit had the same key, however long ago: one action
	 * made of several edits, such as Fit to one page, undoes as a whole.
	 */
	sameStep?: boolean;
};

type ResumeStoreState = {
	resume: Resume | null;
	resumeId?: string | undefined;
	isReady: boolean;
	saveStatus: SaveStatus;
	// Undo/redo stacks of `ResumeData` references. Immer's immutable updates share structure, so a
	// step costs only the parts that changed.
	proposalApplications: ProposalApplications;
	undoStack: ProposalSnapshot<ResumeData>[];
	redoStack: ProposalSnapshot<ResumeData>[];
};

type ResumeStoreActions = {
	initialize: (resume: Resume | null) => void;
	reset: () => void;
	replaceResumeFromServer: (resume: Resume) => void;
	updateResumeData: (fn: (draft: WritableDraft<ResumeData>) => void, options?: UpdateResumeDataOptions) => void;
	patchResume: (fn: (draft: WritableDraft<Resume>) => void) => void;
	mergeResumeMetadata: (resume: Resume) => void;
	setSaveStatus: (status: SaveStatus) => void;
	undo: () => void;
	redo: () => void;
	/** Sends the latest unsaved changes again, e.g. from the "Not saved · Retry" status. */
	retrySave: () => void;
	/** Keeps local edits in a separate resume before loading the saved version. */
	reloadFromServer: () => Promise<void>;
};

type ResumeStore = ResumeStoreState & ResumeStoreActions;

type Runtime = {
	proposalApplications: ProposalApplications;
	pendingProposalApplications: ProposalApplications;
	abortController: AbortController;
	queryClient?: QueryClient;
	hasPendingLocalChanges: boolean;
	isSaving: boolean;
	/** Version of the data we accepted, never metadata fetched while local edits are pending. */
	baseUpdatedAt?: Date | undefined;
	conflict: boolean;
	reloading: boolean;
	copyId?: string;
	restoredDraft?: { key: string; raw: string };
	pendingResume?: Resume | undefined;
	/** The last save failed; don't loop on it. Cleared by the next edit, Retry, reconnecting or success. */
	saveFailed: boolean;
	slowSaveToastId?: string | undefined;
	syncResume: ReturnType<typeof debounce<(resume: Resume) => void>>;
	beforeUnloadHandler?: () => void;
	onlineHandler?: () => void;
	deferredRemoteResume?: Resume | undefined;
	deferredFocusHandler?: (() => void) | undefined;
	/** This visit's saves share one autosave version in History. */
	sessionId: string;
	/**
	 * Set while the draft is this app's own: it applies assistant edits only through checked decisions. Changes
	 * restored from an older app's recovery lack it and are sent without proposalSafety until the server takes them or
	 * the draft is replaced, so updating the app never vouches for what the older one queued.
	 */
	proposalSafety?: "v1" | undefined;
};

type ResumeUpdateSubscriptionOptions = {
	resumeId?: string | undefined;
	onUpdate: (event: ResumeUpdateEvent) => Promise<void> | void;
	onError?: (error: unknown) => void;
};

const SAVE_DEBOUNCE_MS = 500;
const NAVIGATION_SAVE_WAIT_MS = 10_000;
// Edits without a field key coalesce within this window (e.g. dragging); keyed edits to the same field
// coalesce within FIELD_COALESCE_MS (typing a sentence).
const HISTORY_COALESCE_MS = 500;
const FIELD_COALESCE_MS = 1000;
// Bounded stacks. Entries are shared-structure references, so 200 steps stay cheap.
const MAX_HISTORY_ENTRIES = 200;
const UNSAVED_STORAGE_PREFIX = "reactive-resume:unsaved:";
const runtimes = new Map<string, Runtime>();

// Coalescing bookkeeping. Not reactive — only decides whether the next edit opens a new undo step.
let historyLastEditAt = 0;
let historyLastKey: string | undefined;
let historyCanCoalesce = false;

function resetHistoryRuntime() {
	historyLastEditAt = 0;
	historyLastKey = undefined;
	historyCanCoalesce = false;
}

/** Whether the next edit merges into the current undo step. Exported for tests. */
function shouldCoalesceEdit(
	previous: { at: number; key: string | undefined; canCoalesce: boolean },
	next: { at: number; key: string | undefined; newStep: boolean },
): boolean {
	if (next.newStep || !previous.canCoalesce || previous.key !== next.key) return false;
	const window = next.key === undefined ? HISTORY_COALESCE_MS : FIELD_COALESCE_MS;
	return next.at - previous.at < window;
}

// Each visit owns its recovery entry: another tab's successful save must not clear our unsaved typing.
function recoveryKey(resume: Resume) {
	return `${UNSAVED_STORAGE_PREFIX}${resume.id}:${getRuntime(resume.id).sessionId}`;
}

function storeUnsavedResume(resume: Resume) {
	try {
		window.localStorage.setItem(
			recoveryKey(resume),
			JSON.stringify({
				data: resume.data,
				baseUpdatedAt: getRuntime(resume.id).baseUpdatedAt,
				storedAt: Date.now(),
				proposalApplications: getRuntime(resume.id).proposalApplications,
				pendingProposalApplications: getRuntime(resume.id).pendingProposalApplications,
				proposalSafety: getRuntime(resume.id).proposalSafety,
			}),
		);
	} catch {
		// Storage can be full or blocked; the in-memory copy still retries.
	}
}

function clearUnsavedResume(resume: Resume) {
	try {
		const runtime = getRuntime(resume.id);
		if (Object.keys(runtime.proposalApplications).length > 0) {
			window.localStorage.setItem(
				recoveryKey(resume),
				JSON.stringify({
					data: resume.data,
					baseUpdatedAt: runtime.baseUpdatedAt,
					storedAt: Date.now(),
					clean: true,
					proposalApplications: runtime.proposalApplications,
					pendingProposalApplications: runtime.pendingProposalApplications,
					proposalSafety: runtime.proposalSafety,
				}),
			);
		} else window.localStorage.removeItem(recoveryKey(resume));
		const restored = getRuntime(resume.id).restoredDraft;
		if (restored && restored.key !== recoveryKey(resume) && window.localStorage.getItem(restored.key) === restored.raw)
			window.localStorage.removeItem(restored.key);
	} catch {
		// Nothing to clear.
	}
}

type UnsavedResume = {
	data: ResumeData;
	baseUpdatedAt?: string;
	storedAt: number;
	key: string;
	raw: string;
	clean?: boolean;
	proposalApplications?: ProposalApplications;
	pendingProposalApplications?: ProposalApplications;
	proposalSafety?: unknown;
};

function readUnsavedResume(id: string): UnsavedResume | undefined {
	try {
		const prefix = `${UNSAVED_STORAGE_PREFIX}${id}`;
		let newest: UnsavedResume | undefined;
		for (const key of Object.keys(window.localStorage)) {
			if (key !== prefix && !key.startsWith(`${prefix}:`)) continue;
			const raw = window.localStorage.getItem(key);
			if (!raw) continue;
			try {
				const parsed = JSON.parse(raw) as Omit<UnsavedResume, "key" | "raw">;
				if (
					!Number.isFinite(parsed.storedAt) ||
					(Date.now() - parsed.storedAt > 7 * 86_400_000 &&
						Object.keys(readProposalApplications(parsed.pendingProposalApplications)).length === 0)
				) {
					window.localStorage.removeItem(key);
					continue;
				}
				if (
					parsed.data &&
					(!newest ||
						(newest.clean && !parsed.clean) ||
						(Boolean(newest.clean) === Boolean(parsed.clean) && parsed.storedAt >= newest.storedAt))
				)
					newest = { ...parsed, key, raw };
			} catch {
				// A damaged entry must not hide other recoverable drafts.
			}
		}
		return newest;
	} catch {
		return undefined;
	}
}

export function readUnsavedResumeData(id: string): ResumeData | undefined {
	const recovery = readUnsavedResume(id);
	return recovery?.clean ? undefined : recovery?.data;
}

function isBrowserOffline() {
	return typeof navigator !== "undefined" && navigator.onLine === false;
}

let lockedToastId: string | undefined;

function warnLocked() {
	lockedToastId = toast.add({
		type: "error",
		description: t`This resume is locked. Unlock it from its menu to edit.`,
		id: lockedToastId,
	});
}

function clearHistory(state: WritableDraft<ResumeStoreState>) {
	state.undoStack = [];
	state.redoStack = [];
}

function getResumeQueryKey(id: string): QueryKey {
	return orpc.resume.getById.queryOptions({ input: { id } }).queryKey as QueryKey;
}

export function isEditableElementFocused(): boolean {
	const element = document.activeElement as HTMLElement | null;
	if (!element) return false;
	return (
		element.tagName === "INPUT" ||
		element.tagName === "TEXTAREA" ||
		element.tagName === "SELECT" ||
		element.isContentEditable ||
		element.closest(".cm-editor") !== null
	);
}

function externalUpdateMessage(mutation: ResumeUpdateMutation): string {
	if (mutation === "patch") return t`This resume was updated by an AI agent.`;
	if (mutation === "lock" || mutation === "password") return t`This resume's sharing settings changed elsewhere.`;
	return t`Synced changes made in another tab.`;
}

function notifyExternalUpdate(mutation: ResumeUpdateMutation) {
	toast.add({ type: "info", description: externalUpdateMessage(mutation), id: "resume-external-update" });
}

// #54: applies a remote update that was deferred because the user was typing.
function applyDeferredRemoteResume(id: string) {
	const runtime = runtimes.get(id);
	if (!runtime?.deferredRemoteResume) return;

	const resume = runtime.deferredRemoteResume;
	runtime.deferredRemoteResume = undefined;
	if (runtime.deferredFocusHandler) {
		document.removeEventListener("focusout", runtime.deferredFocusHandler, true);
		runtime.deferredFocusHandler = undefined;
	}

	// Keep local edits open; discard deferred snapshots older than the accepted baseline.
	if (runtime.hasPendingLocalChanges || (runtime.baseUpdatedAt && resume.updatedAt <= runtime.baseUpdatedAt)) return;

	useResumeStore.getState().replaceResumeFromServer(resume);
	notifyExternalUpdate("update");
}

// #54: don't overwrite a focused field mid-keystroke; stash the remote resume and apply it on blur.
function deferRemoteResumeUntilBlur(id: string, resume: Resume) {
	const runtime = getRuntime(id);
	runtime.deferredRemoteResume = resume;

	if (runtime.deferredFocusHandler) return;

	const handler = () => {
		// Let focus settle (e.g. tabbing between fields) before deciding editing has ended.
		window.setTimeout(() => {
			if (isEditableElementFocused()) return;
			applyDeferredRemoteResume(id);
		}, 0);
	};

	runtime.deferredFocusHandler = handler;
	document.addEventListener("focusout", handler, true);
}

function setRuntimeBaseline(resume: Resume) {
	const runtime = getRuntime(resume.id);
	runtime.hasPendingLocalChanges = false;
	runtime.pendingResume = undefined;
	runtime.baseUpdatedAt = resume.updatedAt;
	runtime.proposalSafety = "v1";
	runtime.conflict = false;
	runtime.saveFailed = false;
	runtime.syncResume.cancel();
}

async function flushResumeSave(id: string) {
	const runtime = runtimes.get(id);
	if (!runtime || runtime.isSaving || runtime.conflict || !runtime.baseUpdatedAt || !runtime.pendingResume) return;

	const submitted = runtime.pendingResume;
	const submittedData = structuredClone(submitted.data);
	const submittedApplications = runtime.pendingProposalApplications;
	runtime.pendingResume = undefined;
	runtime.isSaving = true;

	try {
		const updated = (await orpc.resume.update.call(
			{
				id: submitted.id,
				data: submittedData,
				sessionId: runtime.sessionId,
				expectedUpdatedAt: runtime.baseUpdatedAt,
				...(runtime.proposalSafety ? { proposalSafety: runtime.proposalSafety } : {}),
				...(Object.keys(submittedApplications).length ? { proposalApplications: { ...submittedApplications } } : {}),
			},
			{ signal: runtime.abortController.signal },
		)) as Resume;
		if (runtime.abortController.signal.aborted) return;

		// The server took what this draft held; what's typed from here on is this app's own.
		runtime.proposalSafety = "v1";
		runtime.pendingProposalApplications = acknowledgeProposalApplications(
			runtime.pendingProposalApplications,
			submittedApplications,
		);
		runtime.baseUpdatedAt = updated.updatedAt;
		runtime.queryClient?.setQueryData(getResumeQueryKey(submitted.id), updated);

		const currentResume = useResumeStore.getState().resume;
		const currentDataStillMatchesSubmission =
			currentResume?.id === submitted.id &&
			isEqual(currentResume.data, submittedData) &&
			Object.keys(runtime.pendingProposalApplications).length === 0;

		if (currentDataStillMatchesSubmission && !runtime.pendingResume) {
			runtime.hasPendingLocalChanges = false;
			// The local data still equals what we just saved, so the client already holds the canonical
			// data — only server-owned metadata (updatedAt, etc.) can differ. Merge just that instead of
			// replacing the whole resume: a full replace swaps every nested reference (the server strips
			// `undefined`s, so an equality check on its echo can't even confirm they match), which fires
			// every `data` selector and remounts the entire builder tree on each save-after-typing.
			useResumeStore.getState().mergeResumeMetadata(updated);
			useResumeStore.getState().setSaveStatus("saved");
		} else {
			runtime.hasPendingLocalChanges = true;
			useResumeStore.getState().mergeResumeMetadata(updated);

			if (!runtime.pendingResume && currentResume?.id === submitted.id && !isEqual(currentResume.data, submittedData)) {
				runtime.syncResume.cancel();
				runtime.pendingResume = structuredClone(currentResume);
			}
		}

		runtime.saveFailed = false;
		if (!runtime.pendingResume && !runtime.hasPendingLocalChanges) clearUnsavedResume(submitted);
		else if (currentResume?.id === id) storeUnsavedResume(currentResume);
	} catch (error: unknown) {
		if (runtime.abortController.signal.aborted) return;
		if (error instanceof DOMException && error.name === "AbortError") return;

		runtime.pendingResume ??= submitted;
		runtime.hasPendingLocalChanges = true;
		runtime.saveFailed = true;
		runtime.conflict = error instanceof ORPCError && error.code === "RESUME_VERSION_CONFLICT";
		storeUnsavedResume(useResumeStore.getState().resume ?? submitted);
		// The editor bar shows the state ("Offline · saved on this device" or "Not saved · Retry").
		useResumeStore.getState().setSaveStatus(runtime.conflict ? "conflict" : isBrowserOffline() ? "offline" : "error");
	} finally {
		if (runtime.slowSaveToastId !== undefined) {
			toast.close(runtime.slowSaveToastId);
			runtime.slowSaveToastId = undefined;
		}
		runtime.isSaving = false;
		if (runtime.pendingResume && !runtime.saveFailed) void flushResumeSave(id);
	}
}

function queueResumeSave(resume: Resume) {
	const runtime = getRuntime(resume.id);
	if (runtime.conflict) return;
	runtime.pendingResume = structuredClone(resume);
	runtime.hasPendingLocalChanges = true;
	runtime.saveFailed = false;
	void flushResumeSave(resume.id);
}

function createRuntime(): Runtime {
	const abortController = new AbortController();

	const syncResume = debounce(
		(resume: Resume) => {
			queueResumeSave(resume);
		},
		SAVE_DEBOUNCE_MS,
		{ signal: abortController.signal },
	);

	const runtime: Runtime = {
		proposalApplications: {},
		pendingProposalApplications: {},
		abortController,
		hasPendingLocalChanges: false,
		isSaving: false,
		conflict: false,
		reloading: false,
		saveFailed: false,
		syncResume,
		sessionId: generateId(),
		proposalSafety: "v1",
	};

	runtime.beforeUnloadHandler = () => runtime.syncResume.flush();
	window.addEventListener("beforeunload", runtime.beforeUnloadHandler);
	// Changes made offline are sent as soon as the connection comes back.
	runtime.onlineHandler = () => {
		const current = useResumeStore.getState().resume;
		if (!runtime.hasPendingLocalChanges || !current) return;
		queueResumeSave(current);
	};
	window.addEventListener("online", runtime.onlineHandler);

	return runtime;
}

function getRuntime(id: string): Runtime {
	const existing = runtimes.get(id);
	if (existing) return existing;

	const runtime = createRuntime();
	runtimes.set(id, runtime);
	return runtime;
}

function bindRuntimeQueryClient(id: string, queryClient: QueryClient) {
	getRuntime(id).queryClient = queryClient;
}

function hasPendingLocalChanges(id: string): boolean {
	return getRuntime(id).hasPendingLocalChanges;
}

function cleanupRuntime(id: string) {
	const runtime = runtimes.get(id);
	if (!runtime) return;

	runtime.syncResume.flush();
	runtime.abortController.abort();

	if (runtime.beforeUnloadHandler) {
		window.removeEventListener("beforeunload", runtime.beforeUnloadHandler);
	}

	if (runtime.onlineHandler) {
		window.removeEventListener("online", runtime.onlineHandler);
	}

	if (runtime.deferredFocusHandler) {
		document.removeEventListener("focusout", runtime.deferredFocusHandler, true);
	}

	runtimes.delete(id);
}

/** Cancel saves before account storage is cleared, including late failures from an old session. */
export function clearResumeDrafts() {
	for (const [id, runtime] of runtimes) {
		runtime.pendingResume = undefined;
		runtime.syncResume.cancel();
		cleanupRuntime(id);
	}
	useResumeStore.getState().reset();
}

function syncCurrentResume(id: string) {
	const resume = useResumeStore.getState().resume;
	if (!resume || resume.id !== id) return;

	getRuntime(id).syncResume(resume);
}

export const useResumeStore = create<ResumeStore>()(
	immer((set, get) => ({
		resume: null,
		resumeId: undefined,
		isReady: false,
		saveStatus: "idle",
		proposalApplications: {},
		undoStack: [],
		redoStack: [],

		initialize: (resume) => {
			if (resume) setRuntimeBaseline(resume);
			resetHistoryRuntime();

			// Changes that couldn't be saved last time (offline, closed tab) come back and are sent again.
			const unsaved = resume ? readUnsavedResume(resume.id) : undefined;
			const pending = readProposalApplications(unsaved?.pendingProposalApplications);
			const hasPendingDecisions = Object.keys(pending).length > 0;
			const sameRevision = unsaved?.baseUpdatedAt === resume?.updatedAt.toISOString();
			const restored =
				resume && unsaved && ((!unsaved.clean && !isEqual(unsaved.data, resume.data)) || hasPendingDecisions)
					? { ...resume, data: unsaved.data }
					: null;
			if (resume) {
				const runtime = getRuntime(resume.id);
				runtime.proposalApplications = sameRevision ? readProposalApplications(unsaved?.proposalApplications) : pending;
				runtime.pendingProposalApplications = pending;
				if (unsaved) runtime.restoredDraft = { key: unsaved.key, raw: unsaved.raw };
				// What an older app's recovery holds is sent on its terms (see Runtime.proposalSafety).
				if (restored) runtime.proposalSafety = unsaved?.proposalSafety === "v1" ? "v1" : undefined;
			}
			if (resume && unsaved && !restored) clearUnsavedResume(resume);
			// Matching text cannot acknowledge a queued decision from another document revision.
			const conflict = !!restored && !sameRevision;

			set((state) => {
				state.proposalApplications = resume ? getRuntime(resume.id).proposalApplications : {};
				state.resume = restored ?? resume;
				state.resumeId = resume?.id;
				state.isReady = resume !== null;
				state.saveStatus = conflict ? "conflict" : "saved";
				clearHistory(state);
			});

			if (resume && !restored && Object.keys(getRuntime(resume.id).pendingProposalApplications).length > 0)
				queueResumeSave(resume);
			if (restored) {
				toast.add({
					type: "info",
					description: t`Restored changes that hadn't been saved yet.`,
					id: "resume-restored-unsaved",
				});
				const runtime = getRuntime(restored.id);
				runtime.baseUpdatedAt = unsaved?.baseUpdatedAt ? new Date(unsaved.baseUpdatedAt) : undefined;
				runtime.conflict = conflict;
				runtime.hasPendingLocalChanges = true;
				storeUnsavedResume(restored);
				if (!conflict) queueResumeSave(restored);
			}
		},

		reset: () => {
			resetHistoryRuntime();

			set((state) => {
				state.proposalApplications = {};
				state.resume = null;
				state.resumeId = undefined;
				state.isReady = false;
				state.saveStatus = "idle";
				clearHistory(state);
			});
		},

		replaceResumeFromServer: (resume) => {
			const runtime = getRuntime(resume.id);
			if (runtime.hasPendingLocalChanges) {
				get().mergeResumeMetadata(resume);
				return;
			}
			const externalRevision = runtime.baseUpdatedAt?.getTime() !== resume.updatedAt.getTime();
			if (externalRevision) {
				runtime.proposalApplications = {};
				runtime.pendingProposalApplications = {};
			}
			setRuntimeBaseline(resume);

			// This runs both for the echo of our own autosave (identical data → keep history) and for
			// external/cross-tab/AI rebases (different data → local undo history no longer applies).
			const current = get().resume;
			// An echo keeps the data object the store already holds: a new but identical one would make everything that
			// renders from it run again, the preview's PDF render of every page included, after every save.
			const keptData = current && isEqual(current.data, resume.data) ? current.data : undefined;
			const isRebase = keptData === undefined || externalRevision;
			if (isRebase) resetHistoryRuntime();

			set((state) => {
				state.proposalApplications = runtime.proposalApplications;
				state.resume = keptData ? { ...resume, data: keptData } : resume;
				state.resumeId = resume.id;
				state.isReady = true;
				state.saveStatus = "saved";

				if (isRebase) clearHistory(state);
			});
			if (externalRevision) clearUnsavedResume(resume);
		},

		patchResume: (fn) => {
			set((state) => {
				if (!state.resume) return;
				fn(state.resume as WritableDraft<Resume>);
			});
		},

		setSaveStatus: (status) => {
			set((state) => {
				state.saveStatus = status;
			});
		},

		mergeResumeMetadata: (resume) => {
			set((state) => {
				if (!state.resume || state.resume.id !== resume.id) return;

				state.resume.name = resume.name;
				state.resume.slug = resume.slug;
				state.resume.tags = resume.tags;
				state.resume.isLocked = resume.isLocked;
				state.resume.updatedAt = resume.updatedAt;
				state.resume.hasPassword = resume.hasPassword;
				state.resume.isPublic = resume.isPublic;
				state.resume.showDownloadButtons = resume.showDownloadButtons;
			});
		},

		updateResumeData: (fn, options = {}) => {
			const currentResume = get().resume;
			if (!currentResume) return;

			if (currentResume.isLocked) {
				warnLocked();
				return;
			}

			// Coalesce bursts: only the first edit of a burst opens a new undo step, holding the pre-edit
			// state. Later edits to the same field fold into it (see shouldCoalesceEdit).
			const now = Date.now();
			const newStep = options.newStep ?? false;
			const coalesce =
				options.sameStep && options.coalesceKey !== undefined && historyLastKey === options.coalesceKey
					? true
					: shouldCoalesceEdit(
							{ at: historyLastEditAt, key: historyLastKey, canCoalesce: historyCanCoalesce },
							{ at: now, key: options.coalesceKey, newStep },
						);
			const snapshotBefore = coalesce ? undefined : currentResume.data;
			historyLastEditAt = now;
			historyLastKey = options.coalesceKey;
			historyCanCoalesce = !newStep;

			set((state) => {
				if (!state.resume) return;

				if (snapshotBefore) {
					state.undoStack.push({ data: snapshotBefore, applications: state.proposalApplications });
					if (state.undoStack.length > MAX_HISTORY_ENTRIES) state.undoStack.shift();
					// A fresh edit invalidates the redo branch.
					state.redoStack = [];
				}

				fn(state.resume.data as WritableDraft<ResumeData>);
				if (options.applied?.length)
					state.proposalApplications = { ...state.proposalApplications, ...appliedApplications(options.applied) };
				// The server writes the date text from the dates on save; doing the same here keeps its echo
				// identical to the draft, so an autosave never reads as an outside change.
				syncResumeDates(state.resume.data as ResumeData);
				if (!getRuntime(currentResume.id).conflict) state.saveStatus = "saving";
			});

			const edited = get().resume;
			if (edited) {
				const runtime = getRuntime(edited.id);
				runtime.pendingProposalApplications = queueProposalApplications(
					runtime.proposalApplications,
					get().proposalApplications,
					runtime.pendingProposalApplications,
				);
				runtime.proposalApplications = get().proposalApplications;
				storeUnsavedResume(edited);
			}
			getRuntime(currentResume.id).hasPendingLocalChanges = true;
			syncCurrentResume(currentResume.id);
		},

		undo: () => {
			applyHistoryStep(get, set, "undo");
		},

		redo: () => {
			applyHistoryStep(get, set, "redo");
		},

		reloadFromServer: async () => {
			const current = get().resume;
			if (!current) return;
			const runtime = getRuntime(current.id);
			if (!runtime.conflict || runtime.reloading) return;
			runtime.reloading = true;
			storeUnsavedResume(current);
			const options = { signal: runtime.abortController.signal };
			try {
				const name = t`${current.name} (mine)`.slice(0, 100);
				runtime.copyId ??= await orpc.resume.import.call({ data: current.data }, options);
				await orpc.resume.update.call({ id: runtime.copyId, name, tags: current.tags, data: current.data }, options);
				const remote = await orpc.resume.getById.call({ id: current.id }, options);
				if (runtime.abortController.signal.aborted) return;
				if (get().resume?.id !== current.id || !isEqual(get().resume?.data, current.data))
					throw new Error(t`Your changes are still open. Try reloading again when you've finished typing.`);
				runtime.proposalApplications = {};
				runtime.pendingProposalApplications = {};
				runtime.hasPendingLocalChanges = false;
				clearUnsavedResume(current);
				get().replaceResumeFromServer(remote);
				delete runtime.copyId;
				runtime.queryClient?.setQueryData(getResumeQueryKey(current.id), remote);
				void runtime.queryClient?.invalidateQueries({ queryKey: orpc.documents.key() });
				toast.add({ type: "info", description: t`Your changes were kept in “${name}”.` });
			} finally {
				runtime.reloading = false;
			}
		},

		retrySave: () => {
			const current = get().resume;
			if (!current || getRuntime(current.id).conflict) return;
			set((state) => {
				state.saveStatus = "saving";
			});
			queueResumeSave(current);
		},
	})),
);

type ImmerSet = (fn: (state: WritableDraft<ResumeStore>) => void) => void;
type StoreGet = () => ResumeStore;

// Shared undo/redo: move the current data to the opposite stack and install the popped snapshot,
// then route the change through the normal autosave path so the preview and sync react as usual.
function applyHistoryStep(get: StoreGet, set: ImmerSet, direction: "undo" | "redo") {
	const state = get();
	const currentResume = state.resume;
	if (!currentResume) return;

	if (currentResume.isLocked) {
		warnLocked();
		return;
	}

	const source = direction === "undo" ? state.undoStack : state.redoStack;
	if (source.length === 0) return;

	// The next edit after an undo/redo must start a brand-new undo step.
	resetHistoryRuntime();
	const current = currentResume.data;

	set((draft) => {
		if (!draft.resume) return;

		const from = direction === "undo" ? draft.undoStack : draft.redoStack;
		const to = direction === "undo" ? draft.redoStack : draft.undoStack;

		const snapshot = from.pop();
		if (snapshot === undefined) return;

		to.push({ data: current as WritableDraft<ResumeData>, applications: draft.proposalApplications });
		if (to.length > MAX_HISTORY_ENTRIES) to.shift();

		draft.resume.data = snapshot.data;
		draft.proposalApplications = restoreProposalApplications(draft.proposalApplications, snapshot.applications);
		if (!getRuntime(currentResume.id).conflict) draft.saveStatus = "saving";
	});

	const edited = get().resume;
	if (edited) {
		const runtime = getRuntime(edited.id);
		runtime.pendingProposalApplications = queueProposalApplications(
			runtime.proposalApplications,
			get().proposalApplications,
			runtime.pendingProposalApplications,
		);
		runtime.proposalApplications = get().proposalApplications;
		storeUnsavedResume(edited);
	}
	getRuntime(currentResume.id).hasPendingLocalChanges = true;
	syncCurrentResume(currentResume.id);
}

// Mobile builder keeps the live preview mounted across tabs (to preserve zoom/pan), but pauses its PDF
// re-render while the Edit/Design overlay covers it — otherwise every keystroke re-renders a hidden PDF.
// Desktop never pauses. Lives here because it's the SSR-safe module both the shell and preview import.
type PreviewPausedStore = {
	paused: boolean;
	setPaused: (paused: boolean) => void;
};

export const usePreviewPausedStore = create<PreviewPausedStore>()((set) => ({
	paused: false,
	setPaused: (paused) => set({ paused }),
}));

export function usePatchResume() {
	return useResumeStore((state) => state.patchResume);
}

function useBuilderResumeSelector<T>(selector: (resume: Resume) => T): T | undefined {
	const params = useParams({ strict: false }) as { resumeId?: string };
	const resumeId = params.resumeId;

	return useResumeStore((state) => {
		if (!resumeId || !state.resume || state.resume.id !== resumeId) return undefined;
		return selector(state.resume);
	});
}

export function useCurrentBuilderResumeSelector<T>(selector: (resume: Resume) => T): T {
	const selected = useBuilderResumeSelector(selector);
	if (selected === undefined) throw new Error("Resume data is required before rendering this component.");
	return selected;
}

function useResume(): Resume | undefined {
	return useBuilderResumeSelector((resume) => resume);
}

export function useCurrentResume(): Resume {
	const resume = useResume();
	if (!resume) throw new Error("Resume data is required before rendering this component.");
	return resume;
}

export function useResumeData(): ResumeData | undefined {
	return useBuilderResumeSelector((resume) => resume.data);
}

export function useIsResumeLocked(): boolean {
	return useBuilderResumeSelector((resume) => resume.isLocked) ?? false;
}

export function useUpdateResumeData() {
	const queryClient = useQueryClient();
	const params = useParams({ strict: false }) as { resumeId?: string };
	const resumeId = params.resumeId;
	const updateResumeData = useResumeStore((state) => state.updateResumeData);

	return useCallback(
		(fn: (draft: WritableDraft<ResumeData>) => void, options?: UpdateResumeDataOptions) => {
			if (!resumeId) return;
			bindRuntimeQueryClient(resumeId, queryClient);
			updateResumeData(fn, options);
		},
		[queryClient, resumeId, updateResumeData],
	);
}

export function useResumeUpdateSubscription({ resumeId, onUpdate, onError }: ResumeUpdateSubscriptionOptions) {
	const [retryNonce, setRetryNonce] = useState(0);

	// oxlint-disable-next-line react/exhaustive-deps -- retryNonce isn't read; bumping it resubscribes after a dropped stream
	useEffect(() => {
		if (!resumeId) return;

		let didCancel = false;
		let retryTimer: number | undefined;
		const cancel = consumeEventIterator(streamClient.resume.updates.subscribe({ id: resumeId }), {
			onEvent: async (event) => {
				const update = (event ?? { mutation: "sync" }) as ResumeUpdateEvent;
				try {
					await onUpdate(update);
				} catch (error) {
					if (error instanceof DOMException && error.name === "AbortError") return;
					onError?.(error);
				}
			},
			onError: (error) => {
				if (didCancel) return;
				// A signed-out session stays signed out; retrying would only repeat the 401.
				if (error instanceof ORPCError && error.code === "UNAUTHORIZED") return;
				onError?.(error);
				retryTimer = window.setTimeout(() => setRetryNonce((value) => value + 1), 2500);
			},
		});

		return () => {
			didCancel = true;
			if (retryTimer) window.clearTimeout(retryTimer);
			void cancel().catch(() => {});
		};
	}, [onError, onUpdate, resumeId, retryNonce]);
}

export function useBuilderResumeUpdateSubscription() {
	const queryClient = useQueryClient();
	const replaceResumeFromServer = useResumeStore((state) => state.replaceResumeFromServer);
	const params = useParams({ strict: false }) as { resumeId?: string };
	const resumeId = params.resumeId;

	const onUpdate = useCallback(
		async (event: ResumeUpdateEvent) => {
			if (!resumeId) return;

			bindRuntimeQueryClient(resumeId, queryClient);
			const resume = (await orpc.resume.getById.call({ id: resumeId })) as Resume;

			const runtime = runtimes.get(resumeId);
			if (
				!runtime ||
				useResumeStore.getState().resume?.id !== resumeId ||
				(runtime.baseUpdatedAt && resume.updatedAt < runtime.baseUpdatedAt)
			)
				return;
			queryClient.setQueryData(getResumeQueryKey(resumeId), resume);

			if (hasPendingLocalChanges(resumeId)) {
				useResumeStore.getState().mergeResumeMetadata(resume);
				return;
			}

			const current = useResumeStore.getState().resume;
			const isExternalChange = current?.id === resume.id && !isEqual(current.data, resume.data);

			if (!isExternalChange) {
				replaceResumeFromServer(resume);
				return;
			}

			// #54: never overwrite a field the user is editing; defer the swap until blur.
			if (isEditableElementFocused()) {
				useResumeStore.getState().mergeResumeMetadata(resume);
				deferRemoteResumeUntilBlur(resumeId, resume);
				return;
			}

			// #53: attribute cross-tab / AI-agent edits instead of silently swapping the document.
			replaceResumeFromServer(resume);
			notifyExternalUpdate(event.mutation);
		},
		[queryClient, replaceResumeFromServer, resumeId],
	);

	const onError = useCallback((error: unknown) => {
		console.warn("Resume update stream failed, reconnecting:", error);
	}, []);

	useResumeUpdateSubscription({ resumeId, onUpdate, onError });
}

/**
 * Saves pending edits now and resolves once they're on the server (false if saving fails). Route transitions
 * await it before leaving, and History before naming or restoring a version, so the server has what's on
 * screen. Unmount cleanup and browser unload can't await it.
 */
export function savePendingChanges(id: string): boolean | Promise<boolean> {
	const runtime = runtimes.get(id);
	const current = useResumeStore.getState().resume;
	if (!runtime?.hasPendingLocalChanges || current?.id !== id) return true;
	if (runtime.conflict) return false;

	runtime.syncResume.cancel();
	runtime.pendingResume = structuredClone(current);
	useResumeStore.getState().setSaveStatus("saving");

	return new Promise<boolean>((resolve) => {
		const finish = (saved: boolean) => {
			clearTimeout(timeout);
			unsubscribe();
			if (!saved && isBrowserOffline()) {
				toast.add({
					type: "info",
					description: t`You're offline. Reconnect to save your changes before leaving.`,
					id: "resume-offline-navigation",
				});
			}
			resolve(saved);
		};
		const unsubscribe = useResumeStore.subscribe((state) => {
			if (
				state.resume?.id !== id ||
				state.saveStatus === "error" ||
				state.saveStatus === "offline" ||
				state.saveStatus === "conflict"
			) {
				finish(false);
			} else if (state.saveStatus === "saved" && !runtime.hasPendingLocalChanges) {
				finish(true);
			}
		});
		const timeout = setTimeout(() => {
			finish(false);
			// Keep the write in flight: it may already have reached the server.
			runtime.slowSaveToastId = toast.add({
				type: "info",
				description: t`Saving is taking longer than expected. Your changes are still open.`,
				id: runtime.slowSaveToastId,
				timeout: 0,
			});
		}, NAVIGATION_SAVE_WAIT_MS);
		void flushResumeSave(id);
	});
}

export function useResumeCleanup() {
	const params = useParams({ strict: false }) as { resumeId?: string };
	const resumeId = params.resumeId;
	const reset = useResumeStore((state) => state.reset);

	useBlocker({
		shouldBlockFn: async ({ next }) => {
			if (!resumeId || ("resumeId" in next.params && next.params.resumeId === resumeId)) return false;
			return !(await savePendingChanges(resumeId));
		},
		enableBeforeUnload: () => !!resumeId && (runtimes.get(resumeId)?.hasPendingLocalChanges ?? false),
	});

	useEffect(() => {
		if (!resumeId) return;

		return () => {
			cleanupRuntime(resumeId);
			reset();
		};
	}, [resumeId, reset]);
}
