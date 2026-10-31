/**
 * The account this tab's interface belongs to. Session loads update it, and every tab that signs out (or whose session
 * is replaced) advances the generation so text typed for the old account can never be queued against the new one.
 *
 * Kept free of React and app imports: the RPC transport reads the id, and the account reset code advances the
 * generation. Requests carry the id so the server can refuse a write dispatched after the cookie already changed.
 */
let accountId: string | null = null;
let generation = 0;

export const getAccountId = () => accountId;
export const getAccountGeneration = () => generation;

/** A session belonging to another account fences work queued for the previous one. */
export function setAccountScope(id: string | null) {
	if (id === accountId) return;
	accountId = id;
	generation += 1;
}

/** Sign-out and account deletion fence the old account even when the next session is also signed out. */
export function invalidateAccountScope() {
	accountId = null;
	generation += 1;
}

type AccountChangeListener = () => void;

const channelName = "reactive-resume:account";
// Storage is the fallback signal for browsers without BroadcastChannel. The key is not account data and is never
// removed by the reset below; each write carries a distinct value so listeners always see a change.
const storageKey = "reactive-resume:account-change";
const listeners = new Set<AccountChangeListener>();
let channel: BroadcastChannel | null | undefined;

function notify() {
	invalidateAccountScope();
	for (const listener of listeners) listener();
}

function ensureChannel() {
	if (channel !== undefined) return channel;
	channel = null;
	try {
		if (typeof BroadcastChannel !== "undefined") {
			channel = new BroadcastChannel(channelName);
			channel.addEventListener("message", notify);
		}
	} catch {
		channel = null;
	}
	return channel;
}

/** Listens for a sign-out or account change made in another tab. Returns the unsubscribe function. */
export function subscribeAccountChange(listener: AccountChangeListener) {
	ensureChannel();
	listeners.add(listener);
	if (typeof window !== "undefined")
		window.addEventListener("storage", (event) => {
			if (event.key === storageKey) notify();
		});
	return () => {
		listeners.delete(listener);
	};
}

/** Tells other tabs that the signed-in account changed, so their queued saves stop before they reach the server. */
export function broadcastAccountChange() {
	try {
		ensureChannel()?.postMessage({ at: Date.now() });
	} catch {
		// A closed or unavailable channel still leaves the storage signal.
	}
	try {
		localStorage.setItem(storageKey, String(Date.now()));
	} catch {
		// Blocked browser storage must not prevent signing out.
	}
}
