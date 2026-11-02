/** Pure ownership rules for the native unkept letter draft, away from storage and React so they can be host-tested. */
export function letterDraftOwnerKey(server: string, account: string | null, letterId: string) {
	return `letter-draft:${server}:${account ?? "signed-out"}:${letterId}`;
}

/** Only the exact server/account/letter that stored the draft may read it; every other screen sees `idle`. */
export function draftForOwner<T>(state: { owner: string | null; draft: T }, owner: string, idle: T): T {
	return state.owner === owner ? state.draft : idle;
}
