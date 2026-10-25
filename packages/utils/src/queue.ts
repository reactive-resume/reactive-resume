/**
 * Runs tasks one at a time, in call order. A failed task doesn't block the ones after it. A task must not wait on
 * a later task in the same queue, or both stall.
 */
export function createSerialQueue() {
	let tail: Promise<unknown> = Promise.resolve();
	return <T>(task: () => T | Promise<T>): Promise<T> => {
		const run = tail.then(task);
		tail = run.catch(() => undefined);
		return run;
	};
}
