/** Server forget is permanent. Keep facts restorable until the screen leaves; Toast needs an expiry callback. */
export function createForgetHold<T extends { id: string }>(commit: (fact: T) => Promise<unknown>) {
	const held = new Map<string, T>();
	return {
		values: () => [...held.values()],
		hold: (fact: T) => held.set(fact.id, fact),
		restore: (id: string) => held.delete(id),
		async flush() {
			const pending = [...held.values()];
			for (const fact of pending) {
				await commit(fact);
				held.delete(fact.id);
			}
		},
	};
}
