import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { WritableDraft } from "immer";
import { t } from "@lingui/core/macro";
import { consumeEventIterator } from "@orpc/client";
import { useQueryClient } from "@tanstack/react-query";
import { useBlocker, useParams } from "@tanstack/react-router";
import { debounce, isEqual } from "es-toolkit";
import { useCallback, useEffect, useState } from "react";
import { immer } from "zustand/middleware/immer";
import { create } from "zustand/react";
import { syncResumeDates } from "@reactive-resume/schema/resume/dates";
import { toast } from "@reactive-resume/ui/components/toast";
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
	/** The job application this resume was made for; Check's Job match reads its posting. */
	applicationId?: string | null;
};

// Mirrors the server-side ResumeUpdatedEvent discriminator (packages/api resume/events.ts).
type ResumeUpdateMutation = "sync" | "create" | "update" | "patch" | "lock" | "password" | "delete";
type ResumeUpdateEvent = { mutation: ResumeUpdateMutation };

/**
 * `offline`: the browser is offline; changes are kept on this device and sent when it reconnects.
 * `error`: the server rejected or couldn't be reached while online; changes are kept on this device
 * and the editor offers Retry.
 */
type SaveStatus = "idle" | "saving" | "saved" | "offline" | "error";

type UpdateResumeDataOptions = {
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
	undoStack: ResumeData[];
	redoStack: ResumeData[];
	canUndo: boolean;
	canRedo: boolean;
};

type ResumeStoreActions = {
	initialize: (resume: Resume | null) => void;
	reset: () => void;
	replaceResumeDraft: (resume: Resume) => void;
	replaceResumeFromServer: (resume: Resume) => void;
	updateResumeData: (fn: (draft: WritableDraft<ResumeData>) => void, options?: UpdateResumeDataOptions) => void;
	patchResume: (fn: (draft: WritableDraft<Resume>) => void) => void;
	mergeResumeMetadata: (resume: Resume) => void;
	setSaveStatus: (status: SaveStatus) => void;
	undo: () => void;
	redo: () => void;
	/** Sends the latest unsaved changes again, e.g. from the "Not saved · Retry" status. */
	retrySave: () => void;
};

type ResumeStore = ResumeStoreState & ResumeStoreActions;

type Runtime = {
	abortController: AbortController;
	queryClient?: QueryClient;
	hasPendingLocalChanges: boolean;
	isSaving: boolean;
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

// Unsaved changes survive a reload or a closed tab: they're kept on this device until a save succeeds.
function storeUnsavedResume(resume: Resume) {
	try {
		window.localStorage.setItem(
			`${UNSAVED_STORAGE_PREFIX}${resume.id}`,
			JSON.stringify({ data: resume.data, storedAt: Date.now() }),
		);
	} catch {
		// Storage can be full or blocked; the in-memory copy still retries.
	}
}

function clearUnsavedResume(id: string) {
	try {
		window.localStorage.removeItem(`${UNSAVED_STORAGE_PREFIX}${id}`);
	} catch {
		// Nothing to clear.
	}
}

export function readUnsavedResumeData(id: string): ResumeData | undefined {
	try {
		const raw = window.localStorage.getItem(`${UNSAVED_STORAGE_PREFIX}${id}`);
		if (!raw) return undefined;
		const parsed = JSON.parse(raw) as { data?: ResumeData };
		return parsed.data;
	} catch {
		return undefined;
	}
}

function isBrowserOffline() {
	return typeof navigator !== "undefined" && navigator.onLine === false;
}

let lockedToastId: string | undefined;

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

	// The user may have started editing again while the update was deferred; local edits win.
	if (runtime.hasPendingLocalChanges) return;

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
}

