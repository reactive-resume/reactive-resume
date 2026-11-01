// Application notes saves: one request per application at a time, edits made meanwhile coalesce into the next
// request (latest text wins), and typed text stays on the device until a save of it succeeds.
// Pure: storage is injected (expo-sqlite/kv-store in the app), so Node runs it in the M5-T2 scenarios.

export type NotesStorage = {
	getItemSync: (key: string) => string | null;
	setItemSync: (key: string, value: string) => void;
	removeItemSync: (key: string) => unknown;
};

export function createNotesQueue(storage: NotesStorage) {
	/** Text waiting for the next request, per key. */
	const queued = new Map<string, string>();
	const running = new Map<string, Promise<void>>();

	return {
		/** Unsaved text kept on this device from an earlier visit, or null. */
		kept: (key: string) => storage.getItemSync(key),
		/** Keeps typed text on the device before it is sent. */
		keep: (key: string, value: string) => storage.setItemSync(key, value),
		discard(key: string) {
			queued.delete(key);
			storage.removeItemSync(key);
		},
		/**
		 * Saves `value`, or a newer text queued before its turn. Resolves when the queue for `key` is empty and rejects
		 * on the first failure; the failed text stays queued and kept unless newer text replaced it.
		 */
		save(key: string, value: string, send: (value: string) => Promise<unknown>): Promise<void> {
			queued.set(key, value);
			const current = running.get(key);
			if (current) return current;
			const run = (async () => {
				try {
					for (let next = queued.get(key); next !== undefined; next = queued.get(key)) {
						queued.delete(key);
						try {
							await send(next);
						} catch (error) {
							if (!queued.has(key)) queued.set(key, next);
							throw error;
						}
						// Newer keystrokes kept since then stay until their own save succeeds.
						if (storage.getItemSync(key) === next) storage.removeItemSync(key);
					}
				} finally {
					running.delete(key);
				}
			})();
			running.set(key, run);
			return run;
		},
	};
}
