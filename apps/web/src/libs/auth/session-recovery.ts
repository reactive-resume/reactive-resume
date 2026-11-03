import { create } from "zustand";
import { getAccountGeneration, getAccountId } from "./account-scope";
import { authClient } from "./client";

export const useSessionRecovery = create<{ accountId: string | null }>(() => ({ accountId: null }));

let checking: { generation: number; promise: Promise<void> } | undefined;

/** Confirm session loss without clearing the account's open forms or pending saves. */
export function reportSessionLoss(accountId: string | undefined) {
	if (!accountId || accountId !== getAccountId()) return;
	if (useSessionRecovery.getState().accountId === accountId) return;
	const generation = getAccountGeneration();
	if (checking?.generation === generation) return checking.promise;
	const promise = authClient
		.getSession({ query: { disableCookieCache: true } })
		.then(({ data, error }) => {
			if (generation !== getAccountGeneration() || accountId !== getAccountId()) return;
			if (!data && (!error || error.status === 401)) useSessionRecovery.setState({ accountId });
		})
		.catch(() => {})
		.finally(() => {
			if (checking?.promise === promise) checking = undefined;
		});
	checking = { generation, promise };
	return promise;
}

export function sessionSignInURL(
	callbackURL = `${window.location.pathname}${window.location.search}${window.location.hash}`,
) {
	return `/auth/login?${new URLSearchParams({
		callbackURL,
		reauthenticate: "true",
	})}`;
}
