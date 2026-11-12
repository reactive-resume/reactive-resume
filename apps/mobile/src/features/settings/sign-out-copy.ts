import type { PendingCounts, SignOutStep } from "./sign-out";
// S8's words: the title, the line under it and the count by kind.
import { plural, t } from "@lingui/core/macro";

/** "2 documents · 1 profile change": what's queued, by kind, in the queue's order. */
export function pendingByKind(counts: PendingCounts): string {
	const parts = [
		counts.documents ? plural(counts.documents, { one: "# document", other: "# documents" }) : "",
		counts.letters ? plural(counts.letters, { one: "# letter", other: "# letters" }) : "",
		counts.profile ? plural(counts.profile, { one: "# profile change", other: "# profile changes" }) : "",
		counts["stories-and-facts"]
			? plural(counts["stories-and-facts"], { one: "# story or fact", other: "# stories and facts" })
			: "",
		counts.applications ? plural(counts.applications, { one: "# application", other: "# applications" }) : "",
	];
	return parts.filter(Boolean).join(" · ");
}

export const pendingTitle = (total: number) =>
	plural(total, { one: "# change hasn't synced", other: "# changes haven't synced" });

/** The line under the title: what would happen, or the real cause of a failed sync. */
export function signOutMessage(state: SignOutStep, offline: boolean, host: string, conflicts = 1): string {
	if (state.step === "failed")
		switch (state.failure) {
			case "offline":
				return t`You're offline. Signing out now would remove them from this phone.`;
			case "session-expired":
				return t`Your session expired. Sign in again to sync them.`;
			case "conflict":
				return plural(Math.max(1, conflicts), {
					one: "# change conflicts with a newer version. Review it before you sign out.",
					other: "# changes conflict with a newer version. Review them before you sign out.",
				});
			case "no-response":
				return t`${host} didn't respond. Your changes are still on this phone.`;
		}
	return offline
		? t`You're offline. Signing out now would remove them from this phone.`
		: t`Signing out now would remove them from this phone.`;
}
