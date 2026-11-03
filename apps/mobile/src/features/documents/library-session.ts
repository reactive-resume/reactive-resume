import type { DocumentSummary } from "./filter";
import { useEffect } from "react";
import { create } from "zustand/react";
import { getAccountScope } from "@/auth/session";

type DocumentRef = Pick<DocumentSummary, "type" | "id">;
export type OnDocumentEffect = (
	effect: "trash" | "restore" | "purge",
	documents?: readonly DocumentRef[],
) => void | Promise<void>;

const useHistory = create<{ scope: string | null; hadDocuments: boolean }>(() => ({
	scope: null,
	hadDocuments: false,
}));

/** Nonpersisted account history survives Documents/Trash remounts. */
export function useDocumentHistory(scope: string | null, hasDocuments: boolean) {
	const hadDocuments = useHistory((state) => state.scope === scope && state.hadDocuments);
	useEffect(() => {
		if (getAccountScope() !== scope) return;
		useHistory.setState((state) => ({
			scope,
			hadDocuments: hasDocuments || (state.scope === scope && state.hadDocuments),
		}));
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
