import { useEffect, useMemo, useSyncExternalStore } from "react";
import { getAccountScope } from "@/auth/session";

export type HistoryStep = { undo(): void; redo(): void };
export function createDocumentHistory() {
	const past: HistoryStep[] = [];
	const future: HistoryStep[] = [];
	const listeners = new Set<() => void>();
	let version = 0;
	const changed = () => {
		version++;
		for (const listener of listeners) listener();
	};
	return {
		get canUndo() {
			return past.length > 0;
		},
		get canRedo() {
			return future.length > 0;
		},
		record(step: HistoryStep) {
			past.push(step);
			future.length = 0;
			changed();
		},
		undo() {
			const step = past.at(-1);
			if (!step) return;
			step.undo();
			past.pop();
			future.push(step);
			changed();
		},
		redo() {
			const step = future.at(-1);
			if (!step) return;
			step.redo();
			future.pop();
			past.push(step);
			changed();
		},
		clear() {
			past.length = future.length = 0;
			changed();
		},
		snapshot: () => version,
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}
const histories = new Map<string, ReturnType<typeof createDocumentHistory>>();
/** Mount once in the document layout. Panes receive this owner through their layout. */
export function useDocumentHistory(documentId: string) {
	const key = JSON.stringify([getAccountScope(), documentId]);
	const history = useMemo(() => {
		const existing = histories.get(key) ?? createDocumentHistory();
		histories.set(key, existing);
		return existing;
	}, [key]);
	useSyncExternalStore(history.subscribe, history.snapshot);
	useEffect(
		() => () => {
			history.clear();
			histories.delete(key);
		},
		[history, key],
	);
	return history;
}
