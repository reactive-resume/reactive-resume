import type { DraftState, SaveResult } from "./state";
// Data for the application workspace, ported from apps/web/src/features/career/hooks.ts. Query keys append the
// server origin, as the other mobile features do, and stay under the oRPC prefixes so Career writes refresh them.
import type { RouterOutput } from "@/api/client";
import type { CareerWorkspace, GenerateTask } from "@reactive-resume/schema/career";
import type { QueryClient } from "@tanstack/react-query";
import type { SetStateAction } from "react";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { ORPCError } from "@orpc/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Storage from "expo-sqlite/kv-store";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { EMPTY_WORKSPACE } from "@reactive-resume/schema/career";
import { createAutosave, createDraftStore, nextDraftState, saveFailure } from "./state";
import { orpc } from "@/api/client";
import { getServer, useSession } from "@/auth/session";
import { getDraftScope } from "@/draft";
import { useHasAIProvider } from "@/features/ai/providers";
import { showToast } from "@/ui";

export type SavedItem = RouterOutput["career"]["savedItems"][number];
export type SavedData<K extends SavedItem["data"]["kind"]> = Extract<SavedItem["data"], { kind: K }>;
export type Fact = RouterOutput["career"]["facts"][number];
export type Story = RouterOutput["career"]["stories"][number];

/** The server's own message when it explains the problem (web `allowServerMessage`), otherwise `fallback`. */
export function workspaceError(error: unknown, fallback: string) {
	if (error instanceof ORPCError && error.message && error.code !== "INTERNAL_SERVER_ERROR") return error.message;
	return fallback;
}

function useSignedIn() {
	const session = useSession();
	return { server: session.server, enabled: session.status === "signed-in" };
}

const workspaceKey = (applicationId: string, server: string) => [
	...orpc.career.workspace.queryKey({ input: { applicationId } }),
	server,
];

const workspaceWrites = new WeakMap<QueryClient, Map<string, Set<Promise<unknown>>>>();

/**
 * One application's live workspace state. Saves are optimistic and run one at a time per application; a failure
 * explains the problem and refetches once queued writes finish, while text fields keep their local drafts.
 */
export function useWorkspace(applicationId: string) {
	const queryClient = useQueryClient();
	const { server, enabled } = useSignedIn();
	const queryKey = workspaceKey(applicationId, server);
	const query = useQuery({
		...orpc.career.workspace.queryOptions({ input: { applicationId } }),
		queryKey,
		enabled,
	});
	let byApplication = workspaceWrites.get(queryClient);
	if (!byApplication) workspaceWrites.set(queryClient, (byApplication = new Map()));
	const scope = `${server}:${applicationId}`;
	let writes = byApplication.get(scope);
	if (!writes) byApplication.set(scope, (writes = new Set()));
	const pending = writes;
	const mutation = useMutation({
		...orpc.career.saveWorkspace.mutationOptions(),
		// One at a time per application, and no refetch between them: a refetch landing between two quick ticks would
		// hand the second save a copy without the first.
		scope: { id: `career-workspace:${scope}` },
		onError: (error) =>
			showToast({
				message: workspaceError(error, t`Couldn't save that change. Check your connection and try again.`),
			}),
	});
	const current = () => queryClient.getQueryData<CareerWorkspace>(queryKey) ?? EMPTY_WORKSPACE;
	/** Resolves once the server confirmed the change, or with why it failed (already reported). Never rejects. */
	const save = (patch: Partial<CareerWorkspace>): Promise<SaveResult> => {
		if (getServer() !== server) return Promise.resolve({ ok: false, transient: false, code: "SERVER_CHANGED" });
		const previous = current();
		const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
		const expected = Object.fromEntries(
			Object.keys(defined).map((key) => [key, previous[key as keyof CareerWorkspace]]),
		);
		// Capture and publish synchronously, so another control's immediate write builds on this one.
		void queryClient.cancelQueries({ queryKey });
		queryClient.setQueryData(queryKey, { ...previous, ...defined });
		const write = mutation.mutateAsync({ applicationId, ...defined, expected });
		pending.add(write);
		return write.then(
			(): SaveResult => {
				pending.delete(write);
				return { ok: true };
			},
			(error: unknown) => {
				pending.delete(write);
				void Promise.allSettled(pending).then(() => queryClient.invalidateQueries({ queryKey }));
				return saveFailure(error);
			},
		);
	};
	return {
		data: query.data ?? EMPTY_WORKSPACE,
		query,
		isPending: query.isPending,
		/** The latest copy, including saves still in flight, for a change that commits later (after an Undo toast). */
		current,
		save,
		/**
		 * A copy the server confirmed: queued writes finish, then a fresh fetch (`staleTime: 0`) replaces whatever the
		 * cache holds, optimistic values included. Rejects when it can't be fetched.
		 */
		fetchConfirmed: async () => {
			while (pending.size > 0) await Promise.allSettled(pending);
			return queryClient.fetchQuery({
				...orpc.career.workspace.queryOptions({ input: { applicationId } }),
				queryKey,
				staleTime: 0,
			});
		},
		/** Finish queued writes before an action that reads the authoritative workspace. */
		settled: async () => {
			while (pending.size > 0) await Promise.allSettled(pending);
			return current();
		},
		queryKey,
	};
}

