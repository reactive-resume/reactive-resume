// S8's decisions, kept apart from the dialog so they can be tested: what the queue holds and which variant shows.

export type PendingCounts = {
	documents: number;
	letters: number;
	profile: number;
	"stories-and-facts": number;
	applications: number;
};
export type SyncFailure = "offline" | "session-expired" | "conflict" | "no-response";

export const totalPending = (counts: PendingCounts | undefined) =>
	counts ? Object.values(counts).reduce((sum, n) => sum + n, 0) : 0;

/** Mirrors the data layer's failure codes (`failureOf` in src/data/queue.ts, not exported). */
export function failureFromError(error: unknown): SyncFailure {
	const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
	if (code === "UNAUTHORIZED" || code === "SESSION_EXPIRED") return "session-expired";
	if (/CONFLICT|CURRENT_CLIENT_REQUIRED/.test(code)) return "conflict";
	return code === "OFFLINE" ? "offline" : "no-response";
}

export type SignOutStep =
	| { step: "ask" }
	| { step: "syncing" }
	| { step: "failed"; failure: SyncFailure }
	| { step: "exporting" }
	| { step: "exported" };

export function signOutFirstAction(state: SignOutStep, offline: boolean) {
	if (state.step !== "failed") return offline ? "keep" : "sync";
	if (state.failure === "session-expired") return "sign-in";
	if (state.failure === "conflict") return "review";
	return state.failure === "no-response" ? "retry" : "keep";
}
