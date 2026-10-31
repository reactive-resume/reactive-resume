import type { RouterOutput } from "@/libs/orpc/client";
import type { CareerWorkspace, GenerateTask } from "@reactive-resume/schema/career";
import type { QueryClient } from "@tanstack/react-query";
import type { SetStateAction } from "react";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouteContext, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { EMPTY_WORKSPACE } from "@reactive-resume/schema/career";
import { pendingCommits } from "./pending-commits";
import { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import { getAccountGeneration } from "@/libs/auth/clear-account-data";
import { toastError } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

export type SavedItem = RouterOutput["career"]["savedItems"][number];
export type Fact = RouterOutput["career"]["facts"][number];
export type Story = RouterOutput["career"]["stories"][number];
export type SavedData<K extends SavedItem["data"]["kind"]> = Extract<SavedItem["data"], { kind: K }>;

const workspaceWrites = new WeakMap<QueryClient, Map<string, Set<Promise<unknown>>>>();

/** Text drafts survive navigation and reloads in this tab, without crossing signed-in accounts. */
export function useSessionDraft<T>(
	key: string | null,
	initial: T,
	parse: (value: unknown) => T | undefined,
	reviewOnRestore = false,
) {
	const { session } = useRouteContext({ strict: false });
	const generation = useRef(getAccountGeneration());
	const [storageFailed, setStorageFailed] = useState(false);
	const storageKey = key === null ? null : `career-draft:${session?.user.id ?? "anonymous"}:${key}`;
	const storage = () => (reviewOnRestore ? localStorage : sessionStorage);
	const read = () => {
		if (storageKey === null) return initial;
		try {
			const stored = storage().getItem(storageKey);
			return stored === null ? initial : (parse(JSON.parse(stored)) ?? initial);
		} catch {
			return initial;
		}
	};
	const [state, setState] = useState(() => ({
		key: storageKey,
		value: read(),
		restored: reviewOnRestore && JSON.stringify(read()) !== JSON.stringify(initial),
	}));
	if (state.key !== storageKey)
		setState({
			key: storageKey,
			value: read(),
			restored: reviewOnRestore && JSON.stringify(read()) !== JSON.stringify(initial),
		});
	const current = useRef(state);
	useLayoutEffect(() => {
		current.current = state;
	});
	const setValue = (update: SetStateAction<T>) => {
		if (generation.current !== getAccountGeneration()) return;
		const previous = current.current.key === storageKey ? current.current.value : read();
		const value = typeof update === "function" ? (update as (value: T) => T)(previous) : update;
		current.current = { key: storageKey, value, restored: current.current.restored };
		setState(current.current);
		if (storageKey === null) return;
		try {
			storage().setItem(storageKey, JSON.stringify(value));
			setStorageFailed(false);
		} catch {
			// Keep editing, but explain that refresh recovery is unavailable.
			setStorageFailed(true);
		}
	};
	const clear = (sent?: T) => {
		if (generation.current !== getAccountGeneration()) return;
		if (storageKey === null) return;
		try {
			if (sent !== undefined && storage().getItem(storageKey) !== JSON.stringify(sent)) return;
			storage().removeItem(storageKey);
		} catch {
			// Nothing can be cleared when storage is unavailable.
		}
	};
	return {
		key: storageKey,
		storageFailed,
		value: state.value,
		setValue,
		clear,
		restored: state.restored,
		accept: () => {
			current.current = { ...current.current, restored: false };
			setState(current.current);
		},
		reset: () => {
			clear();
			current.current = { key: storageKey, value: initial, restored: false };
			setState(current.current);
		},
	};
}

/**
 * One application's live workspace state. Saves are optimistic; failures explain the problem and refetch after
 * queued writes finish, while text fields retain their local drafts.
 */
export function useWorkspace(applicationId: string) {
	const generation = useRef(getAccountGeneration());
	const { session } = useRouteContext({ strict: false });
	const queryClient = useQueryClient();
	const queryKey = orpc.career.workspace.queryKey({ input: { applicationId } });
	const query = useQuery(orpc.career.workspace.queryOptions({ input: { applicationId } }));
	let byApplication = workspaceWrites.get(queryClient);
	if (!byApplication) workspaceWrites.set(queryClient, (byApplication = new Map()));
	let writes = byApplication.get(applicationId);
	if (!writes) byApplication.set(applicationId, (writes = new Set()));
	const pending = writes;
	const workspaceMutation = orpc.career.saveWorkspace.mutationOptions();
	const mutation = useMutation({
		...workspaceMutation,
		mutationFn: (input, context) => {
			if (generation.current !== getAccountGeneration()) return Promise.reject(new Error("Account changed"));
			if (!workspaceMutation.mutationFn) throw new Error("Missing workspace mutation");
			return workspaceMutation.mutationFn(input, context);
		},
		// One at a time per application, and no app-wide refetch: a refetch landing between two quick ticks would
		// hand the second save a copy without the first.
		scope: { id: `career-workspace:${applicationId}` },
		meta: { noInvalidate: true },
		onError: (error) => {
			toastError(error, t`Couldn't save that change. Check your connection and try again.`, {
				allowServerMessage: true,
			});
		},
	});
	const save = (patch: Partial<CareerWorkspace>) => {
		if (generation.current !== getAccountGeneration()) return;
		const previous = queryClient.getQueryData<CareerWorkspace>(queryKey) ?? EMPTY_WORKSPACE;
		const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
		const expected = Object.fromEntries(
			Object.keys(defined).map((key) => [key, previous[key as keyof CareerWorkspace]]),
		);
		// Capture and publish synchronously, so another control's immediate write builds on this one.
		void queryClient.cancelQueries({ queryKey });
		queryClient.setQueryData(queryKey, { ...previous, ...defined });
		const write = mutation.mutateAsync({ applicationId, ...defined, expected });
		pending.add(write);
		void write
			.then(() => {
				if (generation.current !== getAccountGeneration()) return;
				const clear = (name: string, sent: string) => {
					const key = `career-draft:${session?.user.id ?? "anonymous"}:${name}`;
					try {
						if (localStorage.getItem(key) === JSON.stringify(sent)) localStorage.removeItem(key);
					} catch {
						/* Storage can be unavailable. */
					}
				};
				if (patch.message !== undefined) clear(`message:${applicationId}`, patch.message);
				for (const answer of patch.answers ?? []) {
					clear(`answer:${applicationId}:${answer.id}`, answer.answer);
					clear(`question:${applicationId}:${answer.id}`, answer.question);
				}
			})
			.catch(() => {
				// Preserve newer optimistic edits; recover the authoritative state once queued writes finish.
				void Promise.allSettled(pending).then(() => queryClient.invalidateQueries({ queryKey }));
			})
			.finally(() => pending.delete(write));
	};
	return {
		data: query.data ?? EMPTY_WORKSPACE,
		isPending: query.isPending,
		/** The latest copy, including saves still in flight, for a change that commits later (after an Undo toast). */
		current: () => queryClient.getQueryData<CareerWorkspace>(queryKey) ?? EMPTY_WORKSPACE,
		save,
		/** Finish queued writes before an action that reads the authoritative workspace. */
		settled: async () => {
			while (pending.size > 0) await Promise.all(pending);
			return queryClient.getQueryData<CareerWorkspace>(queryKey) ?? EMPTY_WORKSPACE;
		},
	};
}

/** Toggles one row of a ticked list in the workspace ("plan:{id}", "now:{interviewId}", "week:{id}"). */
export function useTicks(applicationId: string, key: string) {
	const workspace = useWorkspace(applicationId);
	const ticked = workspace.data.ticks[key] ?? [];
	return {
		ticked,
		toggle: (row: string, on: boolean) => {
			const current = workspace.current().ticks;
			const rows = current[key] ?? [];
			workspace.save({
				ticks: {
					...current,
					[key]: on ? [...new Set([...rows, row])] : rows.filter((item) => item !== row),
				},
			});
		},
	};
}

export function useSavedItems(applicationId: string) {
	return useQuery(orpc.career.savedItems.queryOptions({ input: { applicationId } }));
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

/** The connection tab AI uses: the most recently used tested one, as on the server. */
export function useDefaultProvider() {
	const state = useHasUsableAiProvider();
	return { ...state, provider: state.usableProviders[0] ?? null };
}

/**
 * Asks the coach for one structured piece of work for a tab. Errors say what didn't run; stored data stays usable.
 */
export function useGenerate(applicationId: string) {
	const { i18n } = useLingui();
	const queryClient = useQueryClient();
	const connection = useDefaultProvider();
	const { provider } = connection;
	const mutation = useMutation({
		...orpc.career.generate.mutationOptions(),
		onSuccess: (result) => {
			if (result.item) void queryClient.invalidateQueries({ queryKey: orpc.career.savedItems.key() });
		},
		onError: (error) => {
			const name = provider?.label ?? t`Your AI connection`;
			toastError(error, t`${name} didn't respond. Nothing was changed; try again.`, { allowServerMessage: true });
		},
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

/**
 * Saves text a moment after typing stops (2s) and when the field loses focus or unmounts. Returns `flush` for blur.
 */
export function useDebouncedSave(value: string, saved: string, save: (value: string) => void, delay = 2000) {
	const generation = useRef(getAccountGeneration());
	const latest = useRef({ value, saved, save });
	const attempted = useRef<string | undefined>(undefined);
	useLayoutEffect(() => {
		latest.current = { value, saved, save };
	});
	const flush = useCallback((force?: unknown) => {
		const current = latest.current;
		if (generation.current !== getAccountGeneration()) return;
		if (current.value !== current.saved && (force === true || current.value !== attempted.current)) {
			attempted.current = current.value;
			current.save(current.value);
		}
	}, []);
	useEffect(() => {
		if (value === saved) return;
		const id = window.setTimeout(flush, delay);
		return () => window.clearTimeout(id);
	}, [value, saved, delay, flush]);
	useEffect(() => {
		pendingCommits.add(flush);
		return () => {
			pendingCommits.delete(flush);
			flush();
		};
	}, [flush]);
	return flush;
}

/**
 * Sheets and dialogs kept in the URL. Opening one adds a history entry, so Back closes it; closing one this page opened
 * goes back to the entry beneath rather than adding another. Opened from a link or a reload, closing replaces the URL.
 */
export function useOverlayHistory() {
	const router = useRouter();
	// The history index beneath the overlay this page last opened.
	const beneath = useRef<number | null>(null);
	const index = () => router.state.location.state.__TSR_index;
	return {
		/** Call just before the navigation that opens it. */
		open: () => {
			beneath.current = index();
		},
		close: (replace: () => void) => {
			if (beneath.current !== null && index() === beneath.current + 1) router.history.back();
			else replace();
		},
	};
}