/** Toggles one row of a ticked list in the workspace ("plan:{id}", "now:{interviewId}", "week:{id}"). */
export function useTicks(applicationId: string, key: string) {
	const workspace = useWorkspace(applicationId);
	return {
		ticked: workspace.data.ticks[key] ?? [],
		toggle: (row: string, on: boolean) => {
			const ticks = workspace.current().ticks;
			const rows = ticks[key] ?? [];
			workspace.save({
				ticks: { ...ticks, [key]: on ? [...new Set([...rows, row])] : rows.filter((item) => item !== row) },
			});
		},
	};
}

export function useSavedItems(applicationId: string) {
	const { server, enabled } = useSignedIn();
	const options = orpc.career.savedItems.queryOptions({ input: { applicationId } });
	return useQuery({ ...options, queryKey: [...options.queryKey, server], enabled });
}

export function useFacts(applicationId: string, enabled = true) {
	const { server, enabled: signedIn } = useSignedIn();
	const options = orpc.career.facts.queryOptions({ input: { applicationId } });
	return useQuery({ ...options, queryKey: [...options.queryKey, server], enabled: signedIn && enabled });
}

export function useStories(applicationId: string, enabled = true) {
	const { server, enabled: signedIn } = useSignedIn();
	const options = orpc.career.stories.queryOptions({ input: { applicationId } });
	return useQuery({ ...options, queryKey: [...options.queryKey, server], enabled: signedIn && enabled });
}

export function useSchedules() {
	const { server, enabled } = useSignedIn();
	const options = orpc.career.schedules.queryOptions({ input: {} });
	return useQuery({ ...options, queryKey: [...options.queryKey, server], enabled });
}

/** The newest saved item of one kind, optionally for one interview. */
export function latest<K extends SavedItem["data"]["kind"]>(
	items: SavedItem[] | undefined,
	kind: K,
	interviewId?: string | null,
) {
	return items?.find(
		(item): item is SavedItem & { data: SavedData<K> } =>
			item.data.kind === kind && (interviewId === undefined || item.interviewId === interviewId),
	);
}

/**
 * Asks the coach for one structured piece of work for a tab. Errors say what didn't run; stored data stays usable.
 */
export function useGenerate(applicationId: string) {
	const { i18n } = useLingui();
	const queryClient = useQueryClient();
	const connection = useHasAIProvider();
	const name = connection.defaultProvider?.label ?? t`Your AI connection`;
	const mutation = useMutation({
		...orpc.career.generate.mutationOptions(),
		onSuccess: (result) => {
			if (result.item) void queryClient.invalidateQueries({ queryKey: orpc.career.savedItems.key() });
		},
		onError: (error) =>
			showToast({ message: workspaceError(error, t`${name} didn't respond. Nothing was changed; try again.`) }),
	});
	return {
		...mutation,
		run: (task: GenerateTask) => {
			if (connection.isUnavailable)
				return Promise.reject(new Error(t`AI connections haven't loaded. Try again before generating.`));
			return mutation.mutateAsync({ applicationId, locale: i18n.locale, task });
		},
	};
}

