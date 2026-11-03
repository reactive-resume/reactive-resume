import type { DocumentSummary } from "./filter";
import { useEffect } from "react";
import { create } from "zustand/react";
import { getAccountScope } from "@/auth/session";

type DocumentRef = Pick<DocumentSummary, "type" | "id">;
export type OnDocumentEffect = (
	effect: "trash" | "restore" | "purge",
	documents?: readonly DocumentRef[],
) => void | Promise<void>;

const useHistory = create<{ accounts: Record<string, true> }>(() => ({ accounts: {} }));

/** Nonpersisted account history survives Documents/Trash remounts and account switching. */
export function useDocumentHistory(scope: string | null, hasDocuments: boolean) {
	const hadDocuments = useHistory((state) => scope !== null && state.accounts[scope] === true);
	useEffect(() => {
		if (!scope || !hasDocuments || getAccountScope() !== scope) return;
		useHistory.setState((state) => ({ accounts: { ...state.accounts, [scope]: true } }));
	}, [scope, hasDocuments]);
	return hasDocuments || hadDocuments;
}

let collection: { scope: string | null; play: OnDocumentEffect } | undefined;

export function registerDocumentEffect(scope: string | null, play: OnDocumentEffect) {
	const current = { scope, play };
	collection = current;
	return () => {
		if (collection === current) collection = undefined;
	};
}

/** Toasts outlive their originating screen; dispatch only to this account's focused collection. */
export function playDocumentEffect(scope: string | null, ...args: Parameters<OnDocumentEffect>) {
	if (scope && getAccountScope() === scope && collection?.scope === scope) return collection.play(...args);
}
