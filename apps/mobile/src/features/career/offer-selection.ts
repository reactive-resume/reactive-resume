import { create } from "zustand/react";
import { getAccountScope } from "@/auth/session";

type SavedOffer = { id: string; b: string | undefined };

export const useSavedOffer = create<{ accounts: Record<string, SavedOffer | undefined> }>(() => ({ accounts: {} }));

/** A save can finish after Offers leaves the stack; apply its selection only when that account returns. */
export function rememberSavedOffer(scope: string, id: string, b: string | undefined) {
	if (getAccountScope() !== scope) return;
	useSavedOffer.setState((state) => ({ accounts: { ...state.accounts, [scope]: { id, b } } }));
}

export function consumeSavedOffer(scope: string, id: string) {
	if (getAccountScope() !== scope || useSavedOffer.getState().accounts[scope]?.id !== id) return;
	useSavedOffer.setState((state) => ({ accounts: { ...state.accounts, [scope]: undefined } }));
}