async function flushResumeSave(id: string) {
	const runtime = runtimes.get(id);
	if (!runtime || runtime.isSaving || !runtime.pendingResume) return;

	const submitted = runtime.pendingResume;
	const submittedData = structuredClone(submitted.data);
	runtime.pendingResume = undefined;
	runtime.isSaving = true;

	try {
		const updated = (await orpc.resume.update.call(
			{ id: submitted.id, data: submittedData, sessionId: runtime.sessionId },
			{ signal: runtime.abortController.signal },
		)) as Resume;

		runtime.queryClient?.setQueryData(getResumeQueryKey(submitted.id), updated);

		const currentResume = useResumeStore.getState().resume;
		const currentDataStillMatchesSubmission =
			currentResume?.id === submitted.id && isEqual(currentResume.data, submittedData);

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
		if (!runtime.pendingResume && !runtime.hasPendingLocalChanges) clearUnsavedResume(submitted.id);
	} catch (error: unknown) {
		if (error instanceof DOMException && error.name === "AbortError") return;

		runtime.pendingResume ??= submitted;
		runtime.hasPendingLocalChanges = true;
		runtime.saveFailed = true;
		storeUnsavedResume(useResumeStore.getState().resume ?? submitted);
		// The editor bar shows the state ("Offline · saved on this device" or "Not saved · Retry").
		useResumeStore.getState().setSaveStatus(isBrowserOffline() ? "offline" : "error");
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
		abortController,
		hasPendingLocalChanges: false,
		isSaving: false,
		saveFailed: false,
		syncResume,
		sessionId: crypto.randomUUID(),
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
		undoStack: [],
		redoStack: [],
		canUndo: false,
		canRedo: false,

		initialize: (resume) => {
			if (resume) setRuntimeBaseline(resume);
			resetHistoryRuntime();

			// Changes that couldn't be saved last time (offline, closed tab) come back and are sent again.
			const unsaved = resume ? readUnsavedResumeData(resume.id) : undefined;
			const restored = resume && unsaved && !isEqual(unsaved, resume.data) ? { ...resume, data: unsaved } : null;
			if (resume && unsaved && !restored) clearUnsavedResume(resume.id);

			set((state) => {
				state.resume = restored ?? resume;
				state.resumeId = resume?.id;
				state.isReady = resume !== null;
				state.undoStack = [];
				state.redoStack = [];
				state.canUndo = false;
				state.canRedo = false;
			});

			if (restored) {
				toast.add({
					type: "info",
					description: t`Restored changes that hadn't been saved yet.`,
					id: "resume-restored-unsaved",
				});
				queueResumeSave(restored);
			}
		},

		reset: () => {
			resetHistoryRuntime();

			set((state) => {
				state.resume = null;
				state.resumeId = undefined;
				state.isReady = false;
				state.undoStack = [];
				state.redoStack = [];
				state.canUndo = false;
				state.canRedo = false;
			});
		},

		replaceResumeDraft: (resume) => {
			resetHistoryRuntime();

			set((state) => {
				state.resume = resume;
				state.resumeId = resume.id;
				state.isReady = true;
				state.undoStack = [];
				state.redoStack = [];
				state.canUndo = false;
				state.canRedo = false;
			});
		},

		replaceResumeFromServer: (resume) => {
			setRuntimeBaseline(resume);

			// This runs both for the echo of our own autosave (identical data → keep history) and for
			// external/cross-tab/AI rebases (different data → local undo history no longer applies).
			const current = get().resume;
			const isRebase = !current || !isEqual(current.data, resume.data);
			if (isRebase) resetHistoryRuntime();

			set((state) => {
				state.resume = resume;
				state.resumeId = resume.id;
				state.isReady = true;

				if (isRebase) {
					state.undoStack = [];
					state.redoStack = [];
					state.canUndo = false;
					state.canRedo = false;
				}
			});
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
				lockedToastId = toast.add({
					type: "error",
					description: t`This resume is locked and cannot be updated.`,
					id: lockedToastId,
				});
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
					state.undoStack.push(snapshotBefore);
					if (state.undoStack.length > MAX_HISTORY_ENTRIES) state.undoStack.shift();
					// A fresh edit invalidates the redo branch.
					state.redoStack = [];
				}

				fn(state.resume.data as WritableDraft<ResumeData>);
				// The server writes the date text from the dates on save; doing the same here keeps its echo
				// identical to the draft, so an autosave never reads as an outside change.
				syncResumeDates(state.resume.data as ResumeData);
				state.saveStatus = "saving";
				state.canUndo = state.undoStack.length > 0;
				state.canRedo = state.redoStack.length > 0;
			});

			getRuntime(currentResume.id).hasPendingLocalChanges = true;
			syncCurrentResume(currentResume.id);
		},

		undo: () => {
			applyHistoryStep(get, set, "undo");
		},

		redo: () => {
			applyHistoryStep(get, set, "redo");
		},

		retrySave: () => {
			const current = get().resume;
			if (!current) return;
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
		lockedToastId = toast.add({
			type: "error",
			description: t`This resume is locked and cannot be updated.`,
			id: lockedToastId,
		});
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

		to.push(current as WritableDraft<ResumeData>);
		if (to.length > MAX_HISTORY_ENTRIES) to.shift();

		draft.resume.data = snapshot;
		draft.saveStatus = "saving";
		draft.canUndo = draft.undoStack.length > 0;
		draft.canRedo = draft.redoStack.length > 0;
	});

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

			queryClient.setQueryData(getResumeQueryKey(resumeId), resume);

			if (hasPendingLocalChanges(resumeId)) {
				useResumeStore.getState().mergeResumeMetadata(resume);
				return;
			}

			const current = useResumeStore.getState().resume;
			const isExternalChange =
				event.mutation !== "sync" && current?.id === resume.id && !isEqual(current.data, resume.data);

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
			if (state.resume?.id !== id || state.saveStatus === "error" || state.saveStatus === "offline") {
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
