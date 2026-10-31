import type { DraftStore, UpdateOptions } from "./types";
import type { ProposalApplications, ProposalSnapshot } from "@reactive-resume/resume/proposals";
import type { WritableDraft } from "immer";
import { produce } from "immer";
import { create } from "zustand";
import {
	acknowledgeProposalApplications,
	queueProposalApplications,
	readProposalApplications,
	restoreProposalApplications,
} from "@reactive-resume/resume/proposals";
import { generateId } from "@reactive-resume/utils/string";

type Document = { id: string; isLocked: boolean };
type Record<D> = {
	baseline: D;
	document: D;
	sessionId: string;
	copyId?: string;
	proposalApplications?: ProposalApplications;
	pendingProposalApplications?: ProposalApplications;
};

export type DraftAdapter<D extends Document, T> = {
	kind: "resume" | "letter";
	delay: number;
	read: (id: string) => Promise<D>;
	data: (document: D) => T;
	withData: (document: D, data: T) => D;
	merge: (saved: D, submitted: D, current: D) => D;
	matches: (left: D, right: D) => boolean;
	version: (document: D) => string | number;
	parse: (value: unknown) => D;
	/** `scope` binds the write to the account that owns the draft (the API client refuses it after an account switch). */
	save: (
		document: D,
		baseline: D,
		sessionId: string,
		force: boolean,
		scope: string,
		proposalApplications?: ProposalApplications,
	) => Promise<D>;
	copy: (document: D, copyId: string | undefined, remember: (id: string) => void, scope: string) => Promise<void>;
	isConflict: (error: unknown) => boolean;
};

export type DraftEnvironment = {
	storage: {
		getItemSync: (key: string) => string | null;
		setItemSync: (key: string, value: string) => void;
		removeItemSync: (key: string) => unknown;
		getAllKeysSync: () => string[];
	};
	/** Server origin + subject, never credentials. Null while signed out. */
	scope: () => Promise<string | null>;
	online: () => boolean;
	focused: () => boolean;
};

const emptyState = {
	document: null,
	data: null,
	status: "idle",
	locked: false,
	conflict: null,
	proposalApplications: {},
	proposalRevision: null,
	canUndo: false,
	canRedo: false,
} as const;

