import { getRedis, redisKey } from "@reactive-resume/db/redis";

const controllers = new Map<string, AbortController>();
const CANCELLATION_TTL_MS = 15 * 60_000;

export async function requestRunCancellation(runId: string, reason: string): Promise<void> {
	try {
		await getRedis()?.set(redisKey("agent-cancellation", runId), reason, "PX", CANCELLATION_TTL_MS);
	} finally {
		controllers.get(runId)?.abort(new DOMException(reason, "AbortError"));
	}
}

export async function monitorRunCancellation(runId: string, controller: AbortController): Promise<() => void> {
	controllers.set(runId, controller);
	const redis = getRedis();
	let stopped = false;
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const cleanup = () => {
		stopped = true;
		clearTimeout(timeout);
		controller.signal.removeEventListener("abort", cleanup);
		if (controllers.get(runId) === controller) controllers.delete(runId);
	};
	controller.signal.addEventListener("abort", cleanup, { once: true });
	if (controller.signal.aborted) cleanup();

	const check = async () => {
		if (stopped || !redis) return;
		try {
			const reason = await redis.get(redisKey("agent-cancellation", runId));
			if (!stopped && reason) controller.abort(new DOMException(reason, "AbortError"));
		} catch {
			if (!stopped) controller.abort(new DOMException("CANCELLATION_UNAVAILABLE", "AbortError"));
		}
		// ponytail: one Redis read per second per run; pub/sub can reduce traffic at higher concurrency.
		if (!stopped) timeout = setTimeout(() => void check(), 1_000);
	};
	await check();
	return cleanup;
}
