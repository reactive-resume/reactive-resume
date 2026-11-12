/** Server forget is permanent. Keep facts restorable until their toast goes or the screen leaves. */
export function createForgetHold<T extends { id: string }>(commit: (fact: T) => Promise<unknown>) {
	const held = new Map<string, T>();
	// Facts already being sent: a second flush running alongside never sends the same fact twice.
	const sending = new Set<string>();
	return {
		values: () => [...held.values()],
		hold: (fact: T) => held.set(fact.id, fact),
		restore: (id: string) => !sending.has(id) && held.delete(id),
		async flush() {
			const pending = [...held.values()].filter((fact) => !sending.has(fact.id));
			for (const fact of pending) {
				sending.add(fact.id);
				try {
					await commit(fact);
					held.delete(fact.id);
				} finally {
					sending.delete(fact.id);
				}
			}
		},
	};
}