type TextDraft = ReturnType<typeof useDraft<string>>;

/**
 * Saves text a moment after typing stops (2 s), on blur (`flush`) and when leaving. Transient failures retry up to 3
 * times (5, 10, 20 s). A permanent one (4xx, conflict) stops and sets `error`; with a `draft`, it is kept on the device
 * with the text, so reopening the screen (or the app) shows it again and still waits for `retry` or
 * `takeServerVersion`. The draft clears only when the server confirmed that exact value.
 */
export function useAutosave(
	value: string,
	saved: string,
	save: (value: string) => Promise<SaveResult>,
	draft?: TextDraft,
	/** The field's value in a freshly fetched, server-confirmed copy ("Use server version"). */
	fetchServer?: () => Promise<string>,
) {
	const [resolve, setResolve] = useState<"idle" | "loading" | "failed">("idle");
	const latest = useRef({ save, draft });
	useLayoutEffect(() => {
		latest.current = { save, draft };
	});
	const [error, setError] = useState<string | null>(null);
	const [autosave] = useState(() =>
		createAutosave({
			save: (next) => latest.current.save(next),
			onSaved: (next) => latest.current.draft?.clear(next),
			onError: (block) => {
				setError(block?.code ?? null);
				if (!block) latest.current.draft?.setBlocked(null);
				else if (block.permanent) latest.current.draft?.setBlocked({ value: block.value, code: block.code });
			},
			delay: 2000,
			retryDelay: 5000,
			maxRetries: 3,
			timers: {
				set: (run, ms) => setTimeout(run, ms),
				clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
			},
		}),
	);
	// Before `update`: a conflict kept on the device must be in place before the restored draft could be sent.
	const blocked = draft?.blocked ?? null;
	const blockedValue = blocked?.value;
	const blockedCode = blocked?.code;
	useEffect(() => {
		if (blockedValue !== undefined && blockedCode !== undefined)
			autosave.block({ value: blockedValue, code: blockedCode });
	}, [autosave, blockedValue, blockedCode]);
	useEffect(() => autosave.update(value, saved), [autosave, value, saved]);
	useEffect(() => {
		const listener = AppState.addEventListener("change", (state) => {
			if (state !== "active") autosave.flush();
		});
		return () => {
			listener.remove();
			autosave.dispose();
		};
	}, [autosave]);
	return {
		flush: autosave.flush,
		retry: autosave.retry,
		/**
		 * Replaces the draft with the server's confirmed copy (`fetchServer`, never the optimistic cache). Saving stays
		 * blocked while it loads, and stays blocked with `resolveFailed` if it can't be loaded.
		 */
		takeServerVersion: fetchServer
			? async () => {
					setResolve("loading");
					try {
						await autosave.takeServerVersion(fetchServer, (server) => latest.current.draft?.reset(server));
						setResolve("idle");
					} catch {
						setResolve("failed");
					}
				}
			: undefined,
		resolving: resolve === "loading",
		resolveFailed: resolve === "failed",
		error,
	};
}

const draftStore = createDraftStore(Storage);
/** Suffix of the key that keeps a draft's permanent save failure (conflict) next to it. */
const BLOCKED = "#save-error";
type Blocked = { value: string; code: string };
/** The key prefix of every workspace draft for one account; sign-out cleanup can sweep it. */
export const draftPrefix = (scope: string) => `reactive-resume:career-draft:${scope}:`;

/**
 * Writes and clears check the account again when they run: a draft never lands under, or removes, another identity's
 * key. A newer write for the same key wins over an older one still resolving.
 */
const writeTurns = new Map<string, number>();
function writeDraft(scope: string, key: string, value: unknown) {
	const turn = (writeTurns.get(key) ?? 0) + 1;
	writeTurns.set(key, turn);
	void getDraftScope().then((now) => {
		if (now === scope && writeTurns.get(key) === turn) draftStore.write(key, value);
	});
}
function clearDraftAt(scope: string, key: string, sent: unknown) {
	const turn = writeTurns.get(key) ?? 0;
	void getDraftScope().then((now) => {
		// A write queued after this clear was asked for is newer than `sent`: leave it.
		if (now !== scope || (writeTurns.get(key) ?? 0) !== turn) return;
		draftStore.clear(key, sent);
		// No draft left, so no conflict to wait on.
		if (draftStore.read(key) === undefined) draftStore.clear(`${key}${BLOCKED}`);
	});
}

