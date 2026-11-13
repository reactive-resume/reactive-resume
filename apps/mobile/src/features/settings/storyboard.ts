// Storyboard captures of S8 and its undrawn variants: S1 opens with `?signout=<variant>` and three queued changes.
import type { PendingCounts, SignOutStep, SyncFailure } from "./sign-out";

const counts: PendingCounts = { documents: 2, letters: 0, profile: 1, "stories-and-facts": 0, applications: 0 };

/** MOTION.md §12's S1 row: two queued changes, offline. */
const two: PendingCounts = { documents: 1, letters: 0, profile: 1, "stories-and-facts": 0, applications: 0 };

export function storyboardSignOut(variant: string): { counts: PendingCounts; offline: boolean; initial: SignOutStep } {
	if (variant === "offline-two") return { counts: two, offline: true, initial: { step: "ask" } };
	if (variant === "online") return { counts, offline: false, initial: { step: "ask" } };
	if (variant === "session-expired" || variant === "conflict" || variant === "no-response")
		return { counts, offline: false, initial: { step: "failed", failure: variant satisfies SyncFailure } };
	return { counts, offline: true, initial: { step: "ask" } };
}
