import { t } from "@lingui/core/macro";
import { useSyncExternalStore } from "react";
import { useDataBackend } from "./provider";
import { assertDataScope } from "./scope";
import Storage from "./storage";

const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};
export function readLocal<T>(scope: string, name: string, fallback: T): T {
	const raw = Storage.getItemSync(`local:${scope}:${name}`);
	return raw === null ? fallback : (JSON.parse(raw) as T);
}
export function writeLocal<T>(scope: string, name: string, value: T) {
	assertDataScope(scope);
	Storage.setItemSync(`local:${scope}:${name}`, JSON.stringify(value));
	for (const listener of listeners) listener();
}
/** Read current storage on actions so sibling panes cannot overwrite a newer edit. */
export function useLocalValue<T>(name: string, fallback: T) {
	const { scope } = useDataBackend();
	const raw = useSyncExternalStore(subscribe, () => (scope ? Storage.getItemSync(`local:${scope}:${name}`) : null));
	return {
		value: raw === null ? fallback : (JSON.parse(raw) as T),
		set(value: T) {
			if (!scope) throw new Error(t`Sign in again.`);
			writeLocal(scope, name, value);
		},
	};
}
export function useCoachDraft(threadId?: string) {
	const draft = useLocalValue(`coach-draft:${threadId ?? "new"}`, "");
	return { text: draft.value, setText: draft.set, clear: () => draft.set("") };
}
export function useAssistantDraft(threadId?: string) {
	const draft = useLocalValue(`assistant-draft:${threadId ?? "new"}`, "");
	return { text: draft.value, setText: draft.set, clear: () => draft.set("") };
}
export function useAvoidList() {
	const local = useLocalValue<string[]>("avoid", []);
	return { avoid: local.value, save: local.set, serverChangeNeeded: "career.updateProfile: add avoid" as const };
}