/** Clears a draft by name for the signed-in account, once the server confirmed `sent` (Mark as applied). */
export function clearDraft(name: string, sent: unknown) {
	void getDraftScope().then((scope) => {
		if (scope !== null) clearDraftAt(scope, `${draftPrefix(scope)}${name}`, sent);
	});
}

/**
 * The signed-in account's draft scope (server + OAuth subject, as resume drafts and application notes use). It is
 * resolved again on every session change and never reused across identities; until it resolves, there is none.
 */
function useDraftScope() {
	const session = useSession();
	const signedIn = session.status === "signed-in";
	const [scope, setScope] = useState<{ session: typeof session; value: string | null } | null>(null);
	useEffect(() => {
		if (!signedIn) return;
		let live = true;
		void getDraftScope().then((value) => {
			if (live) setScope({ session, value });
		});
		return () => {
			live = false;
		};
	}, [signedIn, session]);
	// No scope (signed out, re-checking, or the token can't name the account) keeps drafts on screen only.
	return signedIn && scope?.session === session ? scope.value : null;
}

/**
 * A draft kept on the device until the server or the coach has it: it survives leaving the screen and restarting the
 * app, scoped by server and account. `clear(sent)` removes it only while it is still that revision.
 */
export function useDraft<T>(name: string | null, initial: T, reviewOnRestore = false) {
	const scope = useDraftScope();
	const key = name !== null && scope !== null ? `${draftPrefix(scope)}${name}` : null;
	const [state, setState] = useState<DraftState<T>>(() => ({ key, owner: key, value: initial, touched: false }));
	if (state.key !== key)
		setState(nextDraftState(state, key, key === null ? undefined : draftStore.read<T>(key), initial));
	// Text typed before the account was known is written once its key resolves.
	useEffect(() => {
		if (state.key !== null && scope !== null && state.touched) writeDraft(scope, state.key, state.value);
	}, [state, scope]);
	// A permanent save failure kept with the draft (see useAutosave), per account key like the draft itself.
	const [blocked, setBlockedState] = useState<{ key: string | null; value: Blocked | null }>({ key, value: null });
	if (blocked.key !== key)
		setBlockedState({
			key,
			value:
				key === null
					? blocked.value
					: (draftStore.read<Blocked>(`${key}${BLOCKED}`) ??
						(reviewOnRestore &&
						draftStore.read<T>(key) !== undefined &&
						JSON.stringify(draftStore.read<T>(key)) !== JSON.stringify(initial)
							? { value: JSON.stringify(draftStore.read<T>(key)), code: "RECOVERED_DRAFT" }
							: null)),
		});
	const current = useRef(state);
	useLayoutEffect(() => {
		current.current = state;
	});
	const setValue = (update: SetStateAction<T>) => {
		const previous = current.current;
		const value = typeof update === "function" ? (update as (value: T) => T)(previous.value) : update;
		current.current = { ...previous, value, touched: true };
		setState(current.current);
	};
	return {
		value: state.value,
		setValue,
		/** Drops the device copy once the server confirmed `sent`; a newer edit stays. */
		clear: (sent: T) => {
			if (key !== null && scope !== null) clearDraftAt(scope, key, sent);
		},
		blocked: blocked.value,
		setBlocked: (next: Blocked | null) => {
			setBlockedState({ key, value: next });
			if (key === null || scope === null) return;
			if (next) writeDraft(scope, `${key}${BLOCKED}`, next);
			else clearDraftAt(scope, `${key}${BLOCKED}`, undefined);
		},
		/** Replaces the draft with `value` (the server copy) and forgets it and its kept failure. */
		reset: (value: T) => {
			current.current = { ...current.current, value, touched: false };
			setState(current.current);
			setBlockedState({ key, value: null });
			if (key !== null && scope !== null) clearDraftAt(scope, key, undefined);
		},
	};
}