/** Shared save owner for resumes and letters; adapters own their different API contracts. */
export function createDraftStore<D extends Document, T>(adapter: DraftAdapter<D, T>, env: DraftEnvironment) {
	let scope: string | null = null;
	let record: Record<D> | null = null;
	let dirty = false;
	let durable = true;
	// A full/unwritable disk must not discard the in-memory draft on navigation or account changes.
	const pending = new Map<string, Record<D>>();
	const pendingListeners = new Set<() => void>();
	let generation = 0;
	let editing = false;
	let deferred: D | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let persistenceTimer: ReturnType<typeof setTimeout> | undefined;
	let queueGeneration = 0;
	let inflight: Promise<void> | null = null;
	let replaying: Promise<void> | null = null;
	let resolving = false;
	let force = false;
	let undo: ProposalSnapshot<T>[] = [];
	let redo: ProposalSnapshot<T>[] = [];
	let last: { at: number; key: string | undefined; coalesce: boolean } | null = null;
	const prefix = (owner: string) => `reactive-resume:unsaved:${encodeURIComponent(owner)}:${adapter.kind}:`;
	const key = () => {
		if (!scope || !record) throw new Error("No draft is open.");
		return `${prefix(scope)}${record.document.id}`;
	};
	const store = create<DraftStore<D, T>>(() => ({
		...emptyState,
		open,
		close,
		update,
		updateDocument,
		undo: () => travel(undo, redo),
		redo: () => travel(redo, undo),
		retry: () => void flush(),
		resolveConflict,
		flush,
	}));
	const state = store.getState;

	function publish(document: D, proposalApplications: ProposalApplications = state().proposalApplications) {
		store.setState({ document, data: adapter.data(document), locked: document.isLocked, proposalApplications });
	}

	function history() {
		store.setState({ canUndo: undo.length > 0, canRedo: redo.length > 0 });
	}

	function resetHistory() {
		undo = [];
		redo = [];
		last = null;
		history();
	}

	function notifyPending() {
		for (const listener of pendingListeners) listener();
	}

	function removeStored(storageKey: string) {
		env.storage.removeItemSync(storageKey);
		pending.delete(storageKey);
		notifyPending();
	}

	function settleStored() {
		if (!record) return;
		pending.set(key(), record);
		if (Object.keys(record.proposalApplications ?? {}).length > 0) {
			// A clean recovery record retains decisions; it is not an unsaved document in the outbox.
			env.storage.setItemSync(key(), JSON.stringify(record));
			pending.delete(key());
			notifyPending();
		} else removeStored(key());
	}

	function persist() {
		clearTimeout(persistenceTimer);
		persistenceTimer = undefined;
		if (!record || !scope || !dirty) return;
		pending.set(key(), record);
		try {
			env.storage.setItemSync(key(), JSON.stringify(record));
			durable = true;
		} catch {
			durable = false;
			// Keep the in-memory draft and expose failure; never claim it is safe on disk.
			store.setState({ status: "error" });
		}
		notifyPending();
	}

	function schedulePersistence() {
		if (!record || !scope) return;
		pending.set(key(), record);
		durable = false;
		// Fixed trailing window: continuous typing still reaches disk at least every 300 ms.
		persistenceTimer ??= setTimeout(persist, 300);
	}

	function readStored(storageKey: string): Record<D> | null {
		const memory = pending.get(storageKey);
		if (memory) return memory;
		const raw = env.storage.getItemSync(storageKey);
		if (!raw) return null;
		try {
			const value = JSON.parse(raw) as Record<unknown>;
			if (typeof value.sessionId !== "string") throw new Error("Invalid draft session.");
			const baseline = adapter.parse(value.baseline);
			const document = adapter.parse(value.document);
			if (baseline.id !== document.id || !storageKey.endsWith(`:${adapter.kind}:${document.id}`))
				throw new Error("Invalid draft identity.");
			return {
				baseline,
				document,
				sessionId: value.sessionId,
				...(typeof value.copyId === "string" ? { copyId: value.copyId } : {}),
				proposalApplications: readProposalApplications(value.proposalApplications),
				pendingProposalApplications: readProposalApplications(value.pendingProposalApplications),
			};
		} catch {
			// A corrupt record cannot be restored; it must not permanently block the server copy.
			try {
				env.storage.removeItemSync(storageKey);
			} catch {
				/* Retry removal on the next open. */
			}
			return null;
		}
	}

	async function currentOwner() {
		const owner = scope;
		return owner !== null && (await env.scope()) === owner && scope === owner;
	}

	async function open(id: string) {
		if (replaying) await replaying;
		await close();
		const visit = ++generation;
		const owner = await env.scope();
		if (visit !== generation) return;
		if (!owner) throw new Error("Sign in before opening a draft.");
		scope = owner;
		try {
			const storageKey = `${prefix(owner)}${id}`;
			record = readStored(storageKey);
			if (record && pending.has(storageKey)) {
				try {
					durable = env.storage.getItemSync(storageKey) === JSON.stringify(record);
				} catch {
					durable = false;
				}
			}
			if (record && record.document.id !== id) throw new Error("Invalid draft identity.");
			if (record) {
				dirty =
					!adapter.matches(record.baseline, record.document) ||
					Object.keys(record.pendingProposalApplications ?? {}).length > 0;
				publish(record.document, record.proposalApplications ?? {});
				store.setState({ proposalRevision: adapter.version(record.baseline) });
				store.setState({ status: !dirty ? "saved" : !durable ? "error" : env.online() ? "saving" : "offline" });
			}
			if (!env.online() && record) return;
			const restored = record?.document;
			const remote = await adapter.read(id);
			if (inflight) await inflight;
			if (!(await currentOwner()) || visit !== generation) return;
			if (record && !dirty && adapter.version(remote) !== adapter.version(record.baseline)) record = null;
			if (!record) {
				record = { document: remote, baseline: remote, sessionId: generateId() };
				publish(remote, {});
				store.setState({ proposalRevision: adapter.version(remote) });
				settleStored();
			} else if (adapter.version(remote) < adapter.version(record.baseline)) {
				return;
			} else if (
				adapter.version(remote) > adapter.version(record.baseline) &&
				Object.keys(record.pendingProposalApplications ?? {}).length > 0
			) {
				// Content equality is not an acknowledgement of the queued decision.
				store.setState({ conflict: { remote }, locked: remote.isLocked, status: "error" });
			} else if (adapter.matches(remote, record.document) || (restored && adapter.matches(remote, restored))) {
				// The write may have succeeded without its response. Keep anything typed during this read.
				if (adapter.version(remote) !== adapter.version(record.baseline)) {
					record.proposalApplications = {};
					publish(record.document, {});
					store.setState({ proposalRevision: adapter.version(remote) });
				}
				record.document = adapter.merge(remote, restored ?? record.document, record.document);
				record.baseline = remote;
				dirty =
					!adapter.matches(remote, record.document) || Object.keys(record.pendingProposalApplications ?? {}).length > 0;
				publish(record.document);
				store.setState({ conflict: null, status: dirty ? "saving" : "saved" });
				if (dirty) await flush();
				else {
					clearTimeout(persistenceTimer);
					persistenceTimer = undefined;
					settleStored();
				}
			} else if (adapter.version(remote) > adapter.version(record.baseline)) {
				store.setState({ conflict: { remote }, locked: remote.isLocked, status: "error" });
			} else if (remote.isLocked) {
				store.setState({ locked: true, status: "error" });
			} else await flush();
		} catch (error) {
			if (visit !== generation) return;
			store.setState({ status: env.online() ? "error" : "offline" });
			if (!record) throw error;
		}
	}

	async function close() {
		clearTimeout(timer);
		const visit = generation;
		const active = record;
		await flush();
		if (visit !== generation || record !== active) return;
		generation++;
		record = null;
		scope = null;
		dirty = false;
		durable = true;
		deferred = null;
		editing = false;
		force = false;
		resetHistory();
		store.setState(emptyState);
	}

	function queue(document: D, applications: ProposalApplications = state().proposalApplications) {
		if (!record) return;
		record.pendingProposalApplications = queueProposalApplications(
			record.proposalApplications ?? {},
			applications,
			record.pendingProposalApplications ?? {},
		);
		record.proposalApplications = applications;
		record.document = document;
		dirty = true;
		deferred = null;
		publish(document, applications);
		store.setState({ status: env.online() ? "saving" : "offline" });
		schedulePersistence();
		clearTimeout(timer);
		timer = setTimeout(() => void flush(), adapter.delay);
	}

	function update(recipe: (draft: WritableDraft<T>) => void, options: UpdateOptions = {}) {
		if (!record || state().locked || resolving) return;
		const before = adapter.data(record.document);
		const next = produce(before, recipe);
		if (next === before) return;
		const now = Date.now();
		const coalesce =
			!options.newStep &&
			last?.coalesce &&
			last.key === options.coalesceKey &&
			((options.sameStep && options.coalesceKey !== undefined) || now - last.at < (options.coalesceKey ? 1000 : 500));
		if (!coalesce) undo = [...undo.slice(-199), { data: before, applications: state().proposalApplications }];
		redo = [];
		last = { at: now, key: options.coalesceKey, coalesce: !options.newStep };
		history();
		queue(adapter.withData(record.document, next), {
			...state().proposalApplications,
			...Object.fromEntries((options.proposalIds ?? []).map((id) => [id, true])),
		});
	}

	function updateDocument(recipe: (draft: WritableDraft<D>) => void) {
		if (!record || state().locked || resolving) return;
		const before = record.document;
		const document = produce(before, recipe);
		if (document === before) return;
		const fields = (Object.keys(document) as (keyof D)[]).filter((field) => document[field] !== before[field]);
		const rebase = (snapshot: ProposalSnapshot<T>): ProposalSnapshot<T> => {
			const historical = { ...adapter.withData(before, snapshot.data) };
			for (const field of fields) historical[field] = document[field];
			return { data: adapter.data(historical), applications: snapshot.applications };
		};
		// Letter data is the document itself: metadata edits must survive later content undo/redo.
		undo = undo.map(rebase);
		redo = redo.map(rebase);
		queue(document);
	}

	function travel(from: ProposalSnapshot<T>[], to: ProposalSnapshot<T>[]) {
		if (!record || state().locked || resolving) return;
		const next = from.pop();
		if (next === undefined) return;
		to.push({ data: adapter.data(record.document), applications: state().proposalApplications });
		if (to.length > 200) to.shift();
		last = null;
		history();
		queue(
			adapter.withData(record.document, next.data),
			restoreProposalApplications(state().proposalApplications, next.applications),
		);
	}

	async function flush(): Promise<void> {
		clearTimeout(timer);
		persist();
		if (inflight) {
			await inflight;
			return flush();
		}
		if (!record || !dirty || state().conflict || state().locked) return;
		if (!env.online()) {
			store.setState({ status: durable ? "offline" : "error" });
			return;
		}
		const active = record;
		const visit = generation;
		inflight = (async () => {
			try {
				if (!(await currentOwner()) || visit !== generation) return;
				store.setState({ status: "saving" });
				while (dirty && record === active && !state().conflict && !state().locked) {
					const submitted = active.document;
					const submittedApplications = active.pendingProposalApplications ?? {};
					const saved = await adapter.save(
						submitted,
						active.baseline,
						active.sessionId,
						force,
						scope ?? "",
						submittedApplications,
					);
					if (!(await currentOwner()) || visit !== generation) return;
					force = false;
					active.pendingProposalApplications = acknowledgeProposalApplications(
						active.pendingProposalApplications ?? {},
						submittedApplications,
					);
					active.baseline = saved;
					dirty = active.document !== submitted || Object.keys(active.pendingProposalApplications).length > 0;
					// Only local fields changed since submission overlay the server echo. Server-owned
					// revision/lock metadata always comes from the save, and typing keeps its references.
					active.document = adapter.merge(saved, submitted, active.document);
					publish(active.document);
					if (dirty) persist();
					else {
						settleStored();
						store.setState({ status: "saved" });
					}
					if (!env.online()) break;
				}
			} catch (error) {
				if (record !== active || visit !== generation) return;
				store.setState({ status: env.online() ? "error" : "offline" });
				if (adapter.isConflict(error)) {
					try {
						const remote = await adapter.read(active.document.id);
						if ((await currentOwner()) && record === active && visit === generation)
							store.setState({ conflict: { remote }, locked: remote.isLocked });
					} catch {
						/* Retry fetches the conflict again; the local draft stays intact. */
					}
				}
				persist();
			}
		})().finally(() => {
			inflight = null;
		});
		await inflight;
	}

	async function resolveConflict(choice: "keep-mine" | "use-theirs" | "keep-both") {
		if (!record || !state().conflict || resolving) return;
		resolving = true;
		const active = record;
		const visit = generation;
		try {
			if (!(await currentOwner())) throw new Error("Draft session changed.");
			const remote = await adapter.read(active.document.id);
			if (!(await currentOwner()) || record !== active || visit !== generation) return;
			if (choice === "keep-mine") {
				if (remote.isLocked) {
					store.setState({ locked: true, conflict: { remote } });
					return;
				}
				resetHistory();
				active.baseline = remote;
				active.proposalApplications = active.pendingProposalApplications ?? {};
				publish(active.document, active.proposalApplications);
				store.setState({ proposalRevision: adapter.version(remote) });
				force = true;
				store.setState({ conflict: null, locked: false });
				persist();
				await flush();
			} else {
				if (choice === "keep-both")
					await adapter.copy(
						active.document,
						active.copyId,
						(id) => {
							active.copyId = id;
							persist();
						},
						scope ?? "",
					);
				if (!(await currentOwner()) || record !== active) return;
				removeStored(key());
				record = { baseline: remote, document: remote, sessionId: active.sessionId };
				dirty = false;
				deferred = null;
				resetHistory();
				publish(remote, {});
				store.setState({ proposalRevision: adapter.version(remote) });
				store.setState({ conflict: null, status: "saved" });
			}
		} catch (error) {
			if (record === active) store.setState({ status: "error" });
			throw error;
		} finally {
			resolving = false;
		}
	}

	async function refresh() {
		if (!record || !env.online() || resolving) return;
		const active = record;
		const remote = await adapter.read(active.document.id);
		if (!(await currentOwner()) || record !== active) return;
		if (adapter.version(remote) <= adapter.version(active.baseline)) return;
		// Never advance the baseline of unsaved data in response to SSE (including our own echo).
		if (dirty || inflight) {
			store.setState({ locked: remote.isLocked });
			return;
		}
		if (editing || env.focused()) {
			deferred = remote;
			return;
		}
		applyRemote(remote);
	}

	function applyRemote(remote: D) {
		if (!record || dirty || adapter.version(remote) <= adapter.version(record.baseline)) return;
		resetHistory();
		record.baseline = remote;
		record.document = remote;
		record.proposalApplications = {};
		record.pendingProposalApplications = {};
		publish(remote, {});
		store.setState({ proposalRevision: adapter.version(remote) });
		try {
			settleStored();
		} catch {
			store.setState({ status: "error" });
		}
	}

	async function blur() {
		editing = false;
		if (deferred && !dirty) applyRemote(deferred);
		deferred = null;
		await flush();
	}

	async function replayQueue() {
		const visit = queueGeneration;
		const owner = await env.scope();
		if (!owner || !env.online() || visit !== queueGeneration) return;
		await flush();
		if (visit !== queueGeneration) return;
		for (const storageKey of new Set([...env.storage.getAllKeysSync(), ...pending.keys()])) {
			if (!storageKey.startsWith(prefix(owner)) || storageKey === (record && scope ? key() : null)) continue;
			try {
				const queued = readStored(storageKey);
				if (!queued) continue;
				if (
					adapter.matches(queued.baseline, queued.document) &&
					Object.keys(queued.pendingProposalApplications ?? {}).length === 0
				)
					continue;
				if ((await env.scope()) !== owner || visit !== queueGeneration) return;
				const saved = await adapter.save(
					queued.document,
					queued.baseline,
					queued.sessionId,
					false,
					owner,
					queued.pendingProposalApplications ?? {},
				);
				queued.document = adapter.merge(saved, queued.document, queued.document);
				if (visit !== queueGeneration) return;
				queued.baseline = saved;
				queued.pendingProposalApplications = {};
				if (Object.keys(queued.proposalApplications ?? {}).length > 0)
					env.storage.setItemSync(storageKey, JSON.stringify(queued));
				else removeStored(storageKey);
				pending.delete(storageKey);
				notifyPending();
			} catch {
				/* Conflicts, locked documents and failures stay queued until opened. */
			}
		}
	}

	function replay(): Promise<void> {
		replaying ??= replayQueue().finally(() => {
			replaying = null;
		});
		return replaying;
	}

	function reset() {
		generation++;
		clearTimeout(timer);
		clearTimeout(persistenceTimer);
		persistenceTimer = undefined;
		record = null;
		scope = null;
		dirty = false;
		durable = true;
		editing = false;
		force = false;
		deferred = null;
		resetHistory();
		store.setState(emptyState);
	}

	/** Read the same validated queue as open/replay, including writes retained after a disk failure. */
	async function listPending(): Promise<D[]> {
		const owner = await env.scope();
		if (!owner) return [];
		const documents: D[] = [];
		for (const storageKey of new Set([...env.storage.getAllKeysSync(), ...pending.keys()])) {
			if (!storageKey.startsWith(prefix(owner))) continue;
			try {
				const queued = readStored(storageKey);
				if (
					queued &&
					(!adapter.matches(queued.baseline, queued.document) ||
						Object.keys(queued.pendingProposalApplications ?? {}).length > 0)
				)
					documents.push(queued.document);
			} catch {
				/* An unreadable entry must not hide other recoverable drafts. */
			}
		}
		return (await env.scope()) === owner ? documents : [];
	}

	function clearDraftsFor(owner: string) {
		queueGeneration++;
		if (scope === owner) reset();
		try {
			for (const storageKey of pending.keys()) if (storageKey.startsWith(prefix(owner))) pending.delete(storageKey);
			for (const storageKey of env.storage.getAllKeysSync())
				if (storageKey.startsWith(prefix(owner))) env.storage.removeItemSync(storageKey);
		} finally {
			notifyPending();
		}
	}

	return {
		store,
		listPending,
		subscribePending: (listener: () => void) => {
			pendingListeners.add(listener);
			return () => pendingListeners.delete(listener);
		},
		refresh,
		replay,
		blur,
		clearDraftsFor,
		focus: () => {
			editing = true;
		},
		/** Session changes stop requests and hide the old account's in-memory draft immediately. */
		suspend: () => {
			persist();
			reset();
		},
	};
}
